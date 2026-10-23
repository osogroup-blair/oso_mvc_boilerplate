import type { AuditEntry } from "./audit-contracts.js";

// Explicit metadata vocabulary. Names, document values, free text, URLs, provider
// errors, credentials and tokens are never copied into general audit storage.
const scalarKeys = new Set([
  "id", "status", "version", "expectedVersion", "count", "size", "mimeType",
  "isEnabled", "isActive", "passed", "replayed", "duplicate", "channel", "code",
  "attempt", "requestHash", "contentHash", "snapshotHash", "operationId",
]);
const identifier = /^[A-Za-z0-9_.:@-]{1,160}$/;
function metadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (/password|secret|token|credential|prompt|instruction|document|value|body/i.test(key)) continue;
    if (!(scalarKeys.has(key) || /^[a-zA-Z][a-zA-Z0-9]*(?:Id|Count|Version)$/.test(key))) continue;
    if (typeof item === "boolean" || item === null || typeof item === "number" && Number.isFinite(item)) result[key] = item;
    else if (typeof item === "string" && identifier.test(item)) result[key] = item;
  }
  return Object.keys(result).length ? result : undefined;
}
export function safeAuditEntry(entry: AuditEntry): AuditEntry {
  if (!identifier.test(entry.action) || !identifier.test(entry.entityType)
    || entry.actorId && !identifier.test(entry.actorId) || entry.entityId && !identifier.test(entry.entityId)) {
    throw new Error("Invalid audit event identity");
  }
  return {
    actorId: entry.actorId, action: entry.action, entityType: entry.entityType, entityId: entry.entityId,
    changes: entry.changes ? { before: metadata(entry.changes.before), after: metadata(entry.changes.after) } : undefined,
  };
}
