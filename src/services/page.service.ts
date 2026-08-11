// CMS page business logic. Mirrors UserService exactly (see SKILL-service.md).
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { PageModel } from "../models/page.model.js";
import { auditService, AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

// The admin form submits allowedRoles as an array of role IDs from the
// multiRelation field. We strip it before calling Prisma and handle it
// separately via setAllowedRoles so Prisma never sees the non-column key.
type PageWriteData = Prisma.PageCreateInput & { allowedRoles?: string[] };

export class PageService extends BaseService {
  constructor(
    private readonly model = new PageModel(),
    private readonly audit: AuditService = auditService
  ) {
    super("PageService");
  }

  list(params: ListParams) {
    return this.model.list(params);
  }

  count(search?: string) {
    return this.model.count(search);
  }

  async getById(id: string) {
    const page = await this.model.findById(id);
    if (!page) throw AppError.notFound("Page");
    return page;
  }

  // Used by the public renderer. Returns null (not throw) so the controller
  // can decide how to present a missing page.
  getPublishedBySlug(slug: string) {
    return this.model.findPublishedBySlug(slug);
  }

  getPublishedPages() {
    return this.model.findPublishedPages();
  }

  async create(data: PageWriteData, actorId?: string) {
    const { allowedRoles: roleIds, ...prismaData } = data;
    const created = await this.model.create(prismaData as Prisma.PageCreateInput);
    if (roleIds && roleIds.length > 0) {
      await this.model.setAllowedRoles(created.id, roleIds);
    }
    await this.audit.record({
      actorId,
      action: "page.create",
      entityType: "Page",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, data: PageWriteData, actorId?: string) {
    const before = await this.getById(id);
    const { allowedRoles: roleIds, ...prismaData } = data;
    const updated = await this.model.update(id, prismaData as Prisma.PageUpdateInput);
    // Always sync the role list (empty array = clear all; undefined = leave untouched).
    if (roleIds !== undefined) {
      await this.model.setAllowedRoles(id, roleIds);
    }
    await this.audit.record({
      actorId,
      action: "page.update",
      entityType: "Page",
      entityId: id,
      changes: { before, after: updated },
    });
    return updated;
  }

  async remove(id: string, actorId?: string) {
    await this.getById(id);
    const removed = await this.model.softDelete(id);
    await this.audit.record({ actorId, action: "page.delete", entityType: "Page", entityId: id });
    return removed;
  }
}

export const pageService = new PageService();
