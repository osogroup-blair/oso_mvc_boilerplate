// Route data access. Soft-delete aware.
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class RouteModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.RouteWhereInput = {
      ...this.notDeleted,
      ...(params.search
        ? {
            OR: [
              { pattern: { contains: params.search, mode: "insensitive" } },
              { targetValue: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return this.db.route.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
      include: { allowedRoles: { include: { role: true } } },
    });
  }

  count(search?: string) {
    return this.db.route.count({
      where: {
        ...this.notDeleted,
        ...(search
          ? {
              OR: [
                { pattern: { contains: search, mode: "insensitive" } },
                { targetValue: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    });
  }

  findById(id: string) {
    return this.db.route.findFirst({
      where: { id, ...this.notDeleted },
      include: { allowedRoles: { include: { role: true } } },
    });
  }

  findByPattern(pattern: string) {
    return this.db.route.findFirst({
      where: { pattern, isActive: true, ...this.notDeleted },
      include: { allowedRoles: { include: { role: true } } },
    });
  }

  create(data: Prisma.RouteCreateInput) {
    return this.db.route.create({ data });
  }

  update(id: string, data: Prisma.RouteUpdateInput) {
    return this.db.route.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.db.route.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // Atomically replace the allowed roles for a route (delete then create).
  async setAllowedRoles(routeId: string, roleIds: string[]): Promise<void> {
    await this.db.routeRole.deleteMany({ where: { routeId } });
    if (roleIds.length > 0) {
      await this.db.routeRole.createMany({
        data: roleIds.map((roleId) => ({ routeId, roleId })),
        skipDuplicates: true,
      });
    }
  }
}
