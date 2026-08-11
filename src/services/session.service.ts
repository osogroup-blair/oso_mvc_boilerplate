import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { SessionModel } from "../models/session.model.js";
import { auditService, AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";

export class SessionService extends BaseService {
  constructor(
    private readonly model = new SessionModel(),
    private readonly audit: AuditService = auditService
  ) {
    super("SessionService");
  }

  listActive(params: ListParams) {
    return this.model.listActive(params);
  }

  countActive(search?: string) {
    return this.model.countActive(search);
  }

  async revoke(id: string, actorId?: string) {
    const before = await this.model.findById(id);
    if (!before) {
      throw AppError.notFound("Session");
    }

    const deleted = await this.model.deleteById(id);

    await this.audit.record({
      actorId,
      action: "session.revoke",
      entityType: "Session",
      entityId: id,
      changes: { before },
    });

    return deleted;
  }
}

export const sessionService = new SessionService();
