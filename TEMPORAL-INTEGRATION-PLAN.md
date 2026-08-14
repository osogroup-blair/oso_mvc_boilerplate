# Temporal Workflow Platform: Architecture and Phased Implementation Plan

## 1. Objective

Add a generic, production-shaped Temporal workflow platform to the MVC
boilerplate before migrating the standalone workflows from
`../temporal-showcase` in controlled waves.

Implementation status: Phases 0-7 were completed on 2026-08-14. This document
is now both the historical blueprint and the handoff record. Sections that
describe pre-implementation gaps are retained as historical analysis; the
implemented source of truth is the current code, `ARCHITECTURE.md`,
`AGENTS.md`, `skills/SKILL-temporal.md`, `TEST_PLAN.md`, `TEST_RESULTS.md`, and
`docs/temporal-operations-runbook.md`.

The target platform must:

- run against a self-hosted Temporal cluster first, with a configuration seam
  for Temporal Cloud later;
- run the HTTP application and Temporal Worker as separate processes;
- expose code-registered workflow types through an admin-managed catalog;
- let admins enable, label, configure, permission, and bind integrations to
  workflow definitions without uploading executable Workflow code;
- scope executions and integration credentials to an organization;
- enforce start/view/action permissions per workflow and application role;
- render workflow start forms, execution status, and human-input forms in the
  existing Handlebars application;
- support both authenticated and secure email-link human interactions;
- use integration connections configured in the application admin;
- preserve Temporal as the authority for durable orchestration state while the
  application database supplies catalog, access, task-inbox, audit, and search
  projections;
- migrate all ten top-level showcase use cases and their child workflows.

This document began as an implementation blueprint. The completed platform now
adds Temporal packages, migrations, runtime behavior, docs, and validation
evidence across the phases recorded below.

## 2. Confirmed Product Decisions

1. Build a generic workflow platform before migrating showcase workflows.
2. Start with self-hosted Temporal; retain a clean path to Temporal Cloud.
3. Configure workflow access per workflow and role.
4. Store integration connections per organization and manage them through the
   application admin; encrypt secrets at rest.
5. Deploy the Temporal Worker separately from the web application.
6. Manage workflow availability and configuration through the admin.
7. Support human input through both authenticated application views and secure
   email links.

## 3. Current-State Analysis

### 3.1 Boilerplate strengths to retain

The boilerplate already provides useful platform primitives:

- strict route -> controller -> service -> model -> Prisma layering;
- Express and server-rendered Handlebars views;
- global roles with `resource:action` permissions;
- organizations and organization membership roles;
- sessions, authentication middleware, and admin authentication;
- audit logging for application mutations;
- site settings, page/route synchronization, and navigation injection;
- email delivery with a BullMQ/Redis fallback path;
- specialized admin controllers for features that do not fit generic CRUD;
- structured logging, request IDs, health diagnostics, and graceful shutdown;
- PostgreSQL through Prisma and a local Docker Compose environment.

Temporal should extend these systems rather than create a second web
application, identity system, admin, or email stack.

### 3.2 Boilerplate gaps that must be addressed first

At project start, the following capabilities did not exist:

- no Temporal client, Worker, workflow bundle, activity layer, namespace, task
  queue, or self-hosted Temporal services;
- no request-scoped active-organization context for normal application routes;
- no organization-scoped integration connection or encrypted secret storage;
- no workflow catalog or code-to-database registry synchronization;
- no workflow-specific role policy;
- no execution record/search projection tied to users and organizations;
- no generic workflow input/action form vocabulary;
- no durable human-task inbox, assignment, email token, or action submission
  model;
- no application-side reconciliation of Temporal execution state;
- no Worker readiness/heartbeat/build/version diagnostics;
- no payload encryption policy or redaction boundary for Temporal history;
- no workflow replay/versioning deployment procedure;
- no database-backed activity idempotency ledger;
- no schedule administration abstraction;
- no tests covering Temporal server/Worker loss, duplicate starts/actions,
  replay compatibility, authorization, or organization isolation.

The existing BullMQ email queue is not a Temporal substitute. BullMQ remains
appropriate for best-effort application jobs. Business processes involving
durable timers, external events, compensation, or long-running state move to
Temporal. Temporal Activities may call the existing email service; they should
not enqueue a second durable orchestration graph in BullMQ.

### 3.3 Showcase assets worth reusing

The showcase demonstrates the required Temporal primitives:

- ten top-level business workflows;
- typed workflow inputs and query state;
- Signals for approvals, rejection, correction, evidence, cancellation,
  blockers, date changes, and missing information;
- timers, reminders, escalation, and durable human waits;
- parallel Activity fan-out/fan-in;
- Saga compensation;
- child workflows for client phases and underwriting checks;
- cancellation cleanup;
- Temporal Schedules for compliance review;
- AI calls isolated in Activities with structured outputs;
- time-skipping workflow tests and Worker-restart tests;
- an integration port/adapter example.

These implementations are reference material, not drop-in platform code. The
showcase API has workflow-specific routes, the React UI has workflow-specific
forms, activities are predominantly synthetic, and local file-based
idempotency is unsuitable for multiple Workers or containers.

### 3.4 Showcase code that must not be copied unchanged

- The browser-facing API is unauthenticated and is not organization-aware.
- Workflow IDs are often accepted directly from browser routes.
- Every use case owns bespoke REST endpoints and UI state.
- Integration selection and chaos flags come from user input instead of
  administrator-owned organization bindings.
- Activity idempotency uses a local JSON file.
- Activity implementations log payload data and use synthetic side effects.
- The single task queue is named for the first demo rather than the platform.
- Workflow state is queried directly for each page request without an
  application search/read projection or authorization boundary.
- No encrypted payload codec or application credential vault exists.
- No Worker versioning/replay deployment gate is implemented.

## 4. Target Architecture

```text
Browser / Email Recipient
          |
          v
Express routes -> controllers -> workflow services -> Temporal Client
          |                 |                |
          |                 |                +-> start/query/signal/cancel/schedule
          |                 +-> models -> application PostgreSQL
          |                               (catalog, policy, tasks, projection,
          |                                integrations, audit, idempotency)
          v
Handlebars workflow catalog, start form, execution detail, task inbox/form

Self-hosted Temporal Service + Temporal UI
          |
          v
Separate Temporal Worker process
          |
          +-> deterministic code-registered Workflows
          +-> Activities -> application services / integration adapters
                                      |
                                      +-> encrypted org integration connection
                                      +-> external provider / email / storage
```

