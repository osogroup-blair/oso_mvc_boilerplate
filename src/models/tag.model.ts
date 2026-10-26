import type { CommandMetadata } from "../lib/command-contracts.js";
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

  create(data: Prisma.TagCreateInput, actorId?: string, command?: CommandMetadata) {
    return this.mutate("tag.create", "Tag", actorId, tx => tx.tag.create({ data }), undefined, command, (tx, resultId) => tx.tag.findUniqueOrThrow({ where: { id: resultId } }));
  }

  update(id: string, data: Prisma.TagUpdateInput, actorId?: string, command?: CommandMetadata) {
    return this.mutate("tag.update", "Tag", actorId, tx => tx.tag.update({ where: { id }, data }), id, command, (tx, resultId) => tx.tag.findUniqueOrThrow({ where: { id: resultId } }));
  }

  softDelete(id: string, actorId?: string, command?: CommandMetadata) {
    return this.mutate("tag.softDelete", "Tag", actorId, tx => tx.tag.update({ where: { id }, data: { deletedAt: new Date() } }), id, command, (tx, resultId) => tx.tag.findUniqueOrThrow({ where: { id: resultId } }));
  }
}
