import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { TagModel } from "../models/tag.model.js";
import { auditService, type AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class TagService extends BaseService {
  constructor(
    private readonly model = new TagModel(),
    private readonly audit: AuditService = auditService
  ) {
    super("TagService");
  }

  list(params: ListParams) {
    return this.model.list(params);
  }

  count(search?: string) {
    return this.model.count(search);
  }

  async getById(id: string) {
    const found = await this.model.findById(id);
    if (!found) throw AppError.notFound("Tag");
    return found;
  }

  async create(data: Prisma.TagCreateInput, actorId?: string) {
    const existing = await this.model.findByName(data.name);
    if (existing) throw AppError.conflict(`Tag "${data.name}" already exists`);
    const created = await this.model.create(data);
    await this.audit.record({
      actorId,
      action: "tag.create",
      entityType: "Tag",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, data: Prisma.TagUpdateInput, actorId?: string) {
    const before = await this.getById(id);
    const updated = await this.model.update(id, data);
    await this.audit.record({
      actorId,
      action: "tag.update",
      entityType: "Tag",
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
      action: "tag.delete",
      entityType: "Tag",
      entityId: id,
    });
    return removed;
  }
}

export const tagService = new TagService();
