import type { CommandMetadata } from "../lib/command-contracts.js";
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

const safeSessionSelect = { id: true, userId: true, expiresAt: true, createdAt: true,
  user: { select: { id: true, name: true, email: true, roleId: true, isActive: true, deletedAt: true,
    role: { select: { id: true, name: true, deletedAt: true } } } },
} satisfies Prisma.SessionSelect;

export class SessionModel extends BaseModel {
  listActive(params: ListParams) {
    const where: Prisma.SessionWhereInput = {
      expiresAt: { gt: new Date() },
      ...(params.search
        ? {
            user: {
              OR: [
                { name: { contains: params.search, mode: "insensitive" } },
                { email: { contains: params.search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };
    return this.db.session.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
      select: safeSessionSelect,
    });
  }

  countActive(search?: string) {
    const where: Prisma.SessionWhereInput = {
      expiresAt: { gt: new Date() },
      ...(search
        ? {
            user: {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };
    return this.db.session.count({ where });
  }

  create(data: { userId: string; token: string; expiresAt: Date }, actorId?: string) {
    return this.mutate("session.create", "Session", actorId ?? data.userId, tx => tx.session.create({ data, select: safeSessionSelect }));
  }

  findByToken(token: string) {
    return this.db.session.findUnique({
      where: { token },
      select: safeSessionSelect,
    });
  }

  findById(id: string) {
    return this.db.session.findUnique({
      where: { id },
      select: safeSessionSelect,
    });
  }

  deleteById(id: string, actorId?: string, command?: CommandMetadata) {
    return this.mutate("session.deleteById", "Session", actorId, tx => tx.session.delete({
      where: { id }, select: { id: true },
    }), id, command, async (_tx, resultId) => ({ id: resultId }));
  }

  deleteByToken(token: string, actorId?: string) {
    return this.mutate("session.deleteByToken", "Session", actorId, tx => tx.session.deleteMany({ where: { token } }));
  }

  deleteByUserId(userId: string, actorId?: string) {
    return this.mutate("session.deleteByUserId", "Session", actorId, tx => tx.session.deleteMany({ where: { userId } }));
  }
}

export const sessionModel = new SessionModel();
