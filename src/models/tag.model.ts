import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class TagModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.TagWhereInput = {
      ...this.notDeleted,
      ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    };
    return this.db.tag.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy ?? { name: "asc" },
    });
  }

  count(search?: string) {
    return this.db.tag.count({
      where: {
        ...this.notDeleted,
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      },
    });
  }

  findById(id: string) {
    return this.db.tag.findFirst({ where: { id, ...this.notDeleted } });
  }

  findByName(name: string) {
    return this.db.tag.findFirst({ where: { name, ...this.notDeleted } });
  }

  create(data: Prisma.TagCreateInput) {
    return this.db.tag.create({ data });
  }

  update(id: string, data: Prisma.TagUpdateInput) {
    return this.db.tag.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.db.tag.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
