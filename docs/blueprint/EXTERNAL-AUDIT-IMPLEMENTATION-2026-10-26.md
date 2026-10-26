# External audit implementation — October 26, 2026

Implementation packages R1–R6 are implemented in the working tree. This is local source/runtime verification, not a deployment approval. The original source validation and file-level blueprint are in [the remediation plan](EXTERNAL-AUDIT-REMEDIATION-PLAN-2026-10-26.md); the precise state/evidence and external-effect guarantees are in [the mutation matrix](MUTATION-EVIDENCE-MATRIX.md).

## Package disposition

| Package / findings | Implemented behavior |
|---|---|
| R1 — F1, F8 | User-directory reads require authentication and user:read. Safe user/session selects and explicit authentication DTOs exclude hashes, token records and arbitrary relations. Creation requires an explicit bounded password; updates preserve a blank password. User writes require current actor authority; role assignment requires role:update. Login return paths are restricted to local paths, including encoded/backslash/control bypass checks. Validation rendering excludes passwords. |
| R2 — F3, F6 | Protected admin routes require admin:access plus section permissions. Upload permission precedes multipart parsing; all queue APIs share queue:admin. Logs, settings, sessions, media and permission-matrix reads/writes are gated. Counts, relation options and sidebar links respect read permissions. A shared vocabulary defines every registered CRUD action plus sensitive section permissions; the development seed derives fresh-admin grants from it. |
| R3 — F2 | Current actors must own the active project or hold explicit admin plus operation authority. Tasks are authorized through their actual parent; a different parent in a nested URL returns 404. Writes lock/recheck parent/owner constraints. Parent/owner reassignment is rejected by these ordinary forms. Tag mutations authorize the parent and use transactional evidence. Public demo reads remain intentional. |
| R4 — F4 | Organization list/detail/member options are scoped before protected reads. OWNER/ADMIN/member rules prevent self-promotion and changes to another tenant. Explicit organization:admin is the cross-tenant override. Organization plus initial owner is atomic; shared organization locking prevents concurrent last-owner removal. A removed member may be deliberately re-added under the same policy. Global user choices additionally require user:read; other managers can supply a known user ID. |
| R5 — F7 | Model-owned transactions commit database mutations and metadata evidence together. Ordinary CRUD, permission/settings groups, org ownership, auth/session transitions, public metadata, workflow catalog/projection/task/schedule/integration/effect updates and startup inventory now use that boundary or their existing authoritative ledgers. Stable identities/fingerprints/replay readers are wired through ordinary resource services and admin/API/forms; existing workflow/private-file identities are retained. General AuditService remains best-effort telemetry. See the matrix for replay and staged/external-effect limits. |
| R6 — F5 | Uploads compare actual bytes, MIME and extension; reject HTML/SVG and malformed/mismatched content; re-encode real raster images under pixel/frame/byte limits; derive storage extensions and sizes. Local upload aliases and broad static delivery use explicit content types, nosniff, sandbox policies and attachment headers for non-raster/legacy objects. S3 writes set verified MIME and disposition. Application CSP uses script nonces and external delegated UI actions. Physical delete failures propagate; failed metadata publication attempts byte cleanup. |

## Compatibility fixes found during execution

- Public registration formerly fell back to the first available role when the mixed-case default name was absent. It now requests USER exactly and fails closed instead of risking a privileged assignment.
- The settings controller formerly ignored displayed storage keys. Validation now derives supported fields from the registry, retains specific constraints, accepts partial updates, handles unchecked booleans only for a full-form submit, and validates public storage locations/prefixes before commit. Cache reloads from committed state on replay.
- Database record IDs are strings, and the development seed deliberately uses named IDs such as seed-project-alpha. Public record parameters use a bounded identifier schema; command IDs remain UUIDs.
- Inline event attributes moved to explicit delegated actions in public/js/ui-actions.js. Nonced inline script blocks and existing admin/queue/form behavior remain usable under CSP.
- The new decoder requires Node 20.9+. The detector is the Node-20-compatible 21.x branch. Existing locked dependency versions were preserved; only the upload dependencies and required transitive entries were added.

## Validation

- `npm run typecheck`, `npm run lint`, `npm run check:architecture`, and `npm run build`: passed.
- `npm test`: **254 tests across 50 files passed**. The Prisma fail-closed unit guard remains enabled.
- Owned PostgreSQL: **17 tests across 5 files**, including injected evidence failures, grouped permission/settings rollback, private-file/workflow contracts, concurrent receipts and ownership races.
- Owned Chromium/Redis: directory authentication and DTOs, admin section denial, cross-owner writes, nested task mismatch, cross-org role changes, disguised uploads, legacy-file nonexecution/headers, custom upload prefixes, safe login redirect, queue CSRF and existing UI/consumer-adapter flows.
- Owned built Worker/Temporal: process drain/restart, integration failure semantics, webhook delivery/retry, reliability and replay drills, TLS/mTLS/payload transport, restore/failure recovery.
- Whitespace checked with the repository lockfile's existing CRLF format preserved (`git -c core.whitespace=cr-at-eol diff --check`).

Final owned runtime: **f07574a6-e07c-41e0-9533-df7462ff646f**, result PASS. Evidence: [run result](../../artifacts/platform-f07574a6-e07c-41e0-9533-df7462ff646f/result.json), [SQL results](../../artifacts/platform-f07574a6-e07c-41e0-9533-df7462ff646f/integration.log), and [browser checks](../../artifacts/platform-f07574a6-e07c-41e0-9533-df7462ff646f/browser-results.json). This run includes the final locked detector, restrictive legacy content-type assertion, validation-render review and domain-separated command fingerprints. The runner removed its owned database, Redis/Temporal containers and network after completion; artifact files are retained locally and ignored by Git.

## Operational handoff

1. Snapshot/review deployed role grants. Existing administrators already retain the permission-matrix path, but new session/media/queue/organization/project/task permissions need explicit least-privilege grants. Do not run prisma/seed.ts on deployed data: it overwrites sample credentials and role permissions.
2. Treat authenticated user-directory access and narrower account responses as intentional API changes. Account creation callers must supply a password and have role-assignment authority. Named record IDs remain supported. Operation keys must be stable UUIDs when retry protection is needed.
3. Inventory legacy public files and any confidential data previously published there. Local legacy/unknown files are sandboxed and forced to download with non-executable MIME; real S3/CDN headers, isolated origins and stale cache invalidation still require deployment-specific verification. No existing user objects were quarantined/deleted by this task.
4. If a deployed instance exposed hashes or used predictable provisioned credentials, inventory affected accounts and plan appropriate credential/session remediation. No production access, credential rotation or bulk logout was performed.
5. Keep the request-fingerprint key stable during a retry window. Key rotation makes old fingerprints conflict safely; it does not silently replay a changed command. Preserve authoritative receipts, private volumes and workflow journals during rollback.
6. Existing production Temporal acceptance remains blocked on reviewed deployed history/release/key inventory, actual topology/restore objectives and monitoring ownership. An empty production replay corpus remains a failed release gate by design. No Workflow command sequence was changed for this remediation.

## Separate dependency-audit boundary

A read-only npm audit reports **21 existing advisories: 8 moderate, 9 high, 4 critical**. They involve existing packages such as the template/HTTP stack and test tooling; neither new upload dependency is flagged. Existing package versions were not force-upgraded during this implementation because that is a separate compatibility/migration workstream. This code remediation does not certify a clean dependency audit or production readiness.

No application database, external account, deployed role, public object store, remote repository setting or production infrastructure was changed. Runtime tests created and removed owned disposable fixtures. No commit, push or deployment was performed.
