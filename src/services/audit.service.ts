// Records who changed what. Called from other services' mutating methods.
import { BaseService } from "./BaseService.js";
import { AuditLogModel } from "../models/auditLog.model.js";

export interface AuditEntry {
  actorId?: string | null;
  action: string; // e.g. "user.update"
  entityType: string; // e.g. "User"
  entityId?: string | null;
  changes?: { before?: unknown; after?: unknown } | null;
}

export class AuditService extends BaseService {
  constructor(private readonly model = new AuditLogModel()) {
    super("AuditService");
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.model.create(entry);
    } catch (err) {
      // Auditing must never break the primary operation.
      this.log.error({ err, entry }, "Failed to write audit log");
    }
  }
}

export const auditService = new AuditService();