### 4.1 Ownership boundaries

| Concern | Authority |
| --- | --- |
| Timers, retries, current orchestration phase, Signal waits, child execution | Temporal Workflow history |
| Workflow implementation and contracts | Versioned TypeScript code |
| Enabled/disabled state, labels, role policy, UI overrides | Application PostgreSQL |
| Organization and membership | Application PostgreSQL |
| Integration connection metadata and encrypted credentials | Application PostgreSQL |
| Searchable execution list and summarized state | Application PostgreSQL projection |
| Live execution state | Temporal Query/Describe, accessed through a service |
| Human task assignment, inbox, email delivery, link token | Application PostgreSQL |
| Whether a human response changes orchestration state | Temporal Workflow |
| Audit trail of application actions | Application `AuditLog` |
| Detailed durable execution history | Temporal |

The application database must never recreate Temporal timers, retry counters,
or phase transitions as an alternative workflow engine. Projection rows are
explicitly rebuildable and may be marked stale.

### 4.1.1 Extended dependency direction

Temporal adds a second application entry path, but it does not replace or
bypass the existing MVC layers:

```text
HTTP:     route -> controller -> service -> model -> Prisma
Temporal: Temporal Service -> Worker -> Workflow -> Activity -> service
                                                        |         |
                                                        |         +-> model -> Prisma
                                                        +-> integration adapter
```

The new components have strict dependency rules:

| Component | May import | Must not import |
| --- | --- | --- |
| Workflow | Temporal Workflow SDK and deterministic shared contracts | Express, services, models, Prisma, Node I/O, mutable configuration, Activities as normal functions |
| Activity | application services, integration adapter interfaces, typed contracts, logger | controllers, routes, views, Prisma, models directly |
| Temporal Client gateway | Temporal Client SDK, typed config, logger, payload converter | controllers, models, Prisma, Workflow implementation modules |
| Application service | models, other services, lib utilities, injected Temporal Client gateway | Express request/response, Prisma directly |
| Worker bootstrap | Workflow bundle, Activity registrations, typed config, logger | Express application or controllers |
| Controller | one primary service plus pure boundary validators/registries | models, Prisma, Worker or Workflow implementation modules |

`ARCHITECTURE.md` and `skills/SKILL-conventions.md` must be extended with this
table before product Workflow implementation begins. Add a dedicated
`skills/SKILL-temporal.md` covering determinism, Activities, retry/timeout
policy, Signals/Updates/Queries, cancellation, versioning, payload policy, and
the application layer boundary. This is required by the repository rule that a
genuinely new implementation pattern must be documented for later agents.

### 4.2 Code registry versus admin configuration

Workflow code cannot be uploaded or authored from the admin. Each deployable
workflow has a code registration similar to:

```ts
interface WorkflowTypeRegistration<TInput, TState> {
  key: string;
  workflowType: string;
  taskQueue: string;
  contractVersion: number;
  startForm: FormDefinition;
  validateStart(input: unknown): TInput;
  stateQuery?: string;
  actions: Record<string, WorkflowActionRegistration>;
  integrationRequirements: IntegrationRequirement[];
  summarizeState(state: TState): WorkflowStateSummary;
  buildWorkflowId(context: StartContext, input: TInput): string;
}
```

Startup synchronization upserts immutable code facts into the database. Admins
edit only safe operational metadata: enabled state, display text, role policy,
form presentation/default overrides, queue selection from an allow-list,
retention/display preferences, and organization integration bindings.

This prevents arbitrary code execution and preserves deterministic, typed,
reviewable Workflow implementations.

### 4.3 Generic form contract

Do not attempt to infer forms from Zod internals. Define a small serializable
form vocabulary and pair it with explicit Zod boundary validators:

- text, email, URL, number, currency, boolean, date, datetime;
- textarea and safe markdown/plain text (no untrusted raw HTML);
- select and multi-select;
- file/asset reference;
- object fieldset and repeatable object list;
- hidden server-derived values;
- read-only context blocks.

Workflow start and action definitions use the same renderer. Admin overrides
may change labels, help text, ordering, optional presentation, and permitted
defaults, but may not change the executable contract or make a required field
optional.

For HTTP requests, validation still occurs at the controller boundary. The
controller uses a pure code-registry contract to parse the submitted body with
Zod, then calls one primary service with typed data. Services may retain
defensive contract assertions for non-HTTP callers, but dynamic registration is
not a reason to move request validation into the service layer.

### 4.4 Organization and authorization model

Every execution, task, integration binding, and schedule has an `orgId`.
Workflow routes require an active organization context and membership.

Authorization is the intersection of:

1. authenticated membership in the execution organization (except a valid,
   narrowly scoped email task token);
2. global application permission such as `workflow:read` or `workflow:start`;
3. the workflow definition's allowed role for the requested capability;
4. optional task assignment/role restrictions for a human action.

At minimum distinguish `start`, `view`, `act`, `cancel`, and `admin`. Do not
trust a workflow ID alone as authorization. Every handle lookup first resolves
an application execution row constrained by organization and actor.

### 4.5 Human task lifecycle

Human interaction is modeled as an application task correlated to a Workflow
wait:

1. Workflow calls an Activity to create/upsert a task using an idempotency key.
2. Activity persists assignment, action form key, due date, and safe context.
3. Activity requests notification through the existing email service.
4. The authenticated inbox and tokenized email route render the same generic
   action form.
5. Submission is Zod-validated and authorization/token-validated.
6. The workflow interaction service sends the registered Signal or Update with
   an idempotent action ID.
7. The task is marked submitted/accepted and audited; a reconciler resolves
   ambiguous network outcomes.
8. Workflow closes/cancels/supersedes the task through an Activity when the
   wait ends by another path.

Email tokens are random, single-purpose, hashed at rest, expire, are
single-use, and grant access only to one task and its declared actions. The
page must not expose arbitrary workflow operations. Sensitive task context is
loaded server-side after token validation and is not encoded in the link.

Temporal Updates are preferable for future actions that require synchronous
workflow-level validation. Existing showcase Signals can be supported first
behind the same action registry.

