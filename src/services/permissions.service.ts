import { actorAccessService } from "./actor-access.service.js";
import { commandMetadata } from "../lib/command-contracts.js";
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

import { DEFINED_PERMISSIONS, type PermissionDef } from "../lib/permission-definitions.js";
export { DEFINED_PERMISSIONS, type PermissionDef } from "../lib/permission-definitions.js";

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
    private readonly audit: AuditService = auditService,
    private readonly access = actorAccessService
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
  async setPermissions(roleId: string, permissions: string[], actorId?: string, operationId?: string): Promise<void> {
    await this.access.require(actorId, "role:update");
    const before = await this.model.findById(roleId);
    if (!before) throw AppError.notFound("Role");

    // Only keep known permission keys to prevent garbage in the DB.
    const known = new Set(DEFINED_PERMISSIONS.map((p) => permKey(p.resource, p.action)));
    const cleaned = permissions.filter((p) => known.has(p));

    await this.model.update(roleId, { permissions: cleaned }, actorId, commandMetadata({ roleId, permissions: cleaned }, operationId));

    await this.audit.record({
      actorId,
      action: "role.permissions.update",
      entityType: "Role",
      entityId: roleId,
      changes: { before: { permissions: before.permissions }, after: { permissions: cleaned } },
    });

    this.log.info({ roleId, permissions: cleaned }, "Role permissions updated");
  }

  async saveMatrix(checked: Record<string, Record<string, string>>, actorId?: string, operationId?: string) {
    const actor = await this.access.require(actorId, "role:update");
    const known = new Set(DEFINED_PERMISSIONS.map(p => permKey(p.resource, p.action)));
    const roles = await this.model.listAll();
    const entries = roles.map(role => ({ id: role.id, permissions: Object.entries(checked[role.id] ?? {})
      .filter(([key, value]) => value === "on" && known.has(key)).map(([key]) => key) }));
    return this.model.replacePermissions(entries, actor.id, commandMetadata(entries, operationId));
  }

  // ── Legacy helpers (kept for backward compat) ─────────────────────────────

  async getActionsForRole(roleName: string): Promise<string[]> {
    const role = await this.model.findByName(roleName);
    return role ? role.permissions : [];
  }
}

export const permissionsService = new PermissionsService();
