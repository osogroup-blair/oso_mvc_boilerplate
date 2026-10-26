---
name: using-cross-cutting-services
description: Use when a feature needs authentication, authorization/permissions,
  caching, file storage, or audit logging. Explains when and how to use each
  shared service (AuthService, PermissionsService, CacheService, StorageService,
  AuditService) rather than reinventing them inline.
---

# SKILL: Using Cross-Cutting Services

Five shared services handle concerns that span features. Use them — do not
reinvent auth, caching, or file handling inside a domain service.

## AuthService and permissions

`AuthService` implements salted scrypt password hashing and database-backed
session verification. Use `requireAuth`; it attaches the actor to `req.user`.
`permissionsService.assert(roleName, "resource:action")` checks a role name;
`permissionsService.can(roleId, resource, action)` checks a role ID. The
permission vocabulary is `DEFINED_PERMISSIONS`, not a hardcoded MATRIX.
Domain services must additionally check current org membership and resource
ownership/assignment. A hidden org ID never proves access.

## CacheService

`get<T>(key)`, `set(key, value, ttlSeconds)` and `del(key)` use an in-memory map.
Invalidate on writes. Do not cache current per-request authorization as if it
were immutable.

## Public and private storage

The existing public `StorageService` exposes `upload(key, buffer, mimeType)`
returning `{url, provider}`, and `delete(key, provider)`. It has no `put` or
`get` method. Public Asset remains the media library.

For protected bytes use `PrivateAssetService` with a mandatory domain policy,
scoped identity and stable operation UUID. It provides bounded integrity-checked
`upload/read/recoverUpload/remove` on a separate local backend/table with no
public URL. See `SKILL-private-assets.md`. S3 private storage is not accepted.

## Audit and commands

`auditService.record({actorId, action, entityType, entityId, changes})` applies
a metadata allowlist. Use `changes.after: {status, version, count}` or approved
identifier/hash fields; do not supply raw document/model/prompt/token payloads.
Failures are best-effort telemetry with safe codes. Historical rows are unchanged.

When evidence is authoritative, have the model commit it with the state in one
transaction. `ProjectModel.createWithReceipt` is the replayable command reference:
state+receipt commit together, same operation and input replay one result, changed
input conflicts, receipt failure rolls back. Services keep authorization and
validation; transaction objects stay inside models. Do not infer that every
resource mutation already has this guarantee.

## Provider resolution

Direct callers use `IntegrationConnectionResolverService.resolve` with org,
provider and capability requirements. Workflow callers select bindings through
`IntegrationResolverService`, which delegates secret/adapter construction to
that same primitive. Keep returned adapters/secrets out of Workflows and views.

See `docs/blueprint/EXTENSION-CONTRACTS.md` for security and acceptance limits.


## October 26 audit remediation contract

BaseModel.mutate commits metadata evidence and state together, with optional typed command receipts and safe replay readers. Preserve existing workflow/private ledgers rather than layering an independent engine over them. General AuditService is still best-effort telemetry. Public media uses byte/type/extension checks, bounded raster re-encoding, generated keys, download/sandbox/nosniff headers and a separate policy from PrivateAsset. Remote S3/CDN headers and legacy-object inventory need deployment acceptance.

See `docs/blueprint/EXTERNAL-AUDIT-IMPLEMENTATION-2026-10-26.md` and
`docs/blueprint/MUTATION-EVIDENCE-MATRIX.md` for scope and verification.