### 4.6 Integration resolution

Workflow inputs contain stable identifiers such as `orgId`, connection binding
key, asset ID, and business entity ID—not provider secrets.

Activities resolve dependencies in this order:

```text
workflow definition requirement
  -> organization workflow binding
  -> enabled IntegrationConnection
  -> provider registry adapter
  -> decrypted credential only inside Activity process memory
```

The provider registry is code-defined. Admins create named connections, test
them, rotate credentials, disable them, and bind them to workflows.

Secrets use authenticated encryption with a versioned application master key
from typed environment configuration. Store ciphertext, nonce/IV, auth tag,
and key version separately from non-secret JSON configuration. Never render,
audit, log, or place decrypted secrets in Workflow inputs, results, memo,
search attributes, or Event History. A production follow-up can swap the
encryption service for a KMS-backed envelope-encryption adapter.

### 4.7 Temporal connectivity and deployment

Add three self-hosted development services to Docker Compose:

- Temporal persistence PostgreSQL (separate from the application database to
  keep lifecycle and backups independent);
- Temporal Server;
- Temporal Web UI.

Pin image versions; do not use floating `latest` tags. Keep Redis/BullMQ for
email and incidental jobs.

The web process owns the Temporal Client and does not load Workflow bundles.
The Worker process owns Workflow bundles and Activities and has its own
startup, health/readiness reporting, graceful shutdown, and deployment command.

Typed environment configuration holds infrastructure bootstrap values:

- address, namespace, TLS, and optional API key;
- default task queue;
- Worker identity/build identifier;
- payload encryption configuration;
- credential encryption key ring;
- Temporal UI base URL for admin-only drill-down.

Application behavior such as whether workflow launch is enabled remains in
database/admin configuration, not `.env`.

Cloud migration later changes connection/TLS/API-key configuration, not
workflow, controller, or view contracts.

### 4.8 Payload and data policy

- Pass asset IDs/storage keys, never file bytes or full document bodies.
- Pass entity IDs and fetch current external/application data in Activities.
- Keep Workflow inputs sufficient for deterministic business intent; avoid
  mutable data lookups in Workflow code.
- Put only non-sensitive, low-cardinality identifiers in search attributes.
- Redact summaries stored in the application projection.
- Add a Temporal payload codec/data converter before workflows carry PII.
- Log workflow/run/execution IDs and operation names, not payloads or secrets.
- Establish explicit payload size limits at controller boundaries.

### 4.9 Reliability and idempotency

- Derive business-meaningful Workflow IDs with organization scope and an
  explicit conflict/reuse policy per registered type.
- Assign every start and human action a client idempotency key.
- Replace the showcase JSON idempotency file with an `ActivityIdempotency`
  table keyed by organization, operation, and idempotency key.
- Integration adapters must distinguish retryable, non-retryable, and
  authentication/configuration failures.
- Set Activity start-to-close/schedule-to-close/heartbeat timeouts explicitly.
- Add heartbeat and cancellation handling for long Activities.
- Preserve old Workflow behavior for in-flight histories; require replay tests
  and Worker deployment/versioning strategy for incompatible changes.
- Reconcile execution and human-task projections after uncertain client calls,
  Worker outages, or application restarts.

### 4.10 Audit policy

The existing `AuditService` remains the application audit seam:

- audit every user/admin business mutation: start, action, cancel, task claim,
  integration lifecycle/binding, schedule lifecycle, and workflow-definition
  configuration;
- audit meaningful system-driven business transitions, such as an execution
  moving from running to failed or a human task being escalated;
- do not emit an audit row for a reconciliation pass that changes only
  operational timestamps such as `lastSyncedAt`;
- audit administrator-triggered repair or reconciliation commands;
- never include credentials, plaintext task tokens, full sensitive inputs,
  document bodies, or unredacted Activity results in audit changes.

This treats projection refresh metadata as operational bookkeeping while
preserving the repository rule that business mutations are audited.

## 5. Proposed Database / Schema

Names may be refined during implementation, but splitting these concepts is
important.

### 5.1 Workflow catalog and policy

`WorkflowDefinition`

- `id`, `key` (unique code registry key), `slug` (unique URL key)
- `workflowType`, `contractVersion`, `defaultTaskQueue`
- `name`, `description`, `category`, `icon`, `isEnabled`
- `presentation` JSON for safe UI overrides
- `createdAt`, `updatedAt`, `deletedAt`

`WorkflowDefinitionRole`

- `workflowDefinitionId`, `roleId`, `capability`
- unique `(workflowDefinitionId, roleId, capability)`
- capability enum: `START`, `VIEW`, `ACT`, `CANCEL`, `ADMIN`
- standard timestamps, `deletedAt`, and a deleted-state index

`WorkflowIntegrationRequirement`

- definition ID, stable requirement key, provider type, display label
- required/optional, allowed provider adapter keys, non-secret config schema
- standard timestamps, `deletedAt`, and a deleted-state index

`WorkflowIntegrationBinding`

- organization ID, workflow definition ID, requirement ID, connection ID
- unique per organization/definition/requirement
- standard timestamps, `deletedAt`, and a deleted-state index

### 5.2 Organization integration vault

`IntegrationConnection`

- `orgId`, code-registered `providerKey`, admin name, status
- non-secret `config` JSON and scopes
- credential ciphertext, IV/nonce, auth tag, key version
- last tested/last successful timestamps and sanitized error code
- creator/updater IDs, timestamps, soft delete

Provider-specific secret shapes remain in code registrations and are validated
before encryption. The database never stores a plaintext secret JSON column.

### 5.3 Execution projection

`WorkflowExecution`

- definition ID, organization ID, starter user ID
- Temporal namespace, task queue, Workflow ID (unique), current run ID
- business key and display name
- normalized status and Temporal status
- redacted input/state/result/error summaries
- started, last synchronized, closed timestamps
- projection version/stale marker
- timestamps and soft delete

`WorkflowExecutionEvent` is optional and should contain only application-level
events worth presenting/auditing. Do not mirror complete Temporal history.

### 5.4 Human tasks and email access

`WorkflowHumanTask`

