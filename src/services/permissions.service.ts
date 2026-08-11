// Permission enforcement service.
// Roles store permissions as structured "resource:action" strings.
// This service owns the canonical permission vocabulary (DEFINED_PERMISSIONS),
// the can()/assert() guards, and the matrix read/write used by the admin UI.
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { RoleModel } from "../models/role.model.js";
import { auditService, AuditService } from "./audit.service.js";

// ─── Permission Vocabulary ──────────────────────────────────────────────────
// The canonical list of all permissions the system understands.
// The admin matrix UI renders exactly these rows × roles as columns.
// Add a new entry here to expose a new permission throughout the whole system.

export interface PermissionDef {
  resource: string;
  action: string;
  label: string;
  description?: string;
}

export const DEFINED_PERMISSIONS: PermissionDef[] = [
  // Pages
  { resource: "page", action: "read",   label: "View Pages",      description: "Access published CMS pages" },
  { resource: "page", action: "create", label: "Create Pages",    description: "Create new CMS pages" },
  { resource: "page", action: "update", label: "Edit Pages",      description: "Edit existing CMS pages" },
  { resource: "page", action: "delete", label: "Delete Pages",    description: "Delete / archive CMS pages" },
  // Users
  { resource: "user", action: "read",   label: "View Users",      description: "List and view user accounts" },
  { resource: "user", action: "create", label: "Create Users",    description: "Create new user accounts" },
  { resource: "user", action: "update", label: "Edit Users",      description: "Edit user accounts" },
  { resource: "user", action: "delete", label: "Delete Users",    description: "Soft-delete user accounts" },
  // Roles
  { resource: "role", action: "read",   label: "View Roles",      description: "List and view roles" },
  { resource: "role", action: "update", label: "Edit Roles",      description: "Modify role permissions" },
  // Routes
  { resource: "route", action: "read",   label: "View Routes",    description: "View dynamic routes" },
  { resource: "route", action: "create", label: "Create Routes",  description: "Create new dynamic routes" },
  { resource: "route", action: "update", label: "Edit Routes",    description: "Edit dynamic routes" },
  { resource: "route", action: "delete", label: "Delete Routes",  description: "Delete dynamic routes" },
  // Navigation
  { resource: "navigationItem", action: "read",   label: "View Nav Links",    description: "List and view navigation links" },
  { resource: "navigationItem", action: "create", label: "Create Nav Links",  description: "Create new navigation links" },
  { resource: "navigationItem", action: "update", label: "Edit Nav Links",    description: "Edit navigation links" },
  { resource: "navigationItem", action: "delete", label: "Delete Nav Links",  description: "Delete navigation links" },
  // Admin access
  { resource: "admin", action: "access", label: "Admin Access",   description: "Access the admin area at all" },
  { resource: "admin", action: "logs",   label: "View Logs",      description: "View audit logs and diagnostics" },
  { resource: "admin", action: "settings", label: "Site Settings", description: "Edit global site settings" },
] as const;

// Helper: format a resource+action into a canonical permission key.
export function permKey(resource: string, action: string): string {
  return `${resource}:${action}`;
}

// Groups the defined permissions by resource for easier UI rendering.
export function groupedPermissions(): Record<string, PermissionDef[]> {
  const groups: Record<string, PermissionDef[]> = {};
  for (const p of DEFINED_PERMISSIONS) {
    if (!groups[p.resource]) groups[p.resource] = [];
    groups[p.resource].push(p);
  }
  return groups;
}

// ─── PermissionsService ─────────────────────────────────────────────────────

export interface RolePermissionRow {
  roleId: string;
  roleName: string;
  description: string | null;
  permissions: string[]; // "resource:action" keys
}

export class PermissionsService extends BaseService {
  constructor(
    private readonly model = new RoleModel(),
    private readonly audit: AuditService = auditService
  ) {
    super("PermissionsService");
  }

  // ── Check helpers ──────────────────────────────────────────────────────────

  // Check by role NAME (legacy path used in auth middleware / controllers).
  async canByName(roleName: string, resource: string, action: string): Promise<boolean> {
    const role = await this.model.findByName(roleName);
    if (!role || role.deletedAt) return false;
    return role.permissions.includes(permKey(resource, action));
  }

  // Check by role ID (preferred when you have req.user.roleId).
  async can(roleId: string, resource: string, action: string): Promise<boolean> {
    const role = await this.model.findById(roleId);
    if (!role) return false;
    return role.permissions.includes(permKey(resource, action));
  }

  // Check multiple actions (OR logic — passes if ANY action is allowed).
  async canAny(roleId: string, resource: string, actions: string[]): Promise<boolean> {
    const role = await this.model.findById(roleId);
    if (!role) return false;
    return actions.some((a) => role.permissions.includes(permKey(resource, a)));
  }

  // Throw AppError.forbidden if the role (by name) lacks the permission.
  // Keeps backward compat with existing controller calls.
  async assert(roleName: string, action: string): Promise<void> {
    // Legacy: old format was bare "action", support both "read" and "resource:action"
    const parts = action.includes(":") ? action.split(":") : [null, action];
    const resource = parts[0] ?? "admin";
    const act = parts[1];
    const allowed = await this.canByName(roleName, resource, act!);
    if (!allowed) {
      throw AppError.forbidden(`Role "${roleName}" may not perform "${resource}:${act}"`);
    }
  }

  // ── Matrix read ───────────────────────────────────────────────────────────

  // Returns every active role with its current permission set.
  // Used by the permissions admin matrix view.
  async getMatrix(): Promise<RolePermissionRow[]> {
    const roles = await this.model.listAll();
    return roles.map((r) => ({
      roleId: r.id,
      roleName: r.name,
      description: r.description,
      permissions: r.permissions,
    }));
  }

  // ── Matrix write ──────────────────────────────────────────────────────────

  // Replace the full permissions array for a given role (by ID), audited.
  async setPermissions(roleId: string, permissions: string[], actorId?: string): Promise<void> {
    const before = await this.model.findById(roleId);
    if (!before) throw AppError.notFound("Role");

    // Only keep known permission keys to prevent garbage in the DB.
    const known = new Set(DEFINED_PERMISSIONS.map((p) => permKey(p.resource, p.action)));
    const cleaned = permissions.filter((p) => known.has(p));

    await this.model.update(roleId, { permissions: cleaned });

    await this.audit.record({
      actorId,
      action: "role.permissions.update",
      entityType: "Role",
      entityId: roleId,
      changes: { before: { permissions: before.permissions }, after: { permissions: cleaned } },
    });

    this.log.info({ roleId, permissions: cleaned }, "Role permissions updated");
  }

  // ── Legacy helpers (kept for backward compat) ─────────────────────────────

  async getActionsForRole(roleName: string): Promise<string[]> {
    const role = await this.model.findByName(roleName);
    return role ? role.permissions : [];
  }
}

export const permissionsService = new PermissionsService();
