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
  create(data: Prisma.RoleCreateInput) {
    return this.db.role.create({ data });
  }

  update(id: string, data: Prisma.RoleUpdateInput) {
    return this.db.role.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.db.role.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export const roleModel = new RoleModel();