- execution ID, organization ID, stable task key, action registration key
- status, title, safe context JSON, due/escalation timestamps
- assignee user ID or recipient email where applicable
- created/submitted/completed/cancelled timestamps
- submitted-by user ID and submission summary
- unique `(executionId, taskKey)` and soft delete

`WorkflowHumanTaskRole`

- task ID and allowed global role ID

`WorkflowTaskToken`

- task ID, token hash, expiry, consumed/revoked timestamps, attempt metadata
- never store the plaintext token
- standard timestamps, `deletedAt`, and a deleted-state index

`WorkflowActionReceipt`

- execution/task IDs, action key, client idempotency key
- actor/token identity, payload hash, delivery/acceptance status, timestamps
- unique idempotency constraint
- `deletedAt` and a deleted-state index

### 5.5 Activity idempotency and operations

`ActivityIdempotency`

- organization ID, provider/operation, idempotency key
- status, external reference, redacted result/error summary
- attempt and lease metadata, timestamps
- unique `(orgId, operation, idempotencyKey)`
- `deletedAt` and a deleted-state index

Do not add a database Worker heartbeat table initially. Worker availability and
build information come from Temporal task-queue/Worker reachability APIs,
process/container health checks, structured logs, and metrics. This avoids a
high-frequency application mutation stream that duplicates Temporal state. A
persistent registration model may be proposed later only for a concrete
business requirement.

### 5.6 Schedule projection (defer until scheduling phase)

`WorkflowSchedule`

- org/definition IDs, Temporal schedule ID, enabled state
- normalized calendar/interval specification and timezone
- overlap/catch-up/pause policy, redacted input template, last sync timestamps
- standard timestamps, `deletedAt`, and a deleted-state index

Temporal remains authoritative for schedule execution semantics.

Every application-owned model introduced by this project receives the
repository-standard UUID ID, `createdAt`, `updatedAt`, `deletedAt`, and
`@@index([deletedAt])`. Completion, consumption, revocation, cancellation, and
expiry are state transitions rather than hard deletes. Explicit join models
also remain soft-delete-aware for this implementation, even where older join
models in the repository predate that convention.

## 6. Proposed Code Layout

Keep deterministic code physically obvious and prevent imports from Express,
Prisma, Node-only APIs, or mutable application services.

```text
src/
  temporal/
    client.ts
    connection.ts
    types.ts
    forms.ts
    workflow-registry.ts
    integration-registry.ts
    data-converter.ts
    workflows/
      index.ts
      shared/
    activities/
      index.ts
      human-task.activities.ts
      projection.activities.ts
      integrations/
    worker.ts
  models/
    workflow-definition.model.ts
    workflow-execution.model.ts
    workflow-human-task.model.ts
    integration-connection.model.ts
    activity-idempotency.model.ts
    workflow-schedule.model.ts
  services/
    workflow-catalog.service.ts
    workflow-execution.service.ts
    workflow-interaction.service.ts
    workflow-human-task.service.ts
    workflow-reconciliation.service.ts
    integration.service.ts
    credential-encryption.service.ts
    temporal-health.service.ts
    workflow-schedule.service.ts
  controllers/
    workflow.controller.ts
    workflow-task.controller.ts
    admin/
      workflow.admin.controller.ts
      integration.admin.controller.ts
      temporal.admin.controller.ts
      workflow-schedule.admin.controller.ts
  routes/
    workflow.routes.ts
    workflow-task.routes.ts
    admin/
      workflow.admin.routes.ts
      integration.admin.routes.ts
      temporal.admin.routes.ts
      workflow-schedule.admin.routes.ts
  views/
    workflows/
      catalog.hbs
      start.hbs
      executions.hbs
      execution-detail.hbs
      task-inbox.hbs
      task-form.hbs
      task-complete.hbs
    admin/
      workflows/
      integrations/
      temporal/
      workflow-schedules/
    partials/
      workflow-form-field.hbs
      workflow-status.hbs
      workflow-timeline.hbs
scripts/
  temporal-register-namespace.mjs
  temporal-reconcile.mjs
tests/
  temporal/
  services/
  acceptance/
```

If TypeScript compile boundaries prove insufficient to keep Workflow bundles
isolated, promote `temporal/workflows` and shared contracts into workspace
packages in a follow-up. Do not convert the whole repository into a monorepo in
phase 0 without evidence that it is necessary.

## 7. Layered Implementation Plan

### Phase 0 — Architecture baseline and self-hosted runtime

**Goal:** connect a separate no-op Worker and web Temporal Client to a pinned,
self-hosted development cluster without adding product workflow behavior.

#### Database / Schema

- No product tables yet.
- Decide whether Temporal persistence uses its own PostgreSQL container or a
  separately managed database; use a separate container for the default local
  Compose profile.

#### Model

- None.

#### Service

- Update `package.json` with pinned compatible Temporal TypeScript SDK
  packages and scripts: `dev:worker`, `start:worker`, Temporal test commands,
  and stack commands.
- Update `src/config/index.ts` and `.env.example` with typed Temporal bootstrap
  connection configuration and encryption key placeholders.
- Create `src/temporal/connection.ts`, `client.ts`, `worker.ts`, and empty
  workflow/activity indexes.
- Keep Temporal connection failure explicit for workflow endpoints while the
  rest of the site may remain available.
- Add graceful shutdown to the separate Worker entry point.
- Define the Temporal Client as an injected infrastructure gateway used by
  services; services do not construct SDK clients inline.
- Ensure Activities call application services or integration adapters and
  never import Prisma/models directly.

#### Controller & Routes

- Extend `GET /health` with application-level Temporal connectivity only if it
  remains fast and bounded; expose deeper diagnostics under protected admin.
- Create protected Temporal diagnostics route/controller skeleton.

#### Views & Content Widgets

- Add an admin Temporal diagnostics page showing address/namespace/task queue,
  connectivity, and Worker registration without secrets.
- Add admin sidebar entry.

#### Infrastructure / Operations

- Update `docker-compose.yml` with pinned Temporal persistence, server, and UI
  services plus health checks and named volumes.
- Ensure application DB and Temporal DB have separate volumes/backups.
- Document startup order and ports in `README.md`.
- Add an ADR documenting ownership boundaries and separate deployment.
- Update `ARCHITECTURE.md` and `skills/SKILL-conventions.md` with the extended
  dependency direction and create `skills/SKILL-temporal.md` before product
  workflows are added.

