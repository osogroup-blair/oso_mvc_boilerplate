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
  create(data: Prisma.NavigationItemUncheckedCreateInput) { return this.db.navigationItem.create({ data }); }
  update(id: string, data: Prisma.NavigationItemUncheckedUpdateInput) { return this.db.navigationItem.update({ where: { id }, data }); }
  softDelete(id: string) { return this.db.navigationItem.update({ where: { id }, data: { deletedAt: new Date() } }); }
  
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
