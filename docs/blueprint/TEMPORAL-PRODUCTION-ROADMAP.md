# Temporal Production-Grade Orchestration Roadmap

Status: This roadmap retains production acceptance work and historical planning context.
For current implementation status and remaining gates, use
[the execution checklist](./EXECUTION-CHECKLIST-2026-10-20.md) and
[extension contracts](./EXTENSION-CONTRACTS.md). Older gap statements below
are not a current source inventory.

**Status:** implementation handoff plan  
**Baseline:** `cdab568` (`Add Temporal workflow orchestration platform`)  
**Scope:** harden the existing generic workflow platform into a production-grade orchestration capability before additional business workflow migrations.

## 1. Current baseline and target

The boilerplate currently has a working self-hosted Temporal foundation:

- separate web/Temporal Client and Worker processes;
- code-owned workflow registry with database catalog and role policy;
- generic workflow start, execution projection, cancellation, schedules, and operations screens;
- durable human tasks with authenticated and public token paths;
- organization-scoped integration connections, bindings, encrypted credentials, and Activity idempotency;
- migrated showcase workflows across human approval, sagas, long-running work, AI, scheduling, and child workflows;
- passing typecheck, lint, unit tests, build, and recorded self-hosted smoke tests.

It is not yet production-grade. The most important remaining gaps are:

1. Workflow payloads are not protected by an application payload codec; sensitive data must remain outside history until this is implemented.
2. Representative replay-history fixtures and a CI replay gate are not implemented (the current docs contain an inconsistency that must be resolved first).
3. Human actions use Signals plus application-side finalization; critical actions need Temporal Update semantics or an explicitly documented asynchronous contract.
4. Scheduled execution projection ingestion has focused tests, but needs a fresh end-to-end live smoke and failure/reconciliation testing.
5. Production self-hosted topology, persistence, backup/restore, upgrades, alerting, and capacity limits are not proven.
6. There is no formal security/load/chaos acceptance gate or issue tracker entry for the known gaps.

### Production-grade definition of done

The feature is production-grade when all of the following are true:

- in-flight executions survive web/Worker rolling deployments and Temporal upgrades;
- replay compatibility is automatically tested for every registered workflow and version change;
- confidential workflow payloads have a documented, tested encryption/key-rotation policy;
- human actions have deterministic acceptance, authorization, deduplication, expiry, and retry semantics;
- Temporal, Worker, Activity, integration, projection, and database failures are distinguishable in dashboards and alerts;
- self-hosted Temporal persistence has a supported HA, backup, restore, upgrade, and disaster-recovery procedure;
- organization isolation and secret-redaction tests pass under adversarial inputs;
- load, duplicate-request, restart, cancellation, schedule, and reconciliation tests pass against a real stack;
- docs, skills, agents, runbooks, examples, scripts, and architecture maps match the actual implementation.

## 2. Non-negotiable architecture constraints

Keep the repository layering intact:

```text
HTTP route → controller → service → model → Prisma
Temporal Client gateway → service → model → Prisma
Worker → deterministic Workflow → Activity → service/model/integration adapter
```

- Workflows may import only deterministic contracts, registry-safe helpers, and Temporal Workflow APIs. Never Prisma, Express, `process.env`, application services, credential decryptors, or Node I/O.
- Activities own side effects and call application services/adapters. Credentials are resolved only in Activities and never enter Workflow arguments, Signals, Updates, Queries, summaries, logs, or browser forms.
- PostgreSQL records are projections, task/action ledgers, configuration, and audit—not a second workflow engine. Temporal remains authoritative for timers, retries, cancellation, and execution history.
- Code owns executable workflow/provider behavior. Admin owns safe metadata, role policy, organization bindings, schedules, and operational controls.
- New app settings belong in `SETTING_KEYS`; infrastructure/secrets belong in typed config and deployment secret storage.
- Stateful workflow features use specialized controllers/routes, not the generic admin CRUD registry.

## 3. Execution protocol for every phase

Each phase is a separate implementation slice. A coding agent must:

1. read `ARCHITECTURE.md`, `AGENTS.md`, `skills/SKILL-conventions.md`, `skills/SKILL-temporal.md`, and the task-specific skills;
2. inspect the current source before editing and preserve unrelated work;
3. implement database/model/service/controller/route/view layers in that order where applicable;
4. add or update tests before declaring completion;
5. run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and relevant Temporal smoke/replay suites;
6. run `git diff --check` and search for prohibited imports/secrets;
7. update `docs/testing/TEST_RESULTS.md`, the operations runbook, and affected architecture/skill docs;
8. record deferred work and evidence in the phase handoff section below.

