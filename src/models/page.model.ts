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

  create(data: Prisma.PageCreateInput) {
    return this.db.page.create({ data });
  }

  update(id: string, data: Prisma.PageUpdateInput) {
    return this.db.page.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.db.page.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // Atomically replace the allowed roles for a page (delete then create).
  async setAllowedRoles(pageId: string, roleIds: string[]): Promise<void> {
    await this.db.pageRole.deleteMany({ where: { pageId } });
    if (roleIds.length > 0) {
      await this.db.pageRole.createMany({
        data: roleIds.map((roleId) => ({ pageId, roleId })),
        skipDuplicates: true,
      });
    }
  }
}

export const pageModel = new PageModel();

