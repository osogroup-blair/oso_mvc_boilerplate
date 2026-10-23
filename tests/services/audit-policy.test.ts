import { expect, it, vi } from "vitest";
import { AuditService } from "../../src/services/audit.service.js";
import { safeAuditEntry } from "../../src/lib/audit-policy.js";

it("keeps safe event metadata while excluding private document/provider/token content", () => {
  const canary = "PRIVATE DOCUMENT CANARY";
  const safe = safeAuditEntry({ actorId: "synthetic-user", action: "revision.update", entityType: "Revision", entityId: "revision-1",
    changes: { before: { version: 2, value: canary }, after: { version: 3, contentHash: "a1b2", passwordHash: "private-hash", document: { title: canary }, token: canary, error: canary } } });
  expect(safe.changes).toEqual({ before: { version: 2 }, after: { version: 3, contentHash: "a1b2" } });
  expect(JSON.stringify(safe)).not.toContain(canary);
});

it("failure logs do not serialize a private entry or its database error", async () => {
  const model = { create: vi.fn().mockRejectedValue(new Error("PRIVATE DB ERROR")) };
  const service = new AuditService(model as never);
  const error = vi.spyOn((service as any).log, "error");
  await service.record({ action: "revision.update", entityType: "Revision", changes: { after: { value: "PRIVATE VALUE" } } });
  expect(JSON.stringify(model.create.mock.calls)).not.toContain("PRIVATE VALUE");
  expect(JSON.stringify(error.mock.calls)).not.toContain("PRIVATE");
  expect(error).toHaveBeenCalledWith({ code: "AUDIT_WRITE_FAILED" }, "Failed to write audit log");
});