Do not begin the next phase if an exit gate fails. Commit each phase separately with a descriptive message.

## 4. Phased implementation plan

### Phase P0 — Baseline audit and backlog normalization

**Goal:** establish one authoritative production backlog and remove documentation contradictions.

**Files to inspect/update:**

- `docs/blueprint/EXTENSION-CONTRACTS.md`
- `docs/blueprint/TEMPORAL-PRODUCTION-ROADMAP.md`
- `docs/temporal-operations-runbook.md`
- `skills/SKILL-temporal.md`
- `docs/testing/TEST_PLAN.md`, `docs/testing/TEST_RESULTS.md`
- `README.md`, `ARCHITECTURE.md`, `AGENTS.md`

**Work:**

- verify which replay fixtures, codecs, Updates, metrics, and live smoke tests actually exist in source;
- classify every gap as blocker, high, medium, or deferred;
- create GitHub issues if the GitHub connector is installed, otherwise maintain a checked-in `docs/temporal-production-backlog.md` with owner, severity, evidence, and acceptance criteria;
- explicitly mark `.codex/` as local/untracked or add it to `.gitignore` after confirming it contains no product source.

**Exit gate:** no document claims a capability that source/tests do not prove; backlog has an ID, severity, owner, and test for every remaining gap.

### Phase P1 — Security boundary and payload protection

**Goal:** prevent confidential workflow data from being stored in plaintext in Temporal history or application projections.

**Files/components:**

- `src/config/index.ts`, `.env.example`, `src/services/setting.service.ts`
- new `src/temporal/payload-codec.ts` and/or data-converter module
- `src/lib/temporalClient.ts`, `src/temporal/worker.ts`
- `src/temporal/contracts.ts`, `src/temporal/forms.ts`
- `credential-encryption.service.ts`, redaction helpers, audit/log services
- focused security tests and `docs/temporal-operations-runbook.md`

**Work:**

- define encrypted payload envelope, active key version, previous-key decryption, rotation, size limits, and failure behavior;
- configure matching Client/Worker converters; fail closed when required keys are missing or incompatible;
- keep credentials, raw files, prompts, transcripts, and tokens out of payloads even when encrypted unless explicitly approved;
- redact application projections, audit changes, logs, errors, and test snapshots;
- add cross-org and key-rotation tests.

**Exit gate:** a self-hosted test proves encrypted payloads can be consumed by Web and Worker, plaintext does not appear in history/logs/projections, old key versions replay, and rotation does not break in-flight runs.

### Phase P2 — Replay fixtures, determinism, and versioning CI

**Goal:** make Workflow code changes safe for existing histories.

**Files/components:**

- new `tests/temporal/replay/` fixtures and scripts
- `src/temporal/workflows/`, `src/temporal/workflow-registry.ts`
- `package.json` scripts and CI workflow configuration
- `docs/temporal-operations-runbook.md`, `skills/SKILL-temporal.md`

**Work:**

- capture sanitized representative histories for every workflow family: timer, Signal/Update, child workflow, compensation, retry, cancellation, schedule, and projection ingestion;
- build a replay command that loads fixtures against the exact Worker bundle;
- add CI failure on nondeterminism/replay mismatch;
- document additive-change, `patched`/versioning, retention, fixture refresh, and Worker rollout rules;
- add deterministic unit tests for registry collisions, state summaries, and payload-size limits.

**Exit gate:** CI replays all committed fixtures; an intentional incompatible change fails CI; the documented patch/version procedure preserves old histories.

### Phase P3 — Human-task correctness and Temporal interaction contract

**Goal:** make human actions durable, synchronous where required, and safe under duplicates/concurrency.

**Files/components:**

- `src/services/workflow-human-task.service.ts`
- `src/models/workflowHumanTask.model.ts`
- `src/temporal/contracts.ts`, workflow action definitions, registry metadata
- `src/controllers/workflowTask.controller.ts`, `src/routes/workflowTask.routes.ts`
- human-task views/email template and tests

**Work:**

- choose per action whether it is a Signal (asynchronous notification) or Temporal Update (validated synchronous command); document the choice;
- use Update handlers for actions requiring workflow-level validation and return accepted/rejected results to the request;
- preserve receipt/idempotency behavior across retries, token replay, concurrent submissions, expiry, revocation, and Worker restart;
- add explicit task acknowledgement/claim semantics and reconcile uncertain client responses;
- rate-limit public token actions and avoid exposing workflow IDs beyond the minimum required.

