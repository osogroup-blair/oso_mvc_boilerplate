import type { CommandMetadata } from "../lib/command-contracts.js";
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class RoleModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.RoleWhereInput = {
      ...this.notDeleted,
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" } },
              { description: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return this.db.role.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
    });
  }

  count(search?: string) {
    return this.db.role.count({
      where: {
        ...this.notDeleted,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    });
  }

  findById(id: string) {
    return this.db.role.findFirst({
      where: { id, ...this.notDeleted },
    });
  }

  findByName(name: string) {
    return this.db.role.findUnique({
      where: { name },
    });
  }

  findFirst() {
    return this.db.role.findFirst({
      where: this.notDeleted,
      orderBy: { name: "asc" },
    });
  }

  // Returns all active roles - used for relation dropdowns and permission matrix.
  listAll() {
    return this.db.role.findMany({
      where: this.notDeleted,
      orderBy: { name: "asc" },
    });
  }

  // Returns a role with its full permissions array.
  findWithPermissions(id: string) {
    return this.db.role.findFirst({
      where: { id, ...this.notDeleted },
    });
  }


  listWithUserCounts() {
    return this.db.role.findMany({
      where: this.notDeleted,
      include: {
        _count: {
          select: { users: { where: { deletedAt: null } } },
        },
      },
      orderBy: { name: "asc" },
    });
  }
  replacePermissions(entries: Array<{ id: string; permissions: string[] }>, actorId: string, command?: CommandMetadata) {
    return this.mutate("role.permissions.matrix", "Role", actorId, async tx => {
      for (const entry of entries) await tx.role.update({ where: { id: entry.id, deletedAt: null }, data: { permissions: entry.permissions } });
      return { id: "matrix", count: entries.length };
    }, "matrix", command, async () => ({ id: "matrix", count: entries.length }));
  }

  create(data: Prisma.RoleCreateInput, actorId?: string, command?: CommandMetadata) {
    return this.mutate("role.create", "Role", actorId, tx => tx.role.create({ data }), undefined, command, (tx, resultId) => tx.role.findUniqueOrThrow({ where: { id: resultId } }));
  }

  update(id: string, data: Prisma.RoleUpdateInput, actorId?: string, command?: CommandMetadata) {
    return this.mutate("role.update", "Role", actorId, tx => tx.role.update({ where: { id }, data }), id, command, (tx, resultId) => tx.role.findUniqueOrThrow({ where: { id: resultId } }));
  }

  softDelete(id: string, actorId?: string, command?: CommandMetadata) {
    return this.mutate("role.softDelete", "Role", actorId, tx => tx.role.update({
      where: { id },
      data: { deletedAt: new Date() },
    }), id, command, (tx, resultId) => tx.role.findUniqueOrThrow({ where: { id: resultId } }));
  }
}

export const roleModel = new RoleModel();


