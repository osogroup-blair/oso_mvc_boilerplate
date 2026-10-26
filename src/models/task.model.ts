import type { Prisma as PrismaTypes } from "@prisma/client";
import { AppError } from "../lib/AppError.js";
import type { CommandMetadata } from "../lib/command-contracts.js";
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

  private async lockParent(tx: PrismaTypes.TransactionClient, projectId: string | undefined, ownerId?: string) {
    if (!projectId) throw AppError.notFound("Project");
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId} FOR UPDATE`;
    if (!await tx.project.findFirst({ where: { id: projectId, ownerId, deletedAt: null } })) throw AppError.forbidden("Project access changed");
  }

  create(data: Prisma.TaskCreateInput, actorId?: string, command?: CommandMetadata, ownerId?: string) {
    return this.mutate("task.create", "Task", actorId, async tx => {
      await this.lockParent(tx, data.project?.connect?.id, ownerId);
      return tx.task.create({
      data,
      include: {
        taskTags: { include: { tag: true } },
        project: { select: { id: true, name: true } },
      },
    }); }, undefined, command, (tx, resultId) => tx.task.findUniqueOrThrow({ where: { id: resultId }, include: {
        taskTags: { include: { tag: true } },
        project: { select: { id: true, name: true } },
      } }));
  }

  update(id: string, data: Prisma.TaskUpdateInput, actorId?: string, projectId?: string, command?: CommandMetadata, ownerId?: string) {
    return this.mutate("task.update", "Task", actorId, async tx => {
      await this.lockParent(tx, projectId, ownerId);
      return tx.task.update({
      where: { id, projectId, deletedAt: null, project: { deletedAt: null } },
      data,
      include: {
        taskTags: { include: { tag: true } },
        project: { select: { id: true, name: true } },
      },
    }); }, id, command, (tx, resultId) => tx.task.findUniqueOrThrow({ where: { id: resultId }, include: {
        taskTags: { include: { tag: true } },
        project: { select: { id: true, name: true } },
      } }));
  }

  softDelete(id: string, actorId?: string, projectId?: string, command?: CommandMetadata, ownerId?: string) {
    return this.mutate("task.delete", "Task", actorId, async tx => {
      await this.lockParent(tx, projectId, ownerId);
      return tx.task.update({ where: { id, projectId, deletedAt: null, project: { deletedAt: null } }, data: { deletedAt: new Date() } }); }, id, command, (tx, resultId) => tx.task.findUniqueOrThrow({ where: { id: resultId } }));
  }

  // M2M join-table mutations
  addTag(taskId: string, tagId: string, actorId?: string, ownerId?: string, command?: CommandMetadata) {
    return this.mutate("task.tag_add", "Task", actorId, async tx => {
      const task = await tx.task.findFirst({ where: { id: taskId, deletedAt: null } });
      await this.lockParent(tx, task?.projectId, ownerId);
      if (!await tx.tag.findFirst({ where: { id: tagId, deletedAt: null } })) throw AppError.notFound("Tag");
      return tx.taskTag.upsert({ where: { taskId_tagId: { taskId, tagId } }, update: {}, create: { taskId, tagId } });
    }, taskId, command, (tx, id) => tx.taskTag.findUniqueOrThrow({ where: { id } }));
  }

  removeTag(taskId: string, tagId: string, actorId?: string, ownerId?: string, command?: CommandMetadata) {
    return this.mutate("task.tag_remove", "Task", actorId, async tx => {
      const task = await tx.task.findFirst({ where: { id: taskId, deletedAt: null } });
      await this.lockParent(tx, task?.projectId, ownerId);
      const result = await tx.taskTag.deleteMany({ where: { taskId, tagId } });
      return { id: taskId, count: result.count };
    }, taskId, command, async (_tx, id, count) => ({ id, count: count ?? 0 }));
  }
}