**Exit gate:** duplicate and concurrent submissions yield one business effect; invalid actions are rejected by the Workflow contract; browser/authenticated/token flows agree on receipts and final state.

### Phase P4 — Projection reliability and schedule correctness

**Goal:** make the PostgreSQL projection dependable without competing with Temporal authority.

**Files/components:**

- `workflow-execution.service.ts`, `workflow-operations.service.ts`, `workflow-schedule.service.ts`
- projection Activity and registered Workflow startup hook
- relevant models/migrations/indexes
- operations controllers/routes/views
- `tests/services/*`, `tests/temporal/integration/*`

**Work:**

- run live scheduled execution smoke after the final projection-ingestion implementation;
- test duplicate ingestion, delayed ingestion, Temporal unavailable, stale RUNNING claims, child visibility, cancellation, and reconciliation;
- add bounded pagination/indexes and projection version/state-transition validation;
- ensure schedule pause/unpause/trigger/delete and catch-up/overlap behavior match documented policy;
- define reconciliation cadence and safe operator actions.

**Exit gate:** restart and failure tests converge projections without duplicate business effects; scheduled runs create their own projections; operators can distinguish projection drift from Temporal failure.

### Phase P5 — Observability, alerting, and operational controls

**Goal:** make incidents diagnosable and remediable.

**Files/components:**

- `src/services/health.service.ts`, `log.service.ts`, `workflow-operations.service.ts`
- Worker/client logging and metrics hooks
- operations dashboard/views and health endpoints
- deployment manifests, alert definitions, runbook

**Work:**

- emit structured metrics for starts, completions, failures, retries, cancellations, open tasks, action latency, Activity latency/failures, integration failures, projection drift, schedule lag, Worker pollers, and Temporal connectivity;
- propagate request/workflow/run/activity correlation IDs without payloads;
- add alerts with severity, owner, runbook link, and suppression policy;
- provide safe retry/reconcile/cancel controls with authorization and audit; never expose arbitrary signal execution;
- add retention and cardinality limits.

**Exit gate:** a fault-injection test produces a useful dashboard/alert and an operator can identify the failing layer and remediate without database edits.

### Phase P6 — Production self-hosted topology, persistence, and DR

**Goal:** support Temporal as a durable production dependency rather than a disposable Compose service.

**Files/components:**

- `docker-compose.yml` (development only)
- new deployment manifests/helm/Terraform or documented platform equivalent
- Temporal server version/configuration and persistence settings
- `docs/temporal-operations-runbook.md`, backup/restore and upgrade runbooks
- `.env.example`, README deployment section

**Work:**

- define supported PostgreSQL persistence topology, HA/failover, namespace/task-queue ownership, TLS/auth, Temporal UI access, and network boundaries;
- separate application DB, Temporal persistence, Redis/BullMQ, and object storage responsibilities;
- pin versions and define compatibility/upgrade order;
- implement scheduled backups, restore drills, RPO/RTO, retention, and disaster-recovery procedure;
- define Web/Worker rolling deployment and graceful shutdown behavior.

**Exit gate:** restore drill reaches the documented RPO/RTO; one Worker can be drained/replaced while in-flight workflows continue; Temporal UI is not publicly exposed; configuration is reproducible from deployment files.

### Phase P7 — Performance, capacity, and resilience testing

**Goal:** establish safe operating limits before production traffic.

**Files/components:**

- new load/chaos test harness under `tests/temporal/`
- rate limits and payload validation in controllers/services
- Worker concurrency/task-queue settings
- dashboards/runbook/capacity table

**Work:**

- test concurrent starts, duplicate business keys, task floods, large payload rejection, Activity retries, schedule bursts, and projection lag;
- test Web restart, Worker crash, Temporal restart, database failover, integration timeout, cancellation, and network partition;
- tune Worker concurrency, Activity timeouts/retry policies, DB indexes/pools, and queue partitioning;
- document throughput, latency, maximum history/payload assumptions, and scaling triggers.

**Exit gate:** agreed SLOs hold under load; failure tests converge without data corruption; overload is rejected/back-pressured predictably.

### Phase P8 — Security, privacy, and compliance review

**Goal:** validate the complete trust boundary before sensitive workflows are enabled.

**Work:**

- threat-model organization isolation, role policy, public task tokens, admin operations, Temporal UI, logs, backups, and encryption keys;
- run dependency/vulnerability scanning and secret scanning;
- verify audit coverage and retention/deletion policy for tasks, executions, payloads, credentials, and histories;
- perform authorization tests for every org/admin/action path and negative tests for IDOR/cross-org access;
- document incident response and credential/key compromise rotation.

