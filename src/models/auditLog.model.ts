import { BaseModel } from "./BaseModel.js";
import type { AuditEntry } from "../services/audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class AuditLogModel extends BaseModel {
  create(entry: AuditEntry) {
    return this.db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        changes: (entry.changes ?? undefined) as object | undefined,
      },
    });
  }

  list(params: ListParams, filters: { actorId?: string; entityType?: string; action?: string; from?: Date; to?: Date } = {}) {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.action) where.action = { startsWith: filters.action };
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }

    return this.db.auditLog.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy ?? { createdAt: "desc" },
    });
  }

  count(filters: { actorId?: string; entityType?: string; action?: string; from?: Date; to?: Date } = {}) {
    const where: Prisma.AuditLogWhereInput = {};
    if (filters.actorId) where.actorId = filters.actorId;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.action) where.action = { startsWith: filters.action };
    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }
    return this.db.auditLog.count({ where });
  }

  findById(id: string) {
    return this.db.auditLog.findUnique({ where: { id } });
  }

  findByEntity(entityType: string, entityId: string) {
    return this.db.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: "desc" },
    });
  }

  findByActor(actorId: string) {
    return this.db.auditLog.findMany({
      where: { actorId },
      orderBy: { createdAt: "desc" },
    });
  }
}
