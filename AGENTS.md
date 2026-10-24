# AGENTS.md

Guidance for AI coding agents working in this repository. (Human devs: see
`README.md` to run it and `ARCHITECTURE.md` for the design.)

## Start here, in order
1. **`ARCHITECTURE.md`** — the mental model, request lifecycle, annotated file
   map, cross-cutting systems, a worked end-to-end example, and a glossary.
   Read this before writing anything.
2. **`skills/SKILL-conventions.md`** — the rules most easily gotten wrong (ESM
   `.js` import extensions, layering/dependency direction, naming, anti-patterns).
3. The specific skill for your task (table below).

## Golden rules (full list in SKILL-conventions)
- Relative imports end in **`.js`**, even for `.ts` files (ESM). This is the most
  common mistake — verify it every time.
- Respect layer boundaries: route → controller → service → model → prisma. Never
  skip up. Never import Prisma outside `models/` and `lib/prisma.ts`.
- Validate at the controller with Zod; put business logic in services; keep
  models query-only; views never fetch data.
- Throw `AppError` for expected failures; wrap JSON in `ok()/fail()`.
- Soft delete only. Audit every mutation. Never read `process.env` outside
  `config/`.
- **Site settings live in `settingService`**, not `.env`. To add a new config
  key, add it to `SETTING_KEYS` in `setting.service.ts`. No migration needed.
- **Admin sub-controllers**: if a new admin feature is too specialised for
  generic CRUD, create a file in `controllers/admin/` and a matching route file
  in `routes/admin/`. Do not bloat `admin.controller.ts`.
- **Workflow integration secrets never enter Workflows or views**: credentials
  are write-only in admin, encrypted at rest, resolved only by Activities
  through `integration-resolver.service.ts`, and redacted from audit logs.

## Task → skill
| Task | Read |
|------|------|
| Understand the codebase | `ARCHITECTURE.md` |
| Anything (conventions, gotchas) | `skills/SKILL-conventions.md` |
| Add/change a DB model or migration | `skills/SKILL-data-modeling.md` |
| Add a data-access model | `skills/SKILL-model.md` |
| Add business logic | `skills/SKILL-service.md` |
| Add a REST endpoint | `skills/SKILL-controller.md` + `skills/SKILL-route.md` |
| Validate input / handle errors | `skills/SKILL-validation-errors.md` |
| Use auth/permissions/cache/storage/audit | `skills/SKILL-cross-cutting.md` |
| Add an admin CRUD page | `skills/SKILL-admin.md` |
| Add a specialised admin section | `skills/SKILL-admin.md` + create `controllers/admin/` + `routes/admin/` |
| Build a server-rendered view or CMS block | `skills/SKILL-views.md` |
| Add/change Temporal client, Worker, Workflow, or Activity code | `skills/SKILL-temporal.md` |
| Add/change workflow human tasks, action signals, token task links, or workflow receipts | `skills/SKILL-temporal.md` + `skills/SKILL-validation-errors.md` |
| Add/change workflow integration providers, connections, bindings, or Activity idempotency | `skills/SKILL-temporal.md` + `skills/SKILL-cross-cutting.md` |
| Add/change workflow schedules, Temporal operations dashboard, worker diagnostics, or projection reconciliation | `skills/SKILL-temporal.md` + `skills/SKILL-admin.md` |
| Migrate a standalone/showcase workflow onto Temporal | `skills/SKILL-temporal.md` + `skills/SKILL-service.md` + `skills/SKILL-validation-errors.md` |
| Write or run tests | `skills/SKILL-testing.md` |

## Key systems to be aware of

### Dynamic Routing
URL rules are stored in the `Route` DB table and managed via `/admin/route`.
The `dynamicRouting` middleware (runs after all static routes) resolves them at
runtime into redirects, CMS page renders, or APP pass-throughs. Do not hard-code
redirects in Express — put them in the Route table instead.

### Site Settings
Global config lives in the `SiteSetting` table, not in `.env`. Use
`settingService.get(key)` to read and `settingService.set(key, value, actorId)`
to write. All valid keys and their metadata are declared in the `SETTING_KEYS`
const in `setting.service.ts`. Adding a new setting = add an entry there.

### Temporal Runtime
Temporal runs as a separate Worker process from `src/temporal/worker.ts`.
`server.ts` starts the web application and BullMQ email worker only; it must not
start or import the Temporal Worker. Web code talks to Temporal through
`src/lib/temporalClient.ts`. Workflow modules must stay deterministic and must
not import services, models, Prisma, config, controllers, routes, logger, or
Node I/O. Activities may call application services and integration adapters, but
must not import Prisma or models directly.