#### Tests / Exit gate

- Unit-test configuration parsing and connection factory injection.
- Smoke-test Client -> self-hosted server and Worker startup/shutdown.
- Exit only when the web app and Worker can be restarted independently and
  health diagnostics distinguish server unavailable from Worker unavailable.
- Verify all new relative imports use `.js` and no Temporal component has
  introduced a forbidden upward dependency.

### Phase 1 — Tenancy, workflow registry, catalog, and permissions

**Goal:** admins manage code-registered workflow definitions and role policy;
users can see only permitted catalog entries in an active organization.

#### Database / Schema

- Add `WorkflowDefinition`, `WorkflowDefinitionRole`, and
  `WorkflowIntegrationRequirement` plus enums and indexes.
- Apply UUID IDs, timestamps, `deletedAt`, and deleted-state indexes to every
  application-owned model and explicit join model.
- Add/complete active organization context support; do not infer the first
  organization membership silently when a user belongs to multiple orgs.
- Add reverse relations to `Role` and `Organization` as needed.
- Add idempotent seed permissions and initial admin policy.

#### Model

- Create thin soft-delete-aware workflow definition and policy models.
- Add organization-context query methods constrained by membership.

#### Service

- Create `forms.ts` serializable field contracts.
- Create `workflow-registry.ts` with duplicate-key/type/action validation.
- Create `workflow-catalog.service.ts` to sync code facts, apply admin-safe
  overrides, filter by role/capability, and audit mutations.
- Extend permissions with `workflow:start/read/act/cancel/admin` and explicit
  organization membership checks.

#### Controller & Routes

- Specialized admin workflow controller/routes for list, detail, enable,
  presentation overrides, and capability-by-role matrix.
- Public/authenticated workflow catalog controller/routes.
- Add Zod schemas for every admin mutation.
- Parse dynamic workflow start/action bodies at the controller boundary using
  the pure code registry contract, then call one primary service with typed
  data.

#### Views & Content Widgets

- Admin definition list/detail and workflow capability matrix.
- User workflow catalog with disabled/unavailable states omitted.
- Add `/workflows` to page/route sync and navigation conventions.

#### Tests / Exit gate

- Registry collision and invalid registration tests.
- Cross-organization and role capability tests.
- Admin audit tests and startup sync idempotency tests.
- Exit when a code registration appears in admin, can be enabled and
  permissioned, and catalog visibility is correct without any executable demo
  workflow.

### Phase 2 — Generic execution engine and user views

**Goal:** launch, inspect, query, cancel, and list a minimal platform test
workflow through generic services and views.

#### Database / Schema

- Add `WorkflowExecution` and optional application event projection.
- Index org/status/definition/startedAt/businessKey and unique Workflow ID.

#### Model

- Create execution projection list/count/find/upsert/status methods.
- Every query is organization-constrained and soft-delete-aware.

#### Service

- Create `workflow-execution.service.ts` as the sole application orchestration
  seam for start/describe/query/cancel.
- Resolve definition and actor authorization before getting a Temporal handle.
- Generate organization-scoped Workflow IDs and enforce per-type conflict
  policy.
- Accept controller-validated typed input, defensively assert the registered
  contract for non-HTTP callers, derive server-only context, resolve required
  bindings, start Workflow, persist projection, and audit.
- Create `workflow-reconciliation.service.ts` to refresh stale projections from
  Temporal without copying full event history.
- Implement a small internal platform test workflow to validate the generic
  path; remove or hide it before production if not useful.

#### Controller & Routes

- Add catalog detail/start form, POST start, execution list/detail, state
  refresh, and cancel routes.
- Return `ok()` envelopes for JSON/SSE endpoints and rendered views for pages.
- Never accept namespace/task queue/workflow type directly from the browser.

#### Views & Content Widgets

- Generic start form renderer.
- Execution list and detail views with normalized status, state summary,
  timestamps, and permitted actions.
- Polling first; add SSE only after correctness is established.
- Temporal UI deep-link is admin-only because Temporal UI does not inherit app
  authorization.

#### Tests / Exit gate

- Time-skipping Workflow tests.
- Duplicate start/idempotency/conflict tests.
- Authorization tests proving a guessed Workflow ID cannot cross orgs.
- Worker restart and Temporal outage behavior tests.
- Exit when the test workflow is fully operated through generic routes and no
  workflow-specific controller or template exists.

### Phase 3 — Durable human-task platform and email links

**Goal:** support generic authenticated and tokenized human action forms.

#### Database / Schema

- Add `WorkflowHumanTask`, `WorkflowHumanTaskRole`, `WorkflowTaskToken`, and
  `WorkflowActionReceipt`.
- Add strict uniqueness/idempotency indexes and repository-standard soft delete
  to every model, including token and receipt records.

#### Model

- Add task inbox, assignment, status transition, token hash lookup/consume,
  receipt reservation/finalization, and reconciliation queries.

#### Service

- Create human-task service for idempotent task creation/closure Activities,
  assignment, secure token issuance, and notification.
- Create workflow interaction service for registered Signal/Update actions.
- Reuse `email.service.ts`; add workflow task email templates and avoid placing
  sensitive context in email.
- Make action submission idempotent and reconcile ambiguous network outcomes.
- Add expiry, revocation, replay protection, rate limiting, and task-state
  checks to email links.

#### Controller & Routes

- Authenticated task inbox/detail/submit routes.
- Unauthenticated token-entry GET/POST routes scoped to a single task.
- CSRF strategy must be added before enabling state-changing browser forms
  broadly; token possession alone is not a CSRF exemption.
- Add action-specific Zod validation from the pure code registry at the
  controller boundary before calling the interaction service.

#### Views & Content Widgets

- Shared task form rendered for both authenticated and email-token contexts.
- Inbox, task detail, expired/consumed/complete pages.
- Email templates for assignment, reminder, escalation, and completion where
  appropriate.

#### Tests / Exit gate

- Approval, rejection, requested changes, resubmission, late response, token
  expiry, token replay, concurrent submission, and worker restart tests.
- Security tests for assignment, role, org, and token boundaries.
- Exit when a generic approval workflow can wait indefinitely and resume from
  either channel without a workflow-specific page.

### Phase 4 — Organization integration platform

