import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { TaskModel } from "../models/task.model.js";
import { auditService, type AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class TaskService extends BaseService {
  constructor(
    private readonly model = new TaskModel(),
    private readonly audit: AuditService = auditService
  ) {
    super("TaskService");
  }

  list(params: ListParams & { projectId?: string }) {
    return this.model.list(params);
  }

  count(search?: string, projectId?: string) {
    return this.model.count(search, projectId);
  }

  async getById(id: string) {
    const found = await this.model.findById(id);
    if (!found) throw AppError.notFound("Task");
    return found;
  }

  async create(data: Prisma.TaskCreateInput, actorId?: string) {
    const created = await this.model.create(data);
    await this.audit.record({
      actorId,
      action: "task.create",
      entityType: "Task",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, data: Prisma.TaskUpdateInput, actorId?: string) {
    const before = await this.getById(id);
    const updated = await this.model.update(id, data);
    await this.audit.record({
      actorId,
      action: "task.update",
      entityType: "Task",
      entityId: id,
      changes: { before, after: updated },
    });
    return updated;
  }

  async remove(id: string, actorId?: string) {
    await this.getById(id);
    const removed = await this.model.softDelete(id);
    await this.audit.record({
      actorId,
      action: "task.delete",
      entityType: "Task",
      entityId: id,
    });
    return removed;
  }

  // M2M: add a tag to a task via the join table.
  async addTag(taskId: string, tagId: string, actorId?: string) {
    await this.getById(taskId); // ensures task exists and is not soft-deleted
    const result = await this.model.addTag(taskId, tagId);
    await this.audit.record({
      actorId,
      action: "task.tag_add",
      entityType: "Task",
      entityId: taskId,
      changes: { after: { tagId } },
    });
    return result;
  }

  // M2M: remove a tag from a task via the join table.
  async removeTag(taskId: string, tagId: string, actorId?: string) {
    await this.getById(taskId); // ensures task exists and is not soft-deleted
    const result = await this.model.removeTag(taskId, tagId);
    await this.audit.record({
      actorId,
      action: "task.tag_remove",
      entityType: "Task",
      entityId: taskId,
      changes: { before: { tagId } },
    });
    return result;
  }
}

export const taskService = new TaskService();
