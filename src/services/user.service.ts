import { commandMetadata } from "../lib/command-contracts.js";
import { accountCreate, accountUpdate } from "../lib/account-input.js";
import { actorAccessService } from "./actor-access.service.js";
import { authService } from "./auth.service.js";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { UserModel } from "../models/user.model.js";
import { RoleModel, roleModel } from "../models/role.model.js";
import { auditService, AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";


export class UserService extends BaseService {
  constructor(
    private readonly model = new UserModel(),
    private readonly audit: AuditService = auditService,
    private readonly roles: RoleModel = roleModel,
    private readonly access = actorAccessService
  ) {
    super("UserService");
  }

  list(params: ListParams) {
    return this.model.list(params);
  }

  count(search?: string) {
    return this.model.count(search);
  }

  async getById(id: string) {
    const user = await this.model.findById(id);
    if (!user) throw AppError.notFound("User");
    return user;
  }

  async create(input: unknown, actorId?: string, operationId?: string) {
    const data = accountCreate.parse(input);
    await this.access.require(actorId, "user:create");
    await this.access.require(actorId, "role:update");
    const role = data.roleId ? await this.roles.findById(data.roleId) : await this.roles.findByName(data.role ?? "USER");
    if (!role || role.deletedAt) throw AppError.notFound("Role");
    const { role: _role, password, roleId: _roleId, ...dbData } = data;
    const passwordHash = authService.hashPassword(password);
    const created = await this.model.create({
      ...dbData,
      role: { connect: { id: role.id } },
      passwordHash,
    }, actorId, commandMetadata(input, operationId));
    await this.audit.record({
      actorId,
      action: "user.create",
      entityType: "User",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, input: unknown, actorId?: string, operationId?: string) {
    const data = accountUpdate.parse(input);
    await this.access.require(actorId, "user:update");
    if (data.roleId !== undefined || data.role !== undefined) await this.access.require(actorId, "role:update");
    const before = await this.getById(id);
    const { password, roleId, role: roleName, ...fields } = data;
    const role = roleId ? await this.roles.findById(roleId) : roleName ? await this.roles.findByName(roleName) : undefined;
    if ((roleId || roleName) && (!role || role.deletedAt)) throw AppError.notFound("Role");
    const dbData = { ...fields, ...(role ? { role: { connect: { id: role.id } } } : {}),
      ...(password ? { passwordHash: authService.hashPassword(password) } : {}) };
    const updated = await this.model.update(id, dbData, actorId, commandMetadata(input, operationId));
    await this.audit.record({
      actorId,
      action: "user.update",
      entityType: "User",
      entityId: id,
      changes: { before, after: updated },
    });
    return updated;
  }

  async remove(id: string, actorId?: string, operationId?: string) {
    await this.access.require(actorId, "user:delete");
    await this.getById(id); // 404 if missing
    const removed = await this.model.softDelete(id, actorId, commandMetadata({ id }, operationId));
    await this.audit.record({
      actorId,
      action: "user.delete",
      entityType: "User",
      entityId: id,
    });
    return removed;
  }
}

export const userService = new UserService();