**Goal:** activities use encrypted, admin-configured organization integrations.

#### Database / Schema

- Add `IntegrationConnection` and `WorkflowIntegrationBinding`.
- Add provider/status enums only where stable; keep provider keys code-defined
  if plugins/adapters will expand independently.
- Add audit-safe test/rotation metadata.

#### Model

- Add org-constrained connection and binding queries.
- Return ciphertext only to the integration service/Activity path, never to
  controllers or views.

#### Service

- Add versioned authenticated credential encryption service.
- Add provider registry contracts: credential schema, non-secret config schema,
  connection test, adapter factory, capability list, redaction.
- Add integration service for create/update/rotate/test/disable/bind with
  auditing that never includes secrets.
- Add Activity-side resolver using org ID + binding key.
- Implement database-backed activity idempotency model/service.
- Begin with one synthetic adapter and one simple real adapter only after the
  security boundary is proven.

#### Controller & Routes

- Specialized admin integration routes for connection lifecycle, connection
  test, credential rotation, and workflow binding.
- Never return stored credential values; edit forms accept replacement only.

#### Views & Content Widgets

- Organization integration connection list/detail/create/rotate/test pages.
- Workflow binding page that shows missing/healthy/disabled requirements.
- Execution start page blocks launch when required bindings are unavailable.

#### Tests / Exit gate

- Encryption round trip/key-version/rotation/redaction tests.
- Cross-org credential isolation tests.
- Retry classification and idempotent Activity tests.
- Audit/log snapshots proving secrets never appear.
- Exit when an Activity resolves a bound connection without credentials ever
  entering Workflow history or the browser.

### Phase 5 — Operations, observability, scheduling, and safe deployment

**Goal:** make the platform supportable before migrating complex workflows.

#### Database / Schema

- Add activity idempotency records if not already added. Do not persist Worker
  heartbeats unless a later, documented business requirement justifies it.
- Add `WorkflowSchedule` when schedule administration is implemented.

#### Model

- Add bounded operational queries and stale projection scans.

#### Service

- Implement Worker reachability/build diagnostics using Temporal APIs,
  process/container health, structured logs, and metrics.
- Add schedule service wrapping Temporal Schedule APIs with org/role policy.
- Add periodic reconciliation for execution and human-task projections.
- Add payload codec/data converter and key rotation procedure.
- Add metrics for starts, completions, failures, open tasks, action latency,
  Activity failures, reconciliation drift, server health, and Worker health.
- Define Workflow retry/timeout/cancellation defaults and per-registration
  overrides.
- Define replay history fixtures, patching/versioning rules, and Worker rollout
  procedure.

#### Controller & Routes

- Admin operations dashboards for cluster health, Workers, queues, failed/stale
  projections, schedules, and safe retry/reconcile actions.
- No generic "send arbitrary signal" admin endpoint.

#### Views & Content Widgets

- Operational status, schedules, stale projection, and remediation views.
- Link to Temporal UI only for authorized administrators.

#### Tests / Exit gate

- Replay compatibility CI gate.
- Self-hosted integration suite covering server/Worker/web restarts.
- Schedule overlap/pause/catch-up tests.
- Payload encryption and key rotation test.
- Backup/restore and upgrade runbooks reviewed.
- Exit when deployments can preserve in-flight workflows and operators can
  distinguish application, Worker, integration, and Temporal failures.

### Phase 6 — Showcase migration waves

Each workflow migration follows the same vertical slice:

1. move/refactor shared domain contracts;
2. register type, start form, action forms, state summary, permissions, and
   integration requirements;
3. adapt deterministic Workflow code without importing application services;
4. replace synthetic Activities with registered adapters or explicitly labeled
   synthetic connections;
5. create/close generic human tasks at durable waits;
6. add application state projection updates at meaningful transitions;
7. port time-skipping, retry, failure, cancellation, and restart tests;
8. add replay history fixture before subsequent incompatible changes;
9. add no bespoke route/view unless the generic renderer cannot express a
   genuinely domain-specific experience.

#### Wave 6A — Human interaction baseline

- Customer Onboarding
- Human Approval

Proves sequential Activities, integration selection from admin bindings,
generic start forms, approval/rejection/request-changes/resubmit, reminders,
email tasks, and role policy.

Implementation status: completed on 2026-08-14 as the first migrated showcase
wave. `showcase.customerOnboarding` and `showcase.humanApproval` are
code-registered, seeded/enabled for admin role policy, bound to the seeded
Synthetic Echo integration, and operated through the generic `/workflows`,
`/workflow-tasks`, `/workflow-task-tokens`, and execution-refresh surfaces. No
workflow-specific Express route or Handlebars template was added.

#### Wave 6B — External side effects and failure recovery

- Order Fulfillment Saga
- Data Synchronization

Proves compensation, database-backed idempotency, retry classification,
parallel fan-out/fan-in, targeted reconciliation, and multiple integration
bindings.

Implementation status: completed on 2026-08-14 as the second migrated showcase
wave. `showcase.orderFulfillmentSaga` and `showcase.dataSynchronization` are
code-registered, seeded/enabled for admin role policy, bound to the seeded
Synthetic Echo integration, and operated through the generic `/workflows` and
execution-refresh surfaces. The order workflow keeps compensation sequencing in
Temporal Workflow state while Activities use the database-backed idempotency
ledger. The data-sync workflow fans out CRM/ERP/Billing work in parallel and
reconciles mismatched targets without adding workflow-specific Express routes
or Handlebars templates.

#### Wave 6C — Long-running and child workflows

- Employee Lifecycle
- Client Engagement

Proves future timers, date-change/cancel Signals, cleanup, blockers, parent-child
visibility, parallel workstreams, and long-lived deployment compatibility.

Implementation status: completed on 2026-08-14 as the third migrated showcase
wave. `showcase.employeeLifecycle` and `showcase.clientEngagement` are
code-registered, seeded/enabled for admin role policy, bound to the seeded
Synthetic Echo integration, and operated through the generic `/workflows`,
`/workflow-tasks`, `/workflow-task-tokens`, and execution-refresh surfaces. The
employee workflow uses Temporal timers, manager checklist tasks, Activity-side
provision/verify/deprovision steps, and cancellation cleanup. The client
engagement workflow uses real Temporal child workflows for implementation
workstreams, then waits for client UAT approval before go-live and post-launch
review. No workflow-specific Express route or Handlebars template was added.

