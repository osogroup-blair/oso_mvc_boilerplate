---
name: temporal
description: Use when adding or changing Temporal client, Worker, Workflow, Activity, orchestration, replay, or workflow platform behavior.
---

# SKILL: Temporal

Use this skill for any Temporal change. Read `SKILL-conventions.md` first.

## Phase 0 shape

Temporal currently exists as a runtime foundation:

- `src/lib/temporalClient.ts` is the web-process Temporal Client gateway.
- `src/temporal/worker.ts` is the separate Worker process entrypoint.
- `src/temporal/workflows/` contains deterministic Workflow code.
- `src/temporal/activities/` contains Activity code.
- `docker-compose.yml` starts a local self-hosted Temporal stack with separate
  Temporal persistence.

The generic workflow catalog, execution projection, durable human-task layer,
organization integration binding platform, operations dashboard, Temporal
schedule admin, and Phase 6A-6E showcase migrations now exist. Replay fixtures
and deeper Worker-versioning automation remain future hardening work; the
baseline versioning/runbook guidance lives in `docs/temporal-operations-runbook.md`.

## Phase 1 catalog shape

- `src/temporal/workflow-registry.ts` is the code-owned registry of deployable
  workflow definitions.
- `src/lib/forms.ts` contains the serializable form vocabulary shared by workflow
  registrations and integration providers (`src/temporal/forms.ts` re-exports it).
- `src/lib/workflowSync.ts` syncs code facts from the registry on startup.
- `src/models/workflowDefinition.model.ts` is the only Prisma wrapper for
  workflow definitions, role policy, and integration requirements.
- `src/services/workflow-catalog.service.ts` owns sync, admin metadata updates,
  role capability policy, and authenticated catalog filtering.
- `src/controllers/admin/workflow.admin.controller.ts` and
  `src/routes/admin/workflow.admin.routes.ts` own admin workflow configuration.
- `src/controllers/workflow.controller.ts` and `src/routes/workflow.routes.ts`
  own the authenticated `/workflows` catalog and user workflow screens.

Admins may edit `name`, `description`, `category`, `icon`, `presentation`,
`isEnabled`, and role capabilities. They must not edit executable workflow
types, validators, action definitions, or integration requirement keys from the
database.

## Phase 2 execution shape

- `WorkflowExecution` is the app-owned projection of Temporal executions. It is
  organization-scoped, soft-delete aware, and stores `workflowId`, `runId`,
  status, input summary, state summary, error JSON, timestamps, and actor.
- `src/models/workflowExecution.model.ts` is the only Prisma wrapper for
  execution projection queries.
- `src/services/workflow-execution.service.ts` owns start, list, detail,
  refresh, and cancel orchestration. It checks global workflow permissions,
  per-definition capabilities, active organization context, and audit logging.
- `src/lib/temporalClient.ts` is the only web-process gateway for Temporal
  start, describe, query, cancel, and diagnostics.
- `src/temporal/workflow-registry.ts` defines each workflow's start form,
  validator, optional state query name, and summarizers. Database rows do not
  define executable behavior.
- `src/views/workflows/start.hbs`, `executions.hbs`, and
  `execution-detail.hbs` render generic user workflow screens from controller
  payloads.

When adding a new startable workflow, register it in code first, expose a
serializable `startForm`, validate with Zod in `validateStart`, and optionally
provide `stateQuery`, `summarizeInput`, and `summarizeState`. Then let startup
sync create/update the database definition and configure enablement/capabilities
through `/admin/workflows`.

## Phase 3 human-task shape

- `WorkflowHumanTask` stores durable user-input work items tied to a
  `WorkflowExecution`, Temporal `workflowId`/`runId`, a stable `taskKey`,
  action form JSON, context JSON, result JSON, optional assigned user, and
  open/closed timestamps.
- `WorkflowHumanTaskRole` grants role-based task visibility.
- `WorkflowTaskToken` stores email/public-link tokens by SHA-256 hash only.
  Raw tokens appear only in generated links and are consumed after successful
  token submission.
- `WorkflowActionReceipt` records each browser action by task and idempotency
  key before signaling Temporal, then finalizes to `SUCCEEDED` or `FAILED`.
- `src/services/workflow-human-task.service.ts` owns human-task creation, inbox
  authorization, token validation, action validation handoff, Temporal signal
  orchestration, token consumption, and auditing.
