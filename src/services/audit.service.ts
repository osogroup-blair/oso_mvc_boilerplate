// Records who changed what. Called from other services' mutating methods.
import { BaseService } from "./BaseService.js";
import { AuditLogModel } from "../models/auditLog.model.js";

import type { AuditEntry } from "../lib/audit-contracts.js";
export type { AuditEntry } from "../lib/audit-contracts.js";
import { safeAuditEntry } from "../lib/audit-policy.js";

export class AuditService extends BaseService {
  constructor(private readonly model = new AuditLogModel()) {
    super("AuditService");
  }

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.model.create(safeAuditEntry(entry));
    } catch (_err) {
      // Auditing must never break the primary operation.
      this.log.error({ code: "AUDIT_WRITE_FAILED" }, "Failed to write audit log");
    }
  }
}

export const auditService = new AuditService();
