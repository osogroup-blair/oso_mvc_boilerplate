import { taskFields } from "../lib/resource-inputs.js";
import { commandMetadata } from "../lib/command-contracts.js";
import { projectService } from "./project.service.js";
import { TagModel } from "../models/tag.model.js";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { TaskModel } from "../models/task.model.js";
import { auditService, type AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class TaskService extends BaseService {
  constructor(
    private readonly model = new TaskModel(),
    private readonly audit: AuditService = auditService,
    private readonly projects = projectService,
    private readonly tags = new TagModel()
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

  async authorize(id: string, actorId: string | undefined, action: "create" | "update" | "delete", projectId?: string) {
    const task = await this.getById(id);
    if (projectId && task.projectId !== projectId) throw AppError.notFound("Task");
    const project = await this.projects.authorize(task.projectId, actorId, action, "task");
    return { ...task, authorizedOwnerId: project.ownerId };
  }

  async create(data: Prisma.TaskCreateInput, actorId?: string, operationId?: string) {
    const projectId = data.project?.connect?.id ?? (data as { projectId?: string }).projectId;
    if (!projectId) throw AppError.badRequest("Project is required");
    const project = await this.projects.authorize(projectId, actorId, "create", "task");
    const fields = taskFields.parse({ title: data.title, description: data.description, status: data.status,
      priority: data.priority, dueDate: data.dueDate, meta: data.meta });
    const created = await this.model.create({ ...fields, project: { connect: { id: projectId } } }, actorId, commandMetadata({ ...fields, projectId }, operationId), project.ownerId);
    await this.audit.record({
      actorId,
      action: "task.create",
      entityType: "Task",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, data: Prisma.TaskUpdateInput, actorId?: string, projectId?: string, operationId?: string) {
    const before = await this.authorize(id, actorId, "update", projectId);
    if (data.project !== undefined || "projectId" in data && data.projectId !== before.projectId) throw AppError.badRequest("Task parent cannot be reassigned here");
    const { projectId: _projectId, ...input } = data as Prisma.TaskUpdateInput & { projectId?: string };
    const fields = taskFields.partial().parse(input);
    const updated = await this.model.update(id, fields, actorId, before.projectId, commandMetadata(fields, operationId), before.authorizedOwnerId);
    await this.audit.record({
      actorId,
      action: "task.update",
      entityType: "Task",
      entityId: id,
      changes: { before, after: updated },
    });
    return updated;
  }

  async remove(id: string, actorId?: string, projectId?: string, operationId?: string) {
    const before = await this.authorize(id, actorId, "delete", projectId);
    const removed = await this.model.softDelete(id, actorId, before.projectId, commandMetadata({ id }, operationId), before.authorizedOwnerId);
    await this.audit.record({
      actorId,
      action: "task.delete",
      entityType: "Task",
      entityId: id,
    });
    return removed;
  }

  // M2M: add a tag to a task via the join table.
  async addTag(taskId: string, tagId: string, actorId?: string, operationId?: string) {
    const task = await this.authorize(taskId, actorId, "update");
    if (!await this.tags.findById(tagId)) throw AppError.notFound("Tag");
    const result = await this.model.addTag(taskId, tagId, actorId, task.authorizedOwnerId, commandMetadata({ taskId, tagId }, operationId));
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
  async removeTag(taskId: string, tagId: string, actorId?: string, operationId?: string) {
    const task = await this.authorize(taskId, actorId, "update");
    const result = await this.model.removeTag(taskId, tagId, actorId, task.authorizedOwnerId, commandMetadata({ taskId, tagId }, operationId));
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