- `src/controllers/workflowTask.controller.ts` validates HTTP request shape and
  renders `/workflow-tasks` authenticated views plus `/workflow-task-tokens`
  public token views.
- `src/temporal/contracts.ts` defines the Workflow/Activity contracts for
  `createHumanTask`, `closeHumanTask`, and human action signal payloads.
- `src/temporal/workflows/index.ts` includes `platformApprovalWorkflow`, the
  first generic internal workflow proving human-task creation, email-token
  links, action signaling, and projection refresh.

When a Workflow needs user input, add an action registration in
`workflow-registry.ts` with `signalName`, `inputForm`, and `validateInput`.
Workflow code should wait on a deterministic signal handler; it must not reach
into application services. Activities call `workflow-human-task.service.ts` to
create/close tasks. Browser forms post through controllers with CSRF tokens and
idempotency keys.

## Phase 4 integration shape

- Workflow integration requirements are declared in
  `src/temporal/workflow-registry.ts` and synced into
  `WorkflowIntegrationRequirement`. Requirement keys are code-owned.
- `IntegrationConnection` stores organization-scoped provider connections.
  Credentials are write-only in admin, encrypted with
  `credential-encryption.service.ts`, and excluded from safe model projections.
- `WorkflowIntegrationBinding` maps one organization + workflow definition +
  requirement key to one integration connection.
- `ActivityIdempotency` stores stable Activity side-effect reservations and
  results so Temporal retries can replay successful integration calls without
  duplicating external work. Stale `RUNNING` claims are recoverable after the
  admin-managed `ACTIVITY_IDEMPOTENCY_STALE_CLAIM_MINUTES` cutoff through an
  atomic model-layer takeover.
- `src/integrations/index.ts` is the code-owned, typed provider registry. Each
  provider is a module under `src/integrations/providers/<name>/`
  (`schemas.ts`, `adapter.ts`, `index.ts`, `README.md`; copy `synthetic-echo`)
  built with `defineIntegrationProvider`. A registration declares
  config/credential schemas and forms, test behavior, redaction, the adapter
  factory, and `operations`: per-operation `retrySafe`,
  `supportsProviderIdempotencyKey`, `responseRetentionDays`, and `dataClasses`.
  Add the provider to the `integrationProviders` tuple so
  `IntegrationProviderKey`, `AdapterFor<K>`, and `OperationFor<K>` pick it up.
  Provider modules must not import services, models, Prisma, config, or Temporal
  code (enforced by `npm run check:architecture`).
  `src/integrations/provider-registry.ts` is a deprecated re-export.
- `src/services/integration.service.ts` owns admin connection CRUD, credential
  rotation/testing, binding validation, workflow-start availability checks, and
  audit redaction.
- `src/services/integration-resolver.service.ts` is the Activity-side seam for
  resolving a workflow requirement to a bound active connection and decrypted
  provider adapter.
- `src/controllers/admin/integration.admin.controller.ts` and
  `src/routes/admin/integration.admin.routes.ts` own `/admin/integrations`.
  The views live under `src/views/admin/integrations/`.

When a Workflow needs an external integration, add an integration requirement
to the workflow registration. Registrations are wrapped in `defineWorkflow(...)`
so their keys stay literal types; `providerKey` must be a registered provider
(tsc) and `capabilityKey` a declared capability (checked by
`validateWorkflowRegistry` at boot). In Workflow code, pin each requirement key
to the workflow's own declaration with a type-only import:
`requirementKey: "syntheticEcho" satisfies RequirementKeyFor<"platform.test">`.
Workflow modules may import `src/integrations/**` and `workflow-registry.ts` as
types only. Compile-time negative tests live in `tests/types/` and run as part
of `npm run typecheck`. The Workflow should pass only non-secret
requirement keys and business payloads to Activities. The Activity calls the
provider through `runIntegrationOperation` in
`src/temporal/activities/integration-activity.ts` and returns only non-secret
output to the Workflow. Never put provider credentials into Workflow input,
signal payloads, queries, state summaries, or Temporal history.