### Workflow Catalog and Executions
`server.ts` calls `syncWorkflowDefinitions()` on startup. Workflow definitions
are code-registered in `src/temporal/workflow-registry.ts` and synchronized to
`WorkflowDefinition` rows. Admins configure safe metadata, enablement, and role
capabilities at `/admin/workflows`; users see permitted enabled definitions at
`/workflows`. Start/detail/list/refresh/cancel execution screens are backed by
`WorkflowExecution` projection rows and `workflow-execution.service.ts`, which
calls Temporal only through `src/lib/temporalClient.ts`. Do not store executable
workflow code or provider secrets in the catalog/execution tables.

### Workflow Human Tasks
Workflows gather user input through durable `WorkflowHumanTask` rows created by
Activities via `workflow-human-task.service.ts`. Authenticated task views live
under `/workflow-tasks`; public email-token task views live under
`/workflow-task-tokens`. Store only token hashes, protect browser POSTs with the
CSRF middleware, signal workflows through `src/lib/temporalClient.ts`, and
record idempotent `WorkflowActionReceipt` rows for every action.

Workflow task email links use the `PUBLIC_APP_URL` site setting. Do not add an
environment variable for app-facing URL behavior.

### Migrated Showcase Workflows
Phase 6A migrated `showcase.customerOnboarding` and
`showcase.humanApproval`; Phase 6B migrated
`showcase.orderFulfillmentSaga` and `showcase.dataSynchronization`; Phase 6C
migrated `showcase.employeeLifecycle` and `showcase.clientEngagement`; Phase 6D
migrated `showcase.aiDocumentProcessing` and `showcase.aiSupportAgent`; Phase
6E migrated `showcase.complianceReview` and
`showcase.underwritingCapstone`. They are normal code-registered workflows
using the generic `/workflows` start/detail/refresh screens, generic
`/workflow-tasks`/token task forms when human input is needed, real Temporal
child workflows where the orchestration needs parent/child visibility, Temporal
schedules where configured, and admin-managed integration bindings.
Do not add workflow-specific controllers, routes, or views for future migrated
workflow waves unless the generic renderer cannot express a truly
domain-specific interaction.

Action-specific browser input must be declared in the workflow registry and is
delivered to deterministic Workflow code through `WorkflowHumanActionInput.payload`.
Integration side effects belong in Activities/services via
`integration-resolver.service.ts` and `activity-idempotency.service.ts`, never
inside Workflow code.

Saga compensation and fan-out/fan-in state belongs in deterministic Workflow
state and Temporal history. Do not mirror retries, timers, or compensation
stacks into Postgres as a second workflow engine; Postgres remains catalog,
idempotency, task, audit, and projection storage.

Long waits, post-start/post-launch timers, cancellation cleanup, and child
workflow fan-out belong in Temporal Workflow code. Browser input for those waits
must surface through registered human-task actions, not bespoke polling routes
or ad-hoc tables.

Compliance evidence collection, reminder/escalation waits, missing-information
loops, analyst decisions, and cancellation cleanup also belong in Temporal
Workflow code. Surface required user input as registered action forms and
`WorkflowHumanTask` rows; do not create workflow-specific case tables unless
the generic projection/task model cannot support the product requirement.

AI/file workflow inputs must use safe references and summaries. Do not put raw
documents, full customer transcripts, prompts, model credentials, or unredacted
tool payloads into Workflow input, signal payloads, query state, summaries, or
audit/browser payloads. Activities/services own blob retrieval, provider calls,
prompt construction, tool execution, and idempotent audit-safe result storage.

### Workflow Integrations
Workflow integration requirements are declared in
`src/temporal/workflow-registry.ts` and synced to the database. Admins manage
organization connections and requirement bindings at `/admin/integrations`.
Provider definitions live in `src/integrations/providers/<name>/` and are
listed in the typed registry `src/integrations/index.ts`; they declare
credential/config schemas, test behavior, redaction, Activity adapters,
per-operation retry semantics (`operations`), and an `egress` policy. Copy
`webhook-outbound` for real HTTP providers: all network calls go through
`src/integrations/http.ts`. Every provider needs a `contract.fixture.ts`; the
contract suite in `tests/providers/` runs automatically for every registered
provider. `INTEGRATION_ALLOW_PRIVATE_EGRESS` (dev/test only, refused in
production) is the only way a provider may reach loopback/private hosts.

