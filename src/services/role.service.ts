import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { RoleModel } from "../models/role.model.js";
import { auditService, AuditService } from "./audit.service.js";
import { permissionsService, PermissionsService } from "./permissions.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class RoleService extends BaseService {
  constructor(
    private readonly model = new RoleModel(),
    private readonly audit: AuditService = auditService,
    private readonly perms: PermissionsService = permissionsService
  ) {
    super("RoleService");
  }

  list(params: ListParams) {
    return this.model.list(params);
  }

  count(search?: string) {
    return this.model.count(search);
  }

  async getById(id: string) {
    const role = await this.model.findById(id);
    if (!role) throw AppError.notFound("Role");
    return role;
  }

  async getByName(name: string) {
    const role = await this.model.findByName(name);
    if (!role) throw AppError.notFound(`Role "${name}"`);
    return role;
  }

  async create(data: Prisma.RoleCreateInput, actorId?: string) {
    // Check if name is already taken
    const existing = await this.model.findByName(data.name);
    if (existing) {
      throw AppError.badRequest("Role name must be unique", [{ path: ["name"], message: "Role name must be unique" }]);
    }

    const created = await this.model.create(data);
    await this.audit.record({
      actorId,
      action: "role.create",
      entityType: "Role",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, data: Prisma.RoleUpdateInput, actorId?: string) {
    const before = await this.getById(id);
    
    if (data.name && typeof data.name === "string" && data.name !== before.name) {
      const existing = await this.model.findByName(data.name);
      if (existing && existing.id !== id) {
        throw AppError.badRequest("Role name must be unique", [{ path: ["name"], message: "Role name must be unique" }]);
      }
    }

    const updated = await this.model.update(id, data);
    await this.audit.record({
      actorId,
      action: "role.update",
      entityType: "Role",
      entityId: id,
      changes: { before, after: updated },
    });
    return updated;
  }

  async remove(id: string, actorId?: string) {
    const role = await this.getById(id);
    
    // Prevent deleting core roles that could lock out admins/users
    if (["ADMIN", "EDITOR", "USER"].includes(role.name)) {
      throw AppError.forbidden(`System role "${role.name}" cannot be deleted.`);
    }

    const removed = await this.model.softDelete(id);
    await this.audit.record({
      actorId,
      action: "role.delete",
      entityType: "Role",
      entityId: id,
    });
    return removed;
  }

  // Replace the permissions array for a role. Delegates to PermissionsService
  // which validates against DEFINED_PERMISSIONS and audits the change.
  async setPermissions(roleId: string, permissions: string[], actorId?: string): Promise<void> {
    return this.perms.setPermissions(roleId, permissions, actorId);
  }
}

export const roleService = new RoleService();
