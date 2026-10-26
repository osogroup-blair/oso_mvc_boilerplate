import { actorAccessService } from "./actor-access.service.js";
import { commandMetadata } from "../lib/command-contracts.js";
import { BaseService } from "./BaseService.js";
import { SessionModel } from "../models/session.model.js";
import { auditService, AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";

export class SessionService extends BaseService {
  constructor(
    private readonly model = new SessionModel(),
    private readonly audit: AuditService = auditService,
    private readonly access = actorAccessService
  ) {
    super("SessionService");
  }

  listActive(params: ListParams) {
    return this.model.listActive(params);
  }

  countActive(search?: string) {
    return this.model.countActive(search);
  }

  async revoke(id: string, actorId?: string, operationId?: string) {
    await this.access.require(actorId, "session:revoke");
    const deleted = await this.model.deleteById(id, actorId, commandMetadata({ id }, operationId));

    await this.audit.record({
      actorId,
      action: "session.revoke",
      entityType: "Session",
      entityId: id,

    });

    return deleted;
  }
}

export const sessionService = new SessionService();
