import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class TaskModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams & { projectId?: string }) {
    const where: Prisma.TaskWhereInput = {
      ...this.notDeleted,
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.search ? { title: { contains: params.search, mode: "insensitive" } } : {}),
    };
    return this.db.task.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy ?? { createdAt: "asc" },
      include: {
        taskTags: { include: { tag: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }

  count(search?: string, projectId?: string) {
    return this.db.task.count({
      where: {
        ...this.notDeleted,
        ...(projectId ? { projectId } : {}),
        ...(search ? { title: { contains: search, mode: "insensitive" } } : {}),
      },
    });
  }

  findById(id: string) {
    return this.db.task.findFirst({
      where: { id, ...this.notDeleted },
      include: {
        taskTags: { include: { tag: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }

  create(data: Prisma.TaskCreateInput) {
    return this.db.task.create({
      data,
      include: {
        taskTags: { include: { tag: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }

  update(id: string, data: Prisma.TaskUpdateInput) {
    return this.db.task.update({
      where: { id },
      data,
      include: {
        taskTags: { include: { tag: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }

  softDelete(id: string) {
    return this.db.task.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  // M2M join-table mutations
  addTag(taskId: string, tagId: string) {
    return this.db.taskTag.create({ data: { taskId, tagId } });
  }

  removeTag(taskId: string, tagId: string) {
    return this.db.taskTag.deleteMany({ where: { taskId, tagId } });
  }
}