**Exit gate:** security review has no unmitigated high-severity findings; evidence and remediation owners are recorded.

### Phase P9 — Controlled showcase migration and release readiness

**Goal:** migrate business workflows only after the platform gates pass.

**Work per workflow:**

1. define contract/version and data-classification policy;
2. add registry metadata, forms, permissions, integration requirements, and Update/Signal actions;
3. add Activities with idempotency, retries, timeout, redaction, and provider bindings;
4. add human tasks and projection transitions;
5. add replay fixture before further incompatible changes;
6. test timer, retry, cancellation, restart, duplicate, schedule, and failure paths;
7. run a canary with an explicit rollback/disable plan;
8. update docs, runbooks, test results, and release notes.

**Exit gate:** each workflow has a production owner, SLOs, data classification, rollback strategy, alert coverage, replay fixture, and successful canary.

### Phase P10 — Documentation and agent handoff convergence

**Goal:** leave the repository teachable and maintainable by another agent.

**Files:**

- `ARCHITECTURE.md`, `AGENTS.md`, `README.md`
- `skills/SKILL-conventions.md`, `skills/SKILL-temporal.md`, `skills/README.md`
- all affected skills under `skills/`
- `docs/testing/TEST_PLAN.md`, `docs/testing/TEST_RESULTS.md`
- `docs/temporal-operations-runbook.md` and new DR/security/replay runbooks
- `docs/blueprint/EXTENSION-CONTRACTS.md` and this roadmap

**Work:**

- update the architecture map, schema, routes, process topology, lifecycle examples, and ownership boundaries;
- document every command, environment/config key, migration, deployment, smoke/replay test, and rollback procedure;
- remove stale claims, speculative filenames, abandoned variables, and obsolete phase statuses;
- ensure no docs, fixtures, screenshots, or examples contain secrets, plaintext tokens, or sensitive payloads;
- add a final source-of-truth search/check script where practical.

**Exit gate:** a new contributor can run the stack from `README.md`; a coding agent can choose correct files from `AGENTS.md` and skills; docs and source maps match; all verification commands are exercised.

## 5. Bug and risk register to carry forward

These are known gaps, not necessarily defects in the current v1 implementation:

| ID | Severity | Risk | Required resolution |
|---|---|---|---|
| TEMP-001 | High | Sensitive payloads can be plaintext in Temporal history | Phase P1 codec and leak tests |
| TEMP-002 | High | Workflow changes can break in-flight histories without replay CI | Phase P2 fixtures/versioning gate |
| TEMP-003 | High | Signal plus DB finalization can return ambiguous human-action outcomes | Phase P3 Update/ack contract |
| TEMP-004 | High | Self-hosted persistence/DR topology is not production-proven | Phase P6 restore and failover drill |
| TEMP-005 | High | Limited metrics/alerts can delay incident diagnosis | Phase P5 observability gate |
| TEMP-006 | Medium | Scheduled projection ingestion needs final live smoke and failure coverage | Phase P4 acceptance suite |
| TEMP-007 | Medium | Load/capacity limits and overload behavior are not established | Phase P7 performance gate |
| TEMP-008 | Medium | No formal security/privacy review evidence | Phase P8 review |
| TEMP-009 | Low | `.codex/` is local untracked state | Decide ignore/document in P0 |

Do not call these “fixed” merely because a unit test exists. Each ID needs production evidence and a linked test/runbook.

## 6. Recommended implementation order and model guidance

Implement in order `P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8 → P9 → P10`.

- P0: 5.5 medium; documentation and evidence audit.
- P1–P3: 5.5 high; security, Temporal data conversion, replay, and interaction semantics are high-risk.
- P4–P6: 5.5 high; distributed failure behavior and self-hosted operations require careful reasoning.
- P7–P8: 5.5 high; testing and security evidence benefit from deeper analysis.
- P9: 5.5 medium for repetitive vertical slices after gates pass; use high for a new workflow with novel child/schedule/AI behavior.
- P10: 5.5 medium; mechanical but must be evidence-driven.

The next implementation conversation should start with **P0**, not with another showcase migration. Its first deliverable is a corrected backlog and a short evidence report that resolves the replay-fixture documentation contradiction.

## 7. Phase handoff template

Every completed phase should append:

```text
Phase: P__
Commit:
Implemented:
Files changed:
Tests/commands:
Observed evidence:
Known limitations:
Backlog IDs closed:
Backlog IDs opened:
Recommended next phase/model/effort:
```

