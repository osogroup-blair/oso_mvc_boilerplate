import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

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
      include: {
        user: {
          include: {
            role: true,
          },
        },
      },
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

  create(data: { userId: string; token: string; expiresAt: Date }) {
    return this.db.session.create({ data });
  }

  findByToken(token: string) {
    return this.db.session.findUnique({
      where: { token },
      include: { user: { include: { role: true } } },
    });
  }

  findById(id: string) {
    return this.db.session.findUnique({
      where: { id },
      include: { user: true },
    });
  }

  deleteById(id: string) {
    return this.db.session.delete({
      where: { id },
    });
  }

  deleteByToken(token: string) {
    return this.db.session.deleteMany({ where: { token } });
  }

  deleteByUserId(userId: string) {
    return this.db.session.deleteMany({ where: { userId } });
  }
}

export const sessionModel = new SessionModel();
