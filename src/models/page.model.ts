import type { CommandMetadata } from "../lib/command-contracts.js";
// Page data access. Soft-delete aware, like every model.
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class PageModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.PageWhereInput = {
      ...this.notDeleted,
      ...(params.search
        ? {
            OR: [
              { title: { contains: params.search, mode: "insensitive" } },
              { slug: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return this.db.page.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
      include: { allowedRoles: { include: { role: true } } },
    });
  }

  count(search?: string) {
    return this.db.page.count({
      where: {
        ...this.notDeleted,
        ...(search
          ? { OR: [{ title: { contains: search, mode: "insensitive" } }, { slug: { contains: search, mode: "insensitive" } }] }
          : {}),
      },
    });
  }

  findById(id: string) {
    return this.db.page.findFirst({
      where: { id, ...this.notDeleted },
      include: { allowedRoles: { include: { role: true } } },
    });
  }

  // Public lookup: only PUBLISHED pages are ever served to visitors.
  findPublishedBySlug(slug: string) {
    return this.db.page.findFirst({
      where: { slug, status: "PUBLISHED", ...this.notDeleted },
      include: { allowedRoles: { include: { role: true } } },
    });
  }

  findPublishedPages() {
    return this.db.page.findMany({
      where: { status: "PUBLISHED", ...this.notDeleted },
      orderBy: { title: "asc" },
      include: { allowedRoles: { include: { role: true } } },
    });
  }

  create(data: Prisma.PageCreateInput, actorId?: string, command?: CommandMetadata, roleIds?: string[]) {
    return this.mutate("page.create", "Page", actorId, tx => tx.page.create({ data: { ...data, ...(roleIds ? { allowedRoles: { create: roleIds.map(roleId => ({ roleId })) } } : {}) } }), undefined, command, (tx, resultId) => tx.page.findUniqueOrThrow({ where: { id: resultId } }));
  }

  update(id: string, data: Prisma.PageUpdateInput, actorId?: string, command?: CommandMetadata, roleIds?: string[]) {
    return this.mutate("page.update", "Page", actorId, tx => tx.page.update({ where: { id, deletedAt: null }, data: { ...data, ...(roleIds !== undefined ? { allowedRoles: { deleteMany: {}, create: roleIds.map(roleId => ({ roleId })) } } : {}) } }), id, command, (tx, resultId) => tx.page.findUniqueOrThrow({ where: { id: resultId } }));
  }

  softDelete(id: string, actorId?: string, command?: CommandMetadata) {
    return this.mutate("page.softDelete", "Page", actorId, tx => tx.page.update({ where: { id }, data: { deletedAt: new Date() } }), id, command, (tx, resultId) => tx.page.findUniqueOrThrow({ where: { id: resultId } }));
  }

  async setAllowedRoles(pageId: string, roleIds: string[], actorId?: string): Promise<void> {
    await this.mutate("page.roles", "Page", actorId, async tx => {
      await tx.pageRole.deleteMany({ where: { pageId } });
      if (roleIds.length) await tx.pageRole.createMany({ data: roleIds.map(roleId => ({ pageId, roleId })), skipDuplicates: true });
      return { id: pageId };
    }, pageId);
  }
}
export const pageModel = new PageModel();
