import { commandMetadata } from "../lib/command-contracts.js";
import { z } from "zod";
import { DEFINED_PERMISSIONS } from "../lib/permission-definitions.js";
import { actorAccessService } from "./actor-access.service.js";
const roleInput = z.object({ name: z.string().min(1).max(80), description: z.string().max(2000).nullable().optional(), permissions: z.array(z.string()).max(200).optional() }).strict();
const knownPermissions = new Set(DEFINED_PERMISSIONS.map(p => `${p.resource}:${p.action}`));
function validatePermissions(permissions?: string[]) {
  if (permissions?.some(key => !knownPermissions.has(key))) throw AppError.badRequest("Unknown permission");
}
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
    private readonly perms: PermissionsService = permissionsService,
    private readonly access = actorAccessService
  ) {
    super("RoleService");
  }

  list(params: ListParams) {
    return this.model.list(params);
  }

  count(search?: string) {
    return this.model.count(search);
  }

  listWithUserCounts() { return this.model.listWithUserCounts(); }

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

  async create(input: Prisma.RoleCreateInput, actorId?: string, operationId?: string) {
    await this.access.require(actorId, "role:create");
    const data = roleInput.parse(input);
    validatePermissions(data.permissions);
    // Check if name is already taken
    const existing = await this.model.findByName(data.name);
    if (existing) {
      throw AppError.badRequest("Role name must be unique", [{ path: ["name"], message: "Role name must be unique" }]);
    }

    const created = await this.model.create(data, actorId, commandMetadata(input, operationId));
    await this.audit.record({
      actorId,
      action: "role.create",
      entityType: "Role",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, input: Prisma.RoleUpdateInput, actorId?: string, operationId?: string) {
    await this.access.require(actorId, "role:update");
    const data = roleInput.partial().parse(input);
    validatePermissions(data.permissions);
    const before = await this.getById(id);
    
    if (data.name && typeof data.name === "string" && data.name !== before.name) {
      const existing = await this.model.findByName(data.name);
      if (existing && existing.id !== id) {
        throw AppError.badRequest("Role name must be unique", [{ path: ["name"], message: "Role name must be unique" }]);
      }
    }

    const updated = await this.model.update(id, data, actorId, commandMetadata(input, operationId));
    await this.audit.record({
      actorId,
      action: "role.update",
      entityType: "Role",
      entityId: id,
      changes: { before, after: updated },
    });
    return updated;
  }

  async remove(id: string, actorId?: string, operationId?: string) {
    await this.access.require(actorId, "role:delete");
    const role = await this.getById(id);
    
    // Prevent deleting core roles that could lock out admins/users
    if (["ADMIN", "EDITOR", "USER"].includes(role.name)) {
      throw AppError.forbidden(`System role "${role.name}" cannot be deleted.`);
    }

    const removed = await this.model.softDelete(id, actorId, commandMetadata({ id }, operationId));
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
