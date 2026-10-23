/** Audit metadata is separate from mutable/private business content. */
export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  changes?: { before?: unknown; after?: unknown } | null;
}
