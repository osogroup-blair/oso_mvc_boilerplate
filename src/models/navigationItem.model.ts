import type { CommandMetadata } from "../lib/command-contracts.js";
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class NavigationItemModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.NavigationItemWhereInput = {
      ...this.notDeleted,
      ...(params.search ? { label: { contains: params.search, mode: "insensitive" } } : {}),
    };
    return this.db.navigationItem.findMany({ where, skip: params.skip, take: params.take, orderBy: params.orderBy || { order: 'asc' } });
  }

  count(search?: string) {
    return this.db.navigationItem.count({ where: { ...this.notDeleted, ...(search ? { label: { contains: search, mode: "insensitive" } } : {}) } });
  }

  findById(id: string) { return this.db.navigationItem.findFirst({ where: { id, ...this.notDeleted } }); }
  create(data: Prisma.NavigationItemUncheckedCreateInput, actorId?: string, command?: CommandMetadata) { return this.mutate("navigationItem.create", "NavigationItem", actorId, tx => tx.navigationItem.create({ data }), undefined, command, (tx, resultId) => tx.navigationItem.findUniqueOrThrow({ where: { id: resultId } })); }
  update(id: string, data: Prisma.NavigationItemUncheckedUpdateInput, actorId?: string, command?: CommandMetadata) { return this.mutate("navigationItem.update", "NavigationItem", actorId, tx => tx.navigationItem.update({ where: { id }, data }), id, command, (tx, resultId) => tx.navigationItem.findUniqueOrThrow({ where: { id: resultId } })); }
  softDelete(id: string, actorId?: string, command?: CommandMetadata) { return this.mutate("navigationItem.softDelete", "NavigationItem", actorId, tx => tx.navigationItem.update({ where: { id }, data: { deletedAt: new Date() } }), id, command, (tx, resultId) => tx.navigationItem.findUniqueOrThrow({ where: { id: resultId } })); }
  
  // Custom method to get the full tree for rendering
  async getTree() {
    const items = await this.db.navigationItem.findMany({
      where: this.notDeleted,
      orderBy: { order: 'asc' }
    });

    // Build the tree (1-level nesting)
    const roots = items.filter(item => !item.parentId);
    return roots.map(root => ({
      ...root,
      children: items.filter(item => item.parentId === root.id)
    }));
  }
}
