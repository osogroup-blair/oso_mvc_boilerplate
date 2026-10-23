# Boilerplate improvements — local execution report, October 20, 2026

The boilerplate implementation and the locally executable acceptance work are complete. Production rollout remains blocked on the actual deployed Temporal release/history inventory and deployment-specific acceptance. Solution Intent consumer adoption is a separate workstream and was not modified by this execution.

Checkout: `/home/blair/Development/boilerplate/mvc-boilerplate`, resolving to `/srv/lab/Applications/boilerplate/mvc-boilerplate`. Original HEAD: `1582ae5d91129251380ce72716f4d480f76211b1`; this checkout already contained substantial uncommitted work. The task patch compares against the preserved pre-execution files, rather than attributing every dirty file to this task. No commit, push, production connection, application database migration or deployment was performed.

## Implementation

- Safe testing and architecture: fail-closed unit Prisma guard, no implicit test dotenv, owned database/process/browser identities, AST architecture checks and CI source workflows.
- Browser safety: CSRF across browser forms, bounded multipart verification, Bull Board XSRF integration and late queue binding, POST refresh, truthful static policy metadata and server-enforced read-only records.
- Audit/commands: bounded metadata-only audit and safe driver/HTTP/provider error classifications; model-owned atomic command receipts, operation identity and optimistic version checks. This establishes reference patterns, not an automatic conversion of all legacy commands.
- Extension APIs: private assets in a separate additive table with mandatory current resource policy, checksum/backend/no-follow protection and recoverable transitions; shared scoped integration connection resolution; neutral tenant-admin adapters and accessible validation recovery. Two SQL-backed admin resources, distinct private-file policies and task policies demonstrate reuse without product branches in common code.
- Recoverable starts: encrypted durable intent before Temporal start, request/actor hash matching, stable operation/workflow IDs, exact-run deduplication, atomic projection/creation audit/intent completion, and authorized pending-start recovery.
- External effects: generation-fenced Activity ledger, explicit retry-safe/provider reconciliation contract, stable input hashes, retained uncertainty and provider-success/result-commit recovery. Unsafe effects are not automatically repeated.
- Human actions: one logical delivery slot, durable receipt and Update identity, retry after response loss, atomic token/receipt/audit commit, current assignment/resource checks, live token expiry/revocation and separate queued delivery/business completion. Original Signal names remain available for old runs.
- Workflow/runtime: original 15 exports split into deterministic modules, plus one application canary; `platform-runtime-v2` gates new cancellation/outcome commands; bounded non-cancellable task cleanup, honest cancel-request state, outcome UNKNOWN fallback and query sync warnings. Client connection is single-flight; Worker drains and bounds resource close/forced exit.
- Security/operations: shared TLS/mTLS/API-key configuration, AES-256-GCM authenticated versioned payload codec with HKDF purpose separation, retained-key decode and explicit legacy plaintext policy; allowlisted Activity correlation logs, real application canary, corrected operations bindings and owned failure/restore/load harness.
- Release tooling: stable export inventory, exact bundle/digest/lock sidecar, original Workflow IDs and explicit history serialization format, reviewed corpus coverage/integrity validation and release CI gate. Empty production corpus still blocks rollout.

Two additive migrations were tested on newly created disposable databases: `20261020170000_add_private_asset` and `20261020200000_workflow_recovery`. The eight pre-existing migration files and existing dirty lockfile were preserved byte-for-byte. No historical migration was rewritten by this task. Old clients may not read new enum/payload/Update state, so rollback requires compatible readers or forward repair rather than schema/data deletion.

## Verification

Final owned run: `884b1918-15cb-4d8a-a3ea-12a1eff74be3`.

| Check | Observed result |
|---|---|
| Typecheck, lint, architecture and build | PASS |
| Unit suite, Prisma access forbidden | 144 tests / 39 files PASS |
| Real PostgreSQL integration | 8 tests / 3 files PASS |
| Chromium / Redis acceptance | Login, public/admin pages, forms/uploads, missing CSRF, real queue pause/resume, two resource validation/CAS/replay/stale cases PASS |
| Actual built Worker process | SQL-blocked Activity drains on SIGTERM; exact projection retained; restart completes Workflow PASS |
| Real Temporal reliability | Canary success/dead-queue deadline; accepted-start response loss and intent recovery; invalid Update rejection/lost Update response recovery; waiting-human cancellation cleanup; real Schedule trigger/projection PASS |
| Prior-source compatibility | 15 genuine histories captured from the preserved pre-change Git source replay against candidate; old waiting approval continues under candidate Worker using retained Signal; incompatible timer control rejected |
| Exact saved bundle CLI replay | All 16 types (15 prior-source plus new-type canary) PASS with digest/sidecar validation; history Workflow IDs preserved |
| Transport | Actual Client and NativeConnection RPC over owned mTLS/API-key proxy to Temporal; wrong key, absent client cert, untrusted CA and mismatched private key rejected |
| Restore and failure | Owned application DB dump/restore and private-volume restore; retained waiting work resumes; Temporal outage/deadline/recovery; bounded forced exit and Activity retry PASS |
| Local load | 25 concurrent application canaries; measured p95 and forced exit timings in evidence index |
| Production replay gate | BLOCKED as intended: no reviewed deployed-release corpus supplied |

Provider uncertainty/fencing tests use an independent synthetic provider receipt map and real SQL; no real payment/CRM/AI provider was called. Transport tests use an owned TLS/auth proxy in front of the real local Temporal server, not an assertion that the production frontend is configured. Local restore preserves independent Temporal history while restoring application DB/private storage; it does not test Temporal persistence HA or coordinated production point-in-time restore. Replay captures representative running/completed branches, not every deployed branch.

The local runner explicitly provisions unique labelled containers/network, loopback endpoints, namespace/queue, database sentinel and Chromium profile; cleanup verifies ownership. It does not load application `.env`. Native Linux dependencies already available on this transferred workstation were supplied through NODE_PATH and Prisma engine overrides. The lockfile was not changed. See the evidence index for exact environment overrides and source digests.

## Remaining boundaries

These remain open rather than being inferred from local passes:

1. Actual supported deployed releases, active-history branches, migration checksums and version routing. The production history manifest remains empty; exact release replay, actual deployed rolling compatibility and repository required-check settings must be accepted before rollout.
2. Actual self-hosted HA, persistence restore, secret rotation, collectors/alert routing, network/UI restrictions and named availability/latency/RPO/RTO/capacity targets. The local 10-second canary envelope is a regression limit, not a production SLO.
3. Full cancellation/effect/timer/child/fanout and Schedule partial-create/delete/reconciliation matrices for the supported production workflows and real provider receipts.
4. Solution Intent SI-01–05 adoption and its seven domain journeys. Its methodology, canonical governance, commercial calculations and specialized workspaces remain in that solution; no donor source was changed here.
5. S3 private backend, real provider certification, legacy confidential public-file remediation and manual accessibility/assistive-technology acceptance remain separately scoped.

The execution checklist (`docs/blueprint/EXECUTION-CHECKLIST-2026-10-20.md`) maps every work package to source/local/runtime/production disposition. `LOCAL-OPERATIONS.md`, `EXTENSION-CONTRACTS.md` and `DECISIONS.md` document reproduction, incident recovery, key retention and rollback rules. Sanitized deliverables include a review patch, source provenance, result summaries and selected synthetic evidence; private keys, raw database dumps and browser profiles are excluded.