#### Wave 6D — Files and AI integrations

- AI Document Processing
- AI Support Agent

Proves asset-reference inputs, AI credentials from integration bindings,
structured output validation, confidence/policy gates, human correction,
approval-gated tools, and idempotent tool audit. Raw documents and model prompts
must not be copied indiscriminately into Event History.

Implementation status: completed on 2026-08-14 as the fourth migrated showcase
wave. `showcase.aiDocumentProcessing` and `showcase.aiSupportAgent` are
code-registered, seeded/enabled for admin role policy, bound to the seeded
Synthetic Echo integration, and operated through the generic `/workflows`,
`/workflow-tasks`, `/workflow-task-tokens`, and execution-refresh surfaces. The
document workflow accepts document references, performs synthetic AI
classification/extraction/enrichment, gates by confidence and validation, and
uses a generic review task for correction or rejection. The support-agent
workflow accepts a safe case summary, retrieves synthetic context, gates
proposed credit/tool actions behind human approval, validates outcomes, and
stores only non-secret response summaries. No workflow-specific Express route or
Handlebars template was added, and raw documents, prompts, full transcripts,
provider credentials, and unredacted tool payloads are kept out of Workflow
history.

#### Wave 6E — Scheduling and complex case management

- Compliance Review
- Underwriting Capstone

Proves schedules, multiple simultaneous evidence tasks, reminders/escalations,
late evidence, parallel child risk checks, missing-information loops, analyst
decisions, cancellation, and decision audit history.

Implementation status: completed on 2026-08-14 as the fifth migrated showcase
wave. `showcase.complianceReview` and `showcase.underwritingCapstone` are
code-registered, seeded/enabled for admin role policy, bound to the seeded
Synthetic Echo integration, and operated through the generic `/workflows`,
`/workflow-tasks`, `/workflow-task-tokens`, execution-refresh, and admin
schedule surfaces. The compliance workflow accepts schedule-friendly review
input, runs automated controls, creates simultaneous evidence tasks, uses
Temporal timers for reminder/escalation waits, and generates a report summary.
The underwriting workflow uses parent/child risk-check workflows, loops for
missing information, exposes analyst decisions through the generic action
surface, supports cancellation cleanup, and records decision history in query
state. No workflow-specific Express route, controller, model, table, or
Handlebars template was added.

### Phase 7 — Documentation convergence and implementation handoff

**Goal:** make repository guidance describe the system that was actually built,
not the pre-Temporal boilerplate or an outdated proposal.

This phase is mandatory after implementation and before the Temporal platform
is considered complete. Documentation updates made during earlier phases are
reviewed again against the final source, schema, runtime topology, routes,
deployment behavior, and tests.

#### Architecture and agent guidance

- Update `ARCHITECTURE.md` with the final HTTP and Temporal request/execution
  lifecycles, dependency table, ownership boundaries, annotated file map,
  schema summary, deployment processes, organization context, integration
  resolution, human-task lifecycle, and one worked end-to-end Workflow example.
- Update root `AGENTS.md` with Temporal golden rules, new startup/sync systems,
  required verification commands, and task-to-skill routing.
- Update `skills/SKILL-conventions.md` with the final cross-layer dependency
  rules and Temporal-specific prohibited imports.
- Create or revise `skills/SKILL-temporal.md` so it matches the implemented
  registry, Worker, Workflow, Activity, client gateway, payload, testing,
  versioning, and deployment patterns.
- Update other affected skills, including data modeling, services,
  controllers, routes, validation/errors, cross-cutting systems, admin, views,
  and testing, wherever Temporal introduced a real variation or additional
  required step.
- Update `skills/README.md` and the task-to-skill table so future agents are
  routed to the Temporal guidance.

#### Developer and operator documentation

- Update `README.md` with prerequisites, self-hosted startup, migrations,
  namespace/bootstrap steps, separate web/Worker commands, ports, health
  checks, common development flows, and troubleshooting.
- Update `.env.example` with every final typed variable, safe placeholders, and
  explanations; remove abandoned variables.
- Document local self-hosted versus Temporal Cloud configuration without
  implying that local Compose is a production topology.
- Add or update runbooks for Worker deployment, replay verification, Workflow
  versioning, credential-key rotation, payload-codec rotation, Temporal backup
  and restore, server upgrades, namespace changes, stuck execution diagnosis,
  projection reconciliation, and integration credential rotation.
- Document the security model for organization isolation, email task tokens,
  secrets, payload/history data, Temporal UI access, logs, and audit redaction.
- Document the operational ownership of Temporal persistence separately from
  application PostgreSQL and Redis/BullMQ.

#### Source-of-truth cleanup

- Compare this plan with the finished implementation and mark superseded
  proposals or deferred items explicitly; do not leave speculative file names
  presented as current architecture.
- Update `TEST_PLAN.md`, `TEST_RESULTS.md`, or their replacements with the final
  Temporal test matrix and verified results.
- Update Docker Compose, package scripts, inline comments, seed documentation,
  example commands, and route/page maps so they agree with the final runtime.
- Search the repository for stale statements such as the Worker running inside
  `server.ts`, the old model list, old ports, old commands, or Temporal being
  absent.

#### Final documentation exit gate

- A new contributor can start the complete local stack using only `README.md`.
- An agent can select the correct files and dependency direction using only
  `AGENTS.md`, `ARCHITECTURE.md`, and the routed skills.
- Every documented command and link is exercised or mechanically checked.
- The documented Prisma model list and route/file map match the repository.
- The final architecture clearly distinguishes current implementation,
  optional production guidance, and deferred future work.
- No secret values, real credentials, or plaintext task tokens appear in docs,
  fixtures, screenshots, or example environment files.

Implementation status: completed on 2026-08-14. Phase 7 reconciled the
architecture docs, README, agent guidance, Temporal skill, test plan, test
results, implementation plan status, and Temporal operations runbook against the
finished Phase 0-6E source.

## 8. Handoff Inventory

The completed implementation updated these source-of-truth categories:

- Runtime and dependency setup: `package.json`, `package-lock.json`,
  `.env.example`, `docker-compose.yml`, `src/config/index.ts`.
