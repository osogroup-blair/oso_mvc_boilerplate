---
name: creating-a-service
description: Use when adding business logic — a new domain service or a method on one. Covers the BaseService pattern, constructor dependency injection for testability, audit/permission integration, error handling, and singleton export.
---

# SKILL: Creating a Service

Services hold **business logic**. They orchestrate models, permissions, audit,
and other services. Controllers call services; services call models.

## Rules
- One service per domain concept (`UserService`, `BillingService`, `EmailService`).
- Extend `BaseService` and pass the service name to `super()` (gives you `this.log`).
- Inject dependencies via the constructor with sensible defaults. This makes the
  service unit-testable (pass mocks in tests, defaults in production).
- Services **never** import Prisma directly — they call models.
- Services **never** touch `req`/`res` — that is the controller's job.
- Throw `AppError` for expected failures (not found, forbidden, conflict).
- Record an audit entry after any create/update/delete via `AuditService`.
- Export a shared singleton instance at the bottom.

## Template
```ts
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { WidgetModel } from "../models/widget.model.js";
import { auditService, AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class WidgetService extends BaseService {
  constructor(
    private readonly model = new WidgetModel(),
    private readonly audit: AuditService = auditService
  ) {
    super("WidgetService");
  }

  list(params: ListParams) { return this.model.list(params); }
  count(search?: string) { return this.model.count(search); }

  async getById(id: string) {
    const found = await this.model.findById(id);
    if (!found) throw AppError.notFound("Widget");
    return found;
  }

  async create(data: Prisma.WidgetCreateInput, actorId?: string) {
    const created = await this.model.create(data);
    await this.audit.record({ actorId, action: "widget.create", entityType: "Widget", entityId: created.id, changes: { after: created } });
    return created;
  }

  async update(id: string, data: Prisma.WidgetUpdateInput, actorId?: string) {
    const before = await this.getById(id);
    const updated = await this.model.update(id, data);
    await this.audit.record({ actorId, action: "widget.update", entityType: "Widget", entityId: id, changes: { before, after: updated } });
    return updated;
  }

  async remove(id: string, actorId?: string) {
    await this.getById(id);
    const removed = await this.model.softDelete(id);
    await this.audit.record({ actorId, action: "widget.delete", entityType: "Widget", entityId: id });
    return removed;
  }
}

export const widgetService = new WidgetService();
```

## Reference implementation
`src/services/user.service.ts` — copy its shape exactly.


## October 20 blueprint contract update

The current contracts and limits are in `docs/blueprint/EXTENSION-CONTRACTS.md`
and `docs/blueprint/DECISIONS.md`. Models may own transactional command/receipt
persistence while services own authorization/business policy. Private files
require an explicit policy rather than a permissive singleton. General audit
uses metadata only. Tenant admin adapters must resolve access before record or
option reads and delegate CAS/receipt semantics to resource services/models.
Existing self-hosted Temporal executions require reviewed prior histories
before Workflow command changes; an empty corpus is a blocked release gate.


## October 26 audit remediation contract

Use ActorAccessService (injected for tests) for current actor checks in protected account/project/task/organization commands. Pass an optional stable operation UUID through commandMetadata(input, operationId) to model commands. Model-owned state/evidence transactions are authoritative; a later AuditService.record is operational telemetry. See MUTATION-EVIDENCE-MATRIX.md for staged/external effects and replay limitations. The older template above illustrates layering, not sufficient authorization or authoritative audit.

See `docs/blueprint/EXTERNAL-AUDIT-IMPLEMENTATION-2026-10-26.md` and
`docs/blueprint/MUTATION-EVIDENCE-MATRIX.md` for scope and verification.
