import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { ProjectModel } from "../models/project.model.js";
import { auditService, type AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class ProjectService extends BaseService {
  constructor(
    private readonly model = new ProjectModel(),
    private readonly audit: AuditService = auditService
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

  async create(data: Prisma.ProjectCreateInput, actorId?: string) {
    const created = await this.model.create(data);
    await this.audit.record({
      actorId,
      action: "project.create",
      entityType: "Project",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, data: Prisma.ProjectUpdateInput, actorId?: string) {
    const before = await this.getById(id);
    const updated = await this.model.update(id, data);
    await this.audit.record({
      actorId,
      action: "project.update",
      entityType: "Project",
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
      action: "project.delete",
      entityType: "Project",
      entityId: id,
    });
    return removed;
  }
}

export const projectService = new ProjectService();
