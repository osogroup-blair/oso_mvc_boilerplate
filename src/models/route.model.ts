import type { CommandMetadata } from "../lib/command-contracts.js";
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

  create(data: Prisma.RouteCreateInput, actorId?: string, command?: CommandMetadata, roleIds?: string[]) {
    return this.mutate("route.create", "Route", actorId, tx => tx.route.create({ data: { ...data, ...(roleIds ? { allowedRoles: { create: roleIds.map(roleId => ({ roleId })) } } : {}) } }), undefined, command, (tx, resultId) => tx.route.findUniqueOrThrow({ where: { id: resultId } }));
  }

  update(id: string, data: Prisma.RouteUpdateInput, actorId?: string, command?: CommandMetadata, roleIds?: string[]) {
    return this.mutate("route.update", "Route", actorId, tx => tx.route.update({ where: { id, deletedAt: null }, data: { ...data, ...(roleIds !== undefined ? { allowedRoles: { deleteMany: {}, create: roleIds.map(roleId => ({ roleId })) } } : {}) } }), id, command, (tx, resultId) => tx.route.findUniqueOrThrow({ where: { id: resultId } }));
  }

  softDelete(id: string, actorId?: string, command?: CommandMetadata) {
    return this.mutate("route.softDelete", "Route", actorId, tx => tx.route.update({ where: { id }, data: { deletedAt: new Date() } }), id, command, (tx, resultId) => tx.route.findUniqueOrThrow({ where: { id: resultId } }));
  }

  // Atomically replace the allowed roles for a route (delete then create).
  async setAllowedRoles(routeId: string, roleIds: string[], actorId?: string): Promise<void> {
    await this.mutate("route.roles", "Route", actorId, async tx => {
      await tx.routeRole.deleteMany({ where: { routeId } });
      if (roleIds.length) await tx.routeRole.createMany({ data: roleIds.map(roleId => ({ routeId, roleId })), skipDuplicates: true });
      return { id: routeId };
    }, routeId);
  }
}
export const routeModel = new RouteModel();