`runIntegrationOperation({ orgId, workflowDefinitionKey, requirementKey,
providerKey, operation, scope, idempotencyKey, request }, ({ adapter,
connection }, operationKey) => ..., policy)` is the only supported shape for
integration Activities (copy `runSyntheticIntegration`). Everything is typed:
`providerKey` must be registered, `operation` must be declared by that provider,
`requirementKey` must be declared by some workflow, and `adapter` is
`AdapterFor<providerKey>`; never cast adapters (ESLint rejects `as *Adapter` in
`src/temporal/activities/`). `retrySafe` comes from the declared operation, so
`policy` only carries `classifyError`, `reconcile`, and `providerReceiptId`.
The resolver rejects an Activity whose `providerKey` differs from the
requirement's declared provider. Further:
- it resolves the binding through `integration-resolver.service.ts` **before**
  reserving an `ActivityIdempotency` row, so configuration errors never leave
  RUNNING/UNCERTAIN reservations;
- binding/connection/provider/capability problems become
  `ApplicationFailure.nonRetryable` with a type from
  `INTEGRATION_FAILURE_TYPES` in `src/temporal/contracts.ts` (compare by string
  in Workflow code; `isIntegrationConfigurationFailure(type)` helps). A prior
  SUCCEEDED result for the same request is replayed instead of failing;
- database/network errors during resolution stay retryable; provider errors are
  classified by the idempotency `policy` as before.

Availability has one definition: `src/integrations/availability.ts`
(`evaluateBindingAvailability` / `evaluateConnectionAvailability`). Start
gating (`IntegrationService.getRequirementStatuses`), the Activity resolvers,
and the operations dashboard all use it. Statuses: `AVAILABLE`, `MISSING`,
`DISABLED`, `REQUIREMENT_MISSING`, `CONNECTION_NOT_FOUND`,
`CONNECTION_UNAVAILABLE`, `PROVIDER_MISMATCH`, `PROVIDER_UNREGISTERED`,
`CAPABILITY_MISSING`. Do not add a second availability check anywhere; extend
the evaluator and `tests/services/integration-availability.test.ts` (the
gate/resolver parity test) together.

Required integration availability is shown on `/workflows/:slug` and enforced
by `workflow-execution.service.ts` and `workflow-schedule.service.ts` before
Temporal start or schedule creation. Because Temporal keeps firing schedules
afterwards, `/admin/workflow-operations` lists active schedules whose required
bindings are no longer available. Admins configure actual bindings per
organization at `/admin/integrations`.

Admin connection tests (`IntegrationService.testConnection`) validate stored
config/credentials, abort after the `INTEGRATION_TEST_TIMEOUT_SECONDS` site
setting (providers must honour the `signal` passed to `testConnection`), scrub
every credential value from the result message (`src/integrations/safety.ts`,
plus the optional provider `redactMessage`), and never change the status of a
DISABLED connection. Test results are written with a compare-and-swap on the
credential fingerprint, so a result from before a rotation is discarded.

## Phase 5 operations and schedule shape

- `WorkflowSchedule` stores the app-owned projection of a Temporal Schedule:
  organization, definition, creator, Temporal schedule id, cron, timezone,
  input/input summary, status, overlap policy, catch-up window, pause-on-failure
  flag, last Temporal status JSON, and sync timestamps.
- `src/models/workflowSchedule.model.ts` is the only Prisma wrapper for
  schedule projection queries and soft-delete.
- `src/services/workflow-schedule.service.ts` owns schedule create, describe
  sync, pause, unpause, trigger, delete, registry input validation, integration
  gating, and audit logging.
- `src/services/workflow-operations.service.ts` owns Temporal diagnostics,
  task-queue poller visibility, stale projection queries, and reconciliation.
- `src/controllers/admin/workflow-operations.admin.controller.ts` and
  `src/routes/admin/workflow-operations.admin.routes.ts` own
  `/admin/workflow-operations` and `/admin/workflow-operations/schedules`.
- `src/views/admin/workflow-operations/` renders the operations dashboard,
  schedule list, schedule create form, and schedule detail/actions.
- `src/lib/temporalClient.ts` is the only web-process Temporal Schedule API
  gateway. Controllers and views must not call Temporal directly.

Temporal remains the source of truth for timers, retries, and schedule action
history. The app stores admin configuration and queryable projections. Do not
fake scheduled workflow execution rows in `WorkflowExecution`; scheduled runs
must create/update execution projections from the real Workflow start via the
projection-ingestion Activity.

Schedule deletes remove the Temporal schedule and soft-delete the local
projection. If Temporal describe fails, the app projection can move to `ERROR`
with a non-secret error summary. The stale reconciliation action should refresh
existing execution projections through `workflow-execution.service.ts` and audit
attempted/succeeded/failed counts.

## Phase 6A/6B/6C/6D/6E migrated showcase workflow shape

