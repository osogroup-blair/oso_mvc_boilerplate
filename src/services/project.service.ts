import { projectFields } from "../lib/resource-inputs.js";
import { commandMetadata } from "../lib/command-contracts.js";
import { actorAccessService } from "./actor-access.service.js";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { ProjectModel } from "../models/project.model.js";
import { auditService, type AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";

export class ProjectService extends BaseService {
  constructor(
    private readonly model = new ProjectModel(),
    private readonly audit: AuditService = auditService,
    private readonly access = actorAccessService
  ) {
    super("ProjectService");
  }

  list(params: ListParams) {
    return this.model.list(params);
  }

  count(search?: string) {
    return this.model.count(search);
  }

  async getById(id: string) {
    const found = await this.model.findById(id);
    if (!found) throw AppError.notFound("Project");
    return found;
  }

  async authorize(id: string, actorId: string | undefined, action: "update" | "delete" | "create" = "update", resource = "project") {
    const actor = await this.access.actor(actorId);
    const project = await this.getById(id);
    if (project.ownerId !== actor.id && !(this.access.can(actor, "admin:access") && this.access.can(actor, `${resource}:${action}`))) {
      throw AppError.forbidden("Project access denied");
    }
    return project;
  }

  async canEdit(id: string, actorId?: string) {
    if (!actorId) return false;
    try { await this.authorize(id, actorId); return true; }
    catch (error) { if (error instanceof AppError && error.statusCode === 403) return false; throw error; }
  }

  async create(data: Prisma.ProjectCreateInput, actorId?: string, operationId: string = randomUUID()) {
    const actor = await this.access.actor(actorId);
    const ownerId = data.owner?.connect?.id ?? (data as { ownerId?: string }).ownerId ?? actor.id;
    if (ownerId !== actor.id && !(this.access.can(actor, "admin:access") && this.access.can(actor, "project:create"))) throw AppError.forbidden();
    const fields = projectFields.parse({ name: data.name, description: data.description, status: data.status });
    return this.model.createWithReceipt({ ...fields, owner: { connect: { id: ownerId } } }, actorId, operationId);
  }

  async update(id: string, data: Prisma.ProjectUpdateInput, actorId?: string, operationId?: string) {
    const before = await this.authorize(id, actorId);
    if (data.owner !== undefined || "ownerId" in data && data.ownerId !== before.ownerId) throw AppError.badRequest("Project ownership cannot be reassigned here");
    const { ownerId: _ownerId, ...input } = data as Prisma.ProjectUpdateInput & { ownerId?: string };
    const fields = projectFields.partial().parse(input);
    const updated = await this.model.update(id, fields, actorId, before.ownerId, commandMetadata(fields, operationId));
    await this.audit.record({
      actorId,
      action: "project.update",
      entityType: "Project",
      entityId: id,
      changes: { before, after: updated },
    });
    return updated;
  }

  async remove(id: string, actorId?: string, operationId?: string) {
    const before = await this.authorize(id, actorId, "delete");
    const removed = await this.model.softDelete(id, actorId, before.ownerId, commandMetadata({ id }, operationId));
    await this.audit.record({
      actorId,
      action: "project.delete",
      entityType: "Project",
      entityId: id,
    });
    return removed;
  }
}

export const projectService = new ProjectService();
