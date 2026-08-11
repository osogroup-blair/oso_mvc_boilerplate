import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class ProjectModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.ProjectWhereInput = {
      ...this.notDeleted,
      ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    };
    return this.db.project.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy ?? { createdAt: "desc" },
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { tasks: { where: { deletedAt: null } } } },
      },
    });
  }

  count(search?: string) {
    return this.db.project.count({
      where: {
        ...this.notDeleted,
        ...(search ? { name: { contains: search, mode: "insensitive" } } : {}),
      },
    });
  }

  // Eager-loads tasks + their tags so the controller can hand a complete
  // payload to the view without N+1 queries.
  findById(id: string) {
    return this.db.project.findFirst({
      where: { id, ...this.notDeleted },
      include: {
        owner: { select: { id: true, name: true } },
        tasks: {
          where: { deletedAt: null },
          include: {
            taskTags: {
              include: { tag: true },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  create(data: Prisma.ProjectCreateInput) {
    return this.db.project.create({ data });
  }

  update(id: string, data: Prisma.ProjectUpdateInput) {
    return this.db.project.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.db.project.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
