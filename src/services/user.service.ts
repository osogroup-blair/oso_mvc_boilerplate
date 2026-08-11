import { authService } from "./auth.service.js";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { UserModel } from "../models/user.model.js";
import { RoleModel, roleModel } from "../models/role.model.js";
import { auditService, AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class UserService extends BaseService {
  constructor(
    private readonly model = new UserModel(),
    private readonly audit: AuditService = auditService,
    private readonly roles: RoleModel = roleModel
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

  async create(data: Prisma.UserCreateInput & { role?: string; roleId?: string; password?: string }, actorId?: string) {
    let roleId = data.roleId;
    if (data.role && !roleId) {
      const roleRecord = await this.roles.findByName(data.role);
      if (!roleRecord) throw AppError.notFound(`Role "${data.role}"`);
      roleId = roleRecord.id;
    }
    const { role: _, password, ...dbData } = data;
    const passwordHash = password ? authService.hashPassword(password) : authService.hashPassword("default123");
    
    const created = await this.model.create({
      ...dbData,
      roleId: roleId!,
      passwordHash,
    } as any);
    await this.audit.record({
      actorId,
      action: "user.create",
      entityType: "User",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, data: Prisma.UserUpdateInput & { password?: string }, actorId?: string) {
    const before = await this.getById(id);
    const { password, ...dbData } = data;
    if (password) {
      (dbData as any).passwordHash = authService.hashPassword(password);
    }
    const updated = await this.model.update(id, dbData as any);
    await this.audit.record({
      actorId,
      action: "user.update",
      entityType: "User",
      entityId: id,
      changes: { before, after: updated },
    });
    return updated;
  }

  async remove(id: string, actorId?: string) {
    await this.getById(id); // 404 if missing
    const removed = await this.model.softDelete(id);
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





