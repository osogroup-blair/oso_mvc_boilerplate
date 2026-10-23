import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { AppError } from "../lib/AppError.js";
import { safeAuditEntry } from "../lib/audit-policy.js";

export class ProjectModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.ProjectWhereInput = {
      ...this.notDeleted,
      ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    };
    return this.db.project.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy ?? { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { tasks: { where: { deletedAt: null } } } },
      },
    });
  }

  count(search?: string) {
    return this.db.project.count({
      where: {
        ...this.notDeleted,
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      },
    });
  }

  // Eager-loads tasks + their tags so the controller can hand a complete
  // payload to the view without N+1 queries.
  findById(id: string) {
    return this.db.project.findFirst({
      where: { id, ...this.notDeleted },
      include: {
        owner: { select: { id: true, name: true } },
        tasks: {
          where: { deletedAt: null },
          include: {
            taskTags: {
              include: { tag: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  create(data: Prisma.ProjectCreateInput) {
    return this.db.project.create({ data });
  }

  /** Reference command: state + metadata receipt commit atomically, with replay. */
  async createWithReceipt(data: Prisma.ProjectCreateInput, actorId: string | undefined, operationId: string) {
    const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
    const receiptId = `command-${hash({ action: "project.create", actorId, operationId })}`;
    const requestHash = hash(data);
    const replay = async (db: Prisma.TransactionClient) => {
      const receipt = await db.auditLog.findUnique({ where: { id: receiptId } });
      if (!receipt) return null;
      const changes = receipt.changes as { after?: { requestHash?: string } } | null;
      if (receipt.actorId !== (actorId ?? null) || receipt.action !== "project.create" || receipt.entityType !== "Project" || changes?.after?.requestHash !== requestHash || !receipt.entityId) {
        throw AppError.conflict("Operation key was used for a different command");
      }
      const result = await db.project.findFirst({ where: { id: receipt.entityId, deletedAt: null } });
      if (!result) throw AppError.conflict("Committed command result is unavailable");
      return result;
    };
    try {
      return await this.db.$transaction(async db => {
        const existing = await replay(db);
        if (existing) return existing;
        const result = await db.project.create({ data });
        const entry = safeAuditEntry({ actorId, action: "project.create", entityType: "Project", entityId: result.id,
          changes: { after: { requestHash, operationId, status: "COMMITTED" } } });
        await db.auditLog.create({ data: { ...entry, id: receiptId, changes: entry.changes as Prisma.InputJsonObject } });
        return result;
      });
    } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      const existing = await replay(this.db);
      if (!existing) throw error;
      return existing;
    }
  }

  update(id: string, data: Prisma.ProjectUpdateInput) {
    return this.db.project.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.db.project.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