- Startup/sync and app routing: `src/server.ts`, `src/lib/pageSync.ts`,
  `src/lib/routeSync.ts`, `src/lib/workflowSync.ts`, `src/routes/index.ts`,
  `src/routes/admin.routes.ts`, `src/routes/workflow.routes.ts`,
  `src/routes/workflowTask.routes.ts`, and specialized admin route files.
- Data model and seed: `prisma/schema.prisma`, Temporal/platform migration
  directories, `prisma/seed.ts`.
- Workflow platform services/models/controllers/views:
  workflow catalog/execution/human-task/integration/idempotency/schedule/
  operations services and models, plus `/workflows`, `/workflow-tasks`,
  `/admin/workflows`, `/admin/integrations`, and
  `/admin/workflow-operations` views.
- Temporal runtime: `src/lib/temporalClient.ts`, `src/temporal/worker.ts`,
  `src/temporal/forms.ts`, `src/temporal/contracts.ts`,
  `src/temporal/workflow-registry.ts`, `src/temporal/workflows/`, and
  `src/temporal/activities/`.
- Documentation and guidance: `README.md`, `ARCHITECTURE.md`, `AGENTS.md`,
  `skills/README.md`, `skills/SKILL-conventions.md`,
  `skills/SKILL-temporal.md`, `TEST_PLAN.md`, `TEST_RESULTS.md`, and
  `docs/temporal-operations-runbook.md`.
- Tests: service tests for registry/catalog/execution/human tasks/integrations/
  idempotency/schedules/operations/health plus live smoke evidence captured in
  `TEST_RESULTS.md`.

The generic admin CRUD registry is not the primary seam for workflows,
integrations, executions, tasks, or schedules. These features have stateful
operations and secret/authorization rules, so they require specialized admin
controllers and routes as required by the repository conventions.

The documentation files above are implementation deliverables, not optional
cleanup. They must be updated after the final code and migration shape is known
so repository guidance reflects implementation reality.

## 9. Cross-Cutting Risks and Mitigations

### Risk: database-driven catalog becomes arbitrary code execution

Mitigation: code registry owns executable types, validators, Signals/Updates,
and provider adapters; admin owns only safe metadata and bindings.

### Risk: PostgreSQL becomes a second workflow engine

Mitigation: label execution data as a projection; never implement timers or
retry transitions there; reconcile from Temporal.

### Risk: secrets leak into Temporal history, logs, audit, or forms

Mitigation: stable connection IDs only in Workflow data, Activity-only secret
resolution, authenticated encryption, explicit redactors, and leak tests.

### Risk: current multi-tenancy is too shallow

Mitigation: implement explicit active-org middleware and organization-scoped
queries before workflow endpoints; never authorize by global role alone.

### Risk: dual-write inconsistency between Temporal and PostgreSQL

Mitigation: idempotent writes, action receipts, projection reconciliation, and
Temporal-authoritative state. Do not promise a distributed transaction.

### Risk: generic forms become an unmaintainable low-code engine

Mitigation: small typed field vocabulary, code-defined validation, constrained
admin overrides, and domain-specific views only when justified.

### Risk: incompatible Workflow deployments break in-flight executions

Mitigation: replay tests, patch/version discipline, retained old behavior, and
Worker deployment/versioning procedures before complex migrations.

### Risk: self-hosted Temporal is treated as one disposable container

Mitigation: pinned versions, separate persistence, health checks, backup and
upgrade runbooks, namespace configuration, and independent Worker deployment.

### Risk: Temporal UI bypasses application authorization

Mitigation: keep it development/admin-only and place it behind independent
network/auth controls outside local development.

## 10. Test Strategy

Use four layers:

1. **Pure unit tests:** registries, schemas, permissions, encryption, redaction,
   ID policy, state summarizers.
2. **Service tests:** mocked Temporal Client/models for start, action,
   cancellation, idempotency, authorization, and reconciliation.
3. **Workflow tests:** Temporal time-skipping environment for every workflow,
   including timers, retries, Signals/Updates, cancellation, child workflows,
   and compensation.
4. **Self-hosted acceptance tests:** real server + separate Worker + web app for
   restarts, duplicate requests, email task flows, schedules, and integration
   resolution.

Every phase must run the repository baseline:

```bash
npm run typecheck
npm test
```

Later phases add Temporal replay and integration suites without replacing the
existing tests.

Every implementation phase also verifies:

- all relative TypeScript imports end in `.js`;
- Prisma is imported only by models and `src/lib/prisma.ts`;
- routes contain no business logic;
- controllers validate at the boundary, call one primary service, and return
  standard envelopes for JSON;
- services contain business logic, authorization, auditing, and orchestration
  without Express request/response objects or direct Prisma access;
- models are query-only and every read is soft-delete-aware;
- all expected failures use `AppError`;
- all application-owned models use soft delete and indexed deletion state;
- business mutations are audited with sensitive fields redacted;
- views and helpers perform no data fetching;
- new hardcoded pages/routes are represented in startup synchronization;
- Workflows import only deterministic contracts and Temporal Workflow APIs;
- Activities reach persistence through services/models and never import Prisma
  or models directly.

## 11. Recommended First Implementation Increment

Implement Phases 0 and 1 as the first pull request boundary, but keep commits
separable:

1. self-hosted Temporal Compose and typed connection configuration;
2. separate empty Worker and web Client diagnostics;
3. explicit active-organization context;
4. code workflow registry and database catalog synchronization;
5. admin definition/role configuration and user catalog.

Do not migrate Customer Onboarding in that increment. The first proof should
show that the platform can register and permission a deliberately tiny internal
test workflow without creating workflow-specific routes or views. Phase 2 then
proves execution, and Phase 3 proves human interaction before showcase code is
migrated.

## 12. Decisions to Make During Implementation, Not Before Analysis

These are intentionally deferred until the relevant phase produces evidence:

- Signals versus Updates for each human action (the platform supports both);
- polling versus SSE after correctness of execution detail is proven;
- whether deterministic Workflow code needs separate workspace packages;
- whether search attributes are necessary beyond the application projection;
- when one task queue should split by privilege or workload;
- first real provider adapter after the encrypted integration boundary exists;
- exact production self-hosted topology, because local Compose is not a
  production deployment design.

None of these blocks Phase 0.