Credentials are infrastructure secrets. They are encrypted by
`credential-encryption.service.ts` using config from `src/config/index.ts`,
stored only as ciphertext/IV/auth tag/fingerprint, and never returned to views.
Activities resolve connections through `integration-resolver.service.ts`; do
not import that resolver from Workflow code. External side-effect Activities
should use `activity-idempotency.service.ts` with stable idempotency keys.

### Workflow Operations and Schedules
Admins manage Temporal diagnostics and schedules at `/admin/workflow-operations`.
`WorkflowSchedule` is an app-owned projection of a Temporal Schedule, not a
second scheduler. Create/pause/unpause/trigger/delete actions go through
`workflow-schedule.service.ts`, which validates workflow registry input,
required integration bindings, organization context, and audits all mutations.
`workflow-operations.service.ts` reports Temporal connectivity, configured
task-queue pollers, schedule counts, and stale execution projection
reconciliation. Do not fabricate scheduled execution rows; Temporal remains the
authority for timers and schedule action history.

### Navigation
Navigation items are stored in the `NavigationItem` table (hierarchical,
self-referencing). The `injectNavigation` middleware populates
`res.locals.navigation` on every request. Do not fetch nav data in controllers
or views.

### Maintenance Mode
Controlled by the `MAINTENANCE_MODE` site setting. The `maintenanceMiddleware`
returns HTTP 503 for all non-admin, non-asset paths when enabled. Admin paths
always bypass it.

### Startup sync
`server.ts` calls `syncAppPages()` and `syncAppRoutes()` at boot. These upsert
hardcoded app surfaces into the DB. If you add a new hardcoded page or Express
route prefix, add it to the respective `HARDCODED_PAGES` / `APP_ROUTES` arrays
in `lib/pageSync.ts` and `lib/routeSync.ts`.

### Session Management
Sessions are stored in the `Session` table (hard-deleted on revoke, not
soft-deleted). `sessionService.revoke(id, actorId)` is the canonical way to
force-logout a user. Active sessions are visible at `/admin/sessions`.

## Workflow expectations
- **Create a Layered Implementation Plan**: Before executing, your implementation
  plan must act as a precise blueprint detailing the exact files to create or
  update across each layer. Break down the work into:
  1. **Database / Schema**: Prisma schema updates & migrations (`prisma/schema.prisma`).
  2. **Model**: Query wrappers (`src/models/*`).
  3. **Service**: Business logic, authorization, auditing, and services orchestration (`src/services/*`).
  4. **Controller & Routes**: REST endpoints, request validation, and routing (`src/controllers/*`, `src/routes/*`).
  5. **Views & Content Widgets**: Handlebars layouts, templates, partials, block partials, or helpers (`src/views/*`, `src/views/partials/blocks/*`).
- Follow the reference implementation each skill cites — copy its shape.
- After changes, run `npm run typecheck` and `npm test`.
- Adding a whole resource is a vertical slice through every layer — see the
  worked example in `ARCHITECTURE.md`.
- Prefer editing/extending the established pattern over introducing a new one. If
  a genuinely new pattern is needed, add or update a skill so the next agent
  stays consistent.

## Verify before finishing
- [ ] All relative imports end in `.js`.
- [ ] No layer boundary crossed (no Prisma in controllers, no logic in models,
      no fetch in views).
- [ ] Input validated with Zod; errors are `AppError`; responses use the envelope.
- [ ] Mutations are audited; deletes are soft (except `Session` — hard-delete).
- [ ] New site config keys are registered in `SETTING_KEYS`, not added to `.env`.
- [ ] New infrastructure env keys are added to `src/config/index.ts` and `.env.example`.
- [ ] Workflow integration credentials are write-only, encrypted, Activity-resolved, and audit-redacted.
- [ ] Workflow schedules go through Temporal Schedule APIs and local projections are audited/soft-deleted.
- [ ] Migrated workflows use generic registry/forms/tasks/integration bindings before adding bespoke web surfaces.
- [ ] New hardcoded pages/routes are added to `pageSync.ts` / `routeSync.ts`.
- [ ] `npm run typecheck` and `npm test` pass.



## October 20, 2026 implementation status

See `docs/blueprint/EXTENSION-CONTRACTS.md` for the current test ownership,
CSRF, metadata-only audit, atomic command, private-file, tenant-admin, Worker,
transport and release-bundle contracts. `docs/blueprint/DECISIONS.md` records
compatibility and rollback constraints. The execution checklist (`docs/blueprint/EXECUTION-CHECKLIST-2026-10-20.md`) separates
source, component, runtime and acceptance status. Historical test narratives
above are not evidence that the current release is production-accepted.