- `showcase.customerOnboarding` and `showcase.humanApproval` are migrated
  showcase workflows. They are code-registered in
  `src/temporal/workflow-registry.ts`, synced to `WorkflowDefinition`, enabled
  for seeded admin role policy, and bound to the seeded `synthetic.echo`
  connection for local development.
- `showcase.orderFulfillmentSaga` and `showcase.dataSynchronization` are the
  Phase 6B migrated workflows. They use the same generic surfaces while proving
  external side effects, database-backed Activity idempotency, saga
  compensation, parallel fan-out/fan-in, validation, and targeted
  reconciliation.
- `showcase.employeeLifecycle` and `showcase.clientEngagement` are the Phase
  6C migrated workflows. They use the same generic surfaces while proving
  long-running timers, cancellation cleanup, manager/client human input,
  blocker tracking, and real Temporal child workflows for implementation
  workstreams.
- `showcase.aiDocumentProcessing` and `showcase.aiSupportAgent` are the Phase
  6D migrated workflows. They use the same generic surfaces while proving
  document-reference inputs, AI-style extraction/proposal gates, human
  correction/approval, approval-gated tools, outcome validation, and
  idempotent Activity-side side effects without storing raw files, prompts, or
  full transcripts in Workflow history.
- `showcase.complianceReview` and `showcase.underwritingCapstone` are the Phase
  6E migrated workflows. They use the same generic surfaces while proving
  schedule-compatible compliance reviews, simultaneous evidence tasks,
  reminders/escalations, parent/child risk-check workflows,
  missing-information loops, analyst decisions, cancellation cleanup, and
  decision history.
- They use the generic `/workflows` catalog/start/execution screens and generic
  `/workflow-tasks` plus `/workflow-task-tokens` human-task screens. Do not add
  workflow-specific controllers, routes, or templates unless the generic form
  renderer cannot express a real domain requirement.
- `WorkflowHumanActionInput.payload` carries the full validated action input
  from browser forms into deterministic Workflow signal handlers. Keep
  top-level `decision` and `comment` for common summaries, but read
  action-specific fields from `payload`.
- Workflow code must stay deterministic. It may create/close human tasks through
  Activities and call Activity functions that perform integration side effects.
  It must not import services, integration resolvers, models, Prisma, config,
  logger, or Node I/O.
- `runShowcaseSyntheticStep` is the Phase 6A/6B/6C/6D/6E synthetic Activity seam. It
  calls the workflow's admin-bound `syntheticEcho` requirement through
  `runIntegrationOperation`, which resolves the binding, fails configuration
  errors fast, and wraps the Synthetic Echo call with
  `activity-idempotency.service.ts`.
- Seed data binds the seeded Synthetic Echo connection to `platform.test`,
  `showcase.customerOnboarding`, `showcase.humanApproval`,
  `showcase.orderFulfillmentSaga`, `showcase.dataSynchronization`,
  `showcase.employeeLifecycle`, `showcase.clientEngagement`,
  `showcase.aiDocumentProcessing`, `showcase.aiSupportAgent`,
  `showcase.complianceReview`, and `showcase.underwritingCapstone`. If you add
  a new migrated workflow with a required integration, update the registry,
  seed requirement/binding, and role policy together.
- Saga compensation stacks and target fan-out state belong in Workflow state and
  Temporal history. The application DB stores idempotency reservations/results
  and the summarized execution projection; it must not become a retry,
  compensation, or timer engine.
- Parent/child relationships belong in Temporal child workflows when workstream
  visibility or independent retry boundaries matter. Keep child workflow input
  non-secret and deterministic; Activities still own integrations and side
  effects.
- AI/file workflows must pass safe references and structured summaries through
  Workflow input/state/signals. Raw documents, prompts, full transcripts,
  provider credentials, and unredacted tool payloads belong in Activity-side
  services or integration adapters only and must stay outside Workflow history.
  State summaries should expose document refs, confidence/policy status, task
  status, and non-secret result identifiers.
- Schedule/case workflows should use Temporal timers, Signals, child workflows,
  and human-task Activities for durable orchestration. The application DB should
  store the catalog, projections, schedules, task/action records, idempotency,
  and audit trail; it should not become a parallel case-orchestration engine.

For future product workflow migrations, start with registry metadata, forms,
action schemas, state query/summarizer, role policy, and integration
requirements. Then add the deterministic Workflow and Activity-side seams. Treat
a bespoke route/view as an
exception requiring an explicit reason.

