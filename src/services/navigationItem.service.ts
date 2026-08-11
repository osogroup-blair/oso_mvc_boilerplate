import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { NavigationItemModel } from "../models/navigationItem.model.js";
import { auditService, AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class NavigationItemService extends BaseService {
  constructor(
    private readonly model = new NavigationItemModel(),
    private readonly audit: AuditService = auditService
  ) {
    super("NavigationItemService");
  }

  list(params: ListParams) { return this.model.list(params); }
  count(search?: string) { return this.model.count(search); }
  
  async getTree() {
    return this.model.getTree();
  }

  async getById(id: string) {
    const found = await this.model.findById(id);
    if (!found) throw AppError.notFound("NavigationItem");
    return found;
  }

  async create(data: Prisma.NavigationItemUncheckedCreateInput, actorId?: string) {
    const created = await this.model.create(data);
    await this.audit.record({ actorId, action: "navigationItem.create", entityType: "NavigationItem", entityId: created.id, changes: { after: created } });
    return created;
  }

  async update(id: string, data: Prisma.NavigationItemUncheckedUpdateInput, actorId?: string) {
    const before = await this.getById(id);
    const updated = await this.model.update(id, data);
    await this.audit.record({ actorId, action: "navigationItem.update", entityType: "NavigationItem", entityId: id, changes: { before, after: updated } });
    return updated;
  }

  async remove(id: string, actorId?: string) {
    await this.getById(id);
    const removed = await this.model.softDelete(id);
    await this.audit.record({ actorId, action: "navigationItem.delete", entityType: "NavigationItem", entityId: id });
    return removed;
  }
}

export const navigationItemService = new NavigationItemService();