## Dependency rules

- HTTP code follows route -> controller -> service -> model -> Prisma.
- Web services call Temporal through the client gateway, not by importing Worker
  or Workflow implementation modules.
- Workflows import only Temporal workflow APIs and deterministic shared
  contracts. They must not import services, models, Prisma, config, logger,
  controllers, routes, Node I/O, or mutable runtime state.
- Activities may call application services and integration adapters. They must
  not import Prisma or models directly.
- Integration adapters must be called from Activities/services, not from
  controllers, views, or deterministic Workflow code.
- Worker bootstrap may import config, logger, Workflows, and Activities. It must
  not import Express app assembly, `server.ts`, routes, or controllers.

## Configuration

Read Temporal infrastructure config only through `src/config/index.ts`.
Current keys are `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE`,
`TEMPORAL_TASK_QUEUE`, `TEMPORAL_WORKER_IDENTITY`, `TEMPORAL_TLS_ENABLED`, and
`TEMPORAL_UI_BASE_URL`. The default local ports are `7243` for Temporal gRPC
and `8243` for Temporal UI so this boilerplate can run beside the
`temporal-showcase` reference stack.

Application behavior such as workflow enablement, labels, role policy, and
integration bindings belongs in database/admin configuration, not in `.env`.

Workflow task email links use the `PUBLIC_APP_URL` site setting in
`setting.service.ts`, not `.env`.

Integration credential encryption keys are infrastructure secrets, so they are
the exception: `INTEGRATION_CREDENTIAL_KEY_VERSION`,
`INTEGRATION_CREDENTIAL_KEY`, and optional `INTEGRATION_CREDENTIAL_KEY_RING`
live in `.env`, are validated in `src/config/index.ts`, and must not be read
directly elsewhere. `CredentialEncryptionService` encrypts new credentials with
the active version and decrypts existing credentials by their stored
`credentialKeyVersion` when that version is present in the key ring.

## Verification

For Temporal changes, run:

```bash
npm run typecheck
npm test
```

When Docker is available and runtime behavior changed, also verify:

```bash
npm run temporal:up
npm run dev:temporal-worker
```

For human-task changes, smoke at least one authenticated action submission and
one token-link submission when possible. Confirm the task closes, the receipt is
`SUCCEEDED`, the token is consumed for public actions, and execution refresh
projects the workflow's final state.

For integration changes, smoke at least one workflow with a required bound
connection. Confirm the start page shows the requirement as `AVAILABLE`, the
workflow starts, the Activity idempotency row is `SUCCEEDED`, execution
`stateSummary` contains only non-secret integration output, and encrypted
credential storage does not expose plaintext.

For schedule/operations changes, smoke `/admin/workflow-operations`, create a
paused schedule for a lightweight workflow, describe its detail page, pause or
unpause it when safe, trigger only if the workflow input/integrations are safe,
delete it, and confirm the app projection is soft-deleted. If a Worker is
running, confirm the dashboard reports workflow/activity pollers for the
configured task queue.

For migrated workflow changes, smoke at least one workflow through the generic
start page, any required integration availability block, generic human-task UI
or token UI if applicable, action receipt, Temporal completion, and execution
refresh projection. Confirm no provider secrets appear in `stateSummary`.

Do not add product workflow migrations or deep replay/versioning mechanics
without an explicit implementation phase and replay/versioning plan.


## October 20 blueprint contract update

The current contracts and limits are in `docs/blueprint/EXTENSION-CONTRACTS.md`
and `docs/blueprint/DECISIONS.md`. Models may own transactional command/receipt
persistence while services own authorization/business policy. Private files
require an explicit policy rather than a permissive singleton. General audit
uses metadata only. Tenant admin adapters must resolve access before record or
option reads and delegate CAS/receipt semantics to resource services/models.
Existing self-hosted Temporal executions require reviewed prior histories
before Workflow command changes; an empty corpus is a blocked release gate.


October 20 local completion: recoverable starts, fenced effects, Update receipts, patch-gated Workflow modules, payload protection and owned full-stack acceptance are now implemented. See `docs/blueprint/EXTENSION-CONTRACTS.md` and `docs/blueprint/LOCAL-OPERATIONS.md` for current contracts and `docs/blueprint/EXECUTION-REPORT-2026-10-20.md` for evidence. Run `npm run test:local:all` after provisioning the explicit owned fixture dependencies. Existing production execution compatibility is still gated on the actual deployed history inventory.
