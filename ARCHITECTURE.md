# Architecture

Read this first. It gives the mental model, the request lifecycle, an annotated
map of the codebase, a worked end-to-end example, and a glossary. For *how to
build* a specific thing, follow the matching file in `/skills`.

## Mental model
A request flows straight down through layers, each with one job, and the
response flows back up. **Data flows down as it's fetched; HTML/JSON is produced
at the edges.** Every layer may only depend on the layers beneath it.

```
HTTP request
   │
   ▼
Route         maps URL → controller method. No logic.
   │
   ▼
Controller    validates input, calls ONE service, shapes the response. No DB.
   │
   ▼
Service       business logic. Orchestrates models + cross-cutting services.
   │            (auth · permissions · cache · storage · audit · settings)
   ▼
Model         Prisma queries only. Soft-delete aware. No logic.
   │
   ▼
Prisma → PostgreSQL
```

Temporal introduces a second process path without changing the HTTP layering:

```
Temporal Worker
   │
   ▼
Workflow       deterministic orchestration code only
   │
   ▼
Activity       calls application services or integration adapters
   │
   ▼
Service → Model → Prisma
```

The web process owns the Temporal Client gateway. The Worker process owns
Workflow bundles and Activities. `server.ts` must not start the Temporal Worker,
and application controllers must not import Worker or Workflow implementation
modules.

Workflow integrations follow the same rule. Admins create organization-scoped
integration connections and bind them to workflow requirements in the web app,
but Workflows never receive credentials. Activities resolve bindings through
`integration-resolver.service.ts`, decrypt credentials inside the Worker
process, and pass only non-secret results back into Workflow history.

Server-rendered views receive a **JSON payload** built by the controller and
render it with Handlebars. Views never fetch data.

## Request lifecycle (concrete)
`GET /pages/welcome`:
1. `middleware`: assign request id → security headers → rate limit → log.
2. `optionalAuth`: attaches `req.user` if a valid session token is present.
3. `injectNavigation`: fetches and permission-filters the nav tree into `res.locals`.
4. Settings middleware injects `siteName`, `accentColor`, etc. into `res.locals`.
5. `maintenanceMiddleware`: if `MAINTENANCE_MODE=true`, returns 503 and stops.
6. `routes/index.ts` → `routes/page.routes.ts` matches `/pages/:slug` →
   `PageController.show`.
7. `PageController` calls `pageService.getPublishedBySlug("welcome")`.
8. `PageService` calls `PageModel.findPublishedBySlug` (filters
   `status=PUBLISHED`, `deletedAt=null`).
9. `PageModel` runs the Prisma query against Postgres.
10. Controller builds a payload `{ title, seo, blocks }` and
    `res.render("pages/show", …)`.
11. The view walks `blocks` and renders each via its partial (`blockPartial`
    helper). HTML returns to the visitor.
12. If the page is missing, the service returns null, the controller throws
    `AppError.notFound`, and the global error handler renders `error.hbs`.

If no static Express route matches, `dynamicRouting` middleware runs last and
checks the `Route` table for a matching pattern — it may redirect, serve a CMS
page, or fall through to 404.

## Annotated file map
```
src/
  server.ts              Process entry: starts HTTP server, calls syncAppPages/syncAppRoutes/syncWorkflowDefinitions, graceful shutdown.
  app.ts                 Express assembly: middleware order, Handlebars, helpers, routes.

  config/index.ts        Zod-validated env. The ONLY place process.env is read.

  lib/                   Framework-agnostic utilities.
    AppError.ts            Typed error + factory methods (notFound, forbidden, …).
    logger.ts              Pino logger (pretty in dev, JSON in prod).
    prisma.ts              The single PrismaClient instance.
    response.ts            ok() / fail() response envelope.
    query.ts               List query parsing: pagination, sort, search.
    sanitize.ts            Strip HTML from user strings (anti-XSS).
    pageSync.ts            Startup utility: upserts hardcoded app pages into the DB.
    routeSync.ts           Startup utility: upserts known Express routes into the DB as APP-type Route records.
    temporalClient.ts      Temporal Client gateway for diagnostics, task-queue poller checks, start, describe, query, cancel, signal, and schedules.
    workflowSync.ts        Startup utility: syncs code-registered workflow definitions into the DB catalog.

  integrations/
    index.ts               Typed provider registry (integrationProviders tuple) plus IntegrationProviderKey/AdapterFor/OperationFor types.
    types.ts               IntegrationProviderRegistration, ProviderOperation (retrySafe, idempotency-key support, retention, data classes), egress, defineIntegrationProvider.
    http.ts                Shared egress client: host policy, private-network/DNS-rebinding block, timeouts, response cap, safe logging, ProviderHttpError + classifyProviderError.
    contract.ts            ProviderContractFixture type for the provider contract suite (tests/providers/).
    providers/<name>/      One module per provider: schemas.ts (Zod), adapter.ts (adapter interface + factory), index.ts (registration), contract.fixture.ts, README.md.
                           synthetic-echo (no network) and webhook-outbound (reference for real HTTP: signed, Idempotency-Key, classified errors).
    provider-registry.ts   Deprecated re-export of index.ts, kept for one release.
    availability.ts        Single binding/connection availability evaluator shared by start gating, Activity resolvers, and operations; IntegrationUnavailableError.
    safety.ts              Provider-call guards: timeout with AbortSignal and credential-value scrubbing for stored/audited messages.

  middleware/
    requestId.ts           Correlation id per request.
    requestLogger.ts       HTTP logging bound to the id.
    security.ts            Helmet headers + rate limiter.
    auth.ts                requireAuth / optionalAuth / requirePermission guards → attaches req.user.
    errorHandler.ts        notFound + global error formatter (JSON or HTML).
    dynamicRouting.ts      Checks the Route table for DB-stored URL rules (PAGE / REDIRECT / APP).
                           Runs after all static routes as a catch-all router.
    maintenance.ts         Reads MAINTENANCE_MODE setting; returns HTTP 503 + maintenance.hbs for non-admin paths.
    navigation.ts          Fetches NavigationItem tree, filters by page permissions, injects into res.locals.navigation.
    pageMeta.ts            enforcePagePermissions(slug) factory — per-route page access control + SEO injection.

  services/              Business logic. Extend BaseService.
    BaseService.ts         Scoped logger + DI convention.
    health.service.ts      Aggregates DB and Temporal connectivity for /health.
    auth.service.ts        Sessions, login, verify, logout.
    permissions.service.ts Role→action matrix; can()/assert(); getActionsForRole().
    cache.service.ts       Swappable cache (Map → Redis).
    storage.service.ts     Swappable file storage (disk → S3).
    audit.service.ts       Writes the audit trail (AuditLog rows).
    log.service.ts         Audit log queries + system health diagnostics (DB latency, memory, uptime).
    user.service.ts        User CRUD. Hashes passwords. Audits mutations.
    page.service.ts        CMS page logic (public + admin). Handles allowedRoles M2M.
    role.service.ts        Role CRUD. Manages permissions String[].
    route.service.ts       Dynamic URL routing CRUD + pattern lookup.
    navigationItem.service.ts  Hierarchical nav tree builder (recursive parent/children).
    session.service.ts     listActive / countActive / revoke (soft delete + audit).
    setting.service.ts     Site settings: SETTING_KEYS registry, in-memory cache, get/set/setMany.
    project.service.ts     Project CRUD. Owner FK. Soft-delete aware.
    task.service.ts        Task CRUD with M2M tag management (TaskTag join rows).
    tag.service.ts         Tag vocabulary CRUD.
    organizationContext.service.ts  Resolves active organization context without guessing among multiple memberships.
    workflow-catalog.service.ts     Syncs workflow code registrations, admin metadata, role policy, and user catalog filtering.
    workflow-execution.service.ts   Starts Temporal workflows, maintains the DB execution projection, refreshes state, and cancels runs.
    workflow-human-task.service.ts  Creates durable human tasks from Activities, lists/action-checks inbox tasks, sends token links, signals workflow actions, and records receipts.
    integration.service.ts          Admin connection CRUD, credential rotation/testing, workflow binding validation, start gating, and audit redaction.
    integration-resolver.service.ts Activity-side binding lookup, provider validation, and credential decryption seam.
    credential-encryption.service.ts AES-256-GCM credential encryption/decryption plus non-secret fingerprints.
    activity-idempotency.service.ts Activity operation idempotency for retry-safe integration side effects.
                                    Stale RUNNING claims recover after the admin-managed Workflow Operations timeout.
    workflow-schedule.service.ts   App-owned Temporal schedule projection lifecycle: create, describe/sync, pause, unpause, trigger, delete.
    workflow-operations.service.ts Worker/cluster diagnostics and stale execution projection reconciliation.

  temporal/
    forms.ts               Re-export of src/lib/forms.ts (serializable form vocabulary shared by workflow registrations and integration providers).
    workflow-registry.ts   Code-owned workflow registrations (defineWorkflow), collision and provider/capability validation, RequirementKeyFor/IntegrationRequirementKey types.
    worker.ts              Separate Temporal Worker process entrypoint. Does not import Express/server.
    workflows/             Deterministic Workflow modules. No services, Prisma, Node I/O, or config imports.
    activities/            Activity modules. May call application services and integration adapters.
      integration-activity.ts runIntegrationOperation: resolve-before-reserve, non-retryable INTEGRATION_* failures, idempotent provider calls.

  models/                Prisma wrappers. Extend BaseModel. Soft-delete aware.
    BaseModel.ts           Shared soft-delete filter helpers.
    user.model.ts
    page.model.ts          Includes allowedRoles (PageRole[]) with role relation.
    auditLog.model.ts      Supports LogFilters (actorId, entityType, action, from/to).
    role.model.ts
    route.model.ts         Includes allowedRoles (RouteRole[]) with role relation.
    workflowDefinition.model.ts  Workflow catalog, role policy, and integration requirement query wrapper.
    workflowExecution.model.ts   Organization-scoped workflow execution projection queries.
    workflowHumanTask.model.ts   Durable human task, role visibility, token, and action receipt query wrapper.
    integrationConnection.model.ts  Organization integration connection queries with safe/secret projections.
    workflowIntegrationBinding.model.ts  Organization workflow requirement binding queries.
    activityIdempotency.model.ts Activity idempotency reservation/result queries.
    navigationItem.model.ts  Recursive include for children.
    session.model.ts       listActive / countActive / findById / deleteById (hard delete).
    setting.model.ts       getAll / set (key-value store).
    project.model.ts
    task.model.ts          Includes taskTags → tag relation.
    tag.model.ts

  controllers/
    user.controller.ts     REST controller for /api/users.
    page.controller.ts     Public CMS renderer (blocks → view) + home page.
    admin.controller.ts    ONE dynamic controller for all schema-driven admin CRUD.
    adminAuth.controller.ts  Admin login/logout form (session cookie based).
    log.controller.ts      Audit log list/detail, diagnostics dashboard, live log stream (SSE).
    project.controller.ts  Public-facing project index, show, and task form pages.
    task.controller.ts     REST API for tasks (create, update, delete, tag management).
    workflow.controller.ts Authenticated workflow catalog, start form, execution list/detail, refresh, and cancel handlers.
    workflowTask.controller.ts Authenticated workflow task inbox/detail/action handlers plus public token task handlers.
    resourceRegistry.ts    Maps admin model key → AdminResource interface (the CRUD seam).

    admin/                 Feature-specific admin controllers (break out of generic CRUD).
      permission.admin.controller.ts  Role × Resource permission matrix view + save.
      session.admin.controller.ts     Active session list + force-logout.
      setting.admin.controller.ts     Grouped settings form (get/post per group).
      workflow.admin.controller.ts    Workflow definition metadata and role capability policy.
      integration.admin.controller.ts Organization integration connections and workflow requirement bindings.
      workflow-operations.admin.controller.ts Temporal operations dashboard, schedule admin, and projection reconciliation.

  routes/
    index.ts               Mounts all route groups.
    health.routes.ts       GET /health
    user.routes.ts         /api/users
    admin.routes.ts        /admin — login, logout, logs, permissions, sessions, settings, /:model CRUD.
    page.routes.ts         /pages/:slug
    project.routes.ts      /projects (public-facing project pages)
    task.routes.ts         /api/projects/:projectId/tasks and /api/tasks (tag endpoints)
    workflow.routes.ts     /workflows authenticated workflow catalog and execution screens
    workflowTask.routes.ts /workflow-tasks authenticated task inbox and /workflow-task-tokens public token task links

    admin/
      setting.admin.routes.ts  /admin/settings (GET index, POST update-group)
      workflow.admin.routes.ts  /admin/workflows catalog configuration
      integration.admin.routes.ts /admin/integrations connection CRUD, tests, credential rotation, and workflow bindings
      workflow-operations.admin.routes.ts /admin/workflow-operations diagnostics, schedules, and reconciliation

  admin/                 Schema-driven admin system.
    schema.types.ts        Field/schema type vocabulary (FieldDef, AdminSchema, etc.).
    schema.registry.ts     Registers each model's admin schema; getSchema(key).
    schemas/               One schema per admin model:
      user.schema.ts, page.schema.ts, role.schema.ts, route.schema.ts,
      navigationItem.schema.ts, project.schema.ts, task.schema.ts, tag.schema.ts

  views/                 Handlebars. Data in → HTML out. Never fetches.
    layouts/
      main.hbs             Admin layout (sidebar, topbar, flash messages).
      public.hbs           Visitor layout (nav, footer, settings-injected branding).
    partials/
      admin-sidebar.hbs    Navigation sidebar with grouped links for all admin sections.
      settings-field.hbs   Reusable settings form field fragment.
      fields/              Admin form field fragments (one per FieldDef type).
      blocks/              CMS content-block fragments (one per block type):
                           heading, paragraph, image, list, cta, quote, unknown.
      projects/            Project-specific partials.
    admin/
      index.hbs            Admin dashboard.
      list.hbs             Generic paginated list view (all schema-driven models).
      form.hbs             Generic create/edit form (all schema-driven models).
      models.hbs           Admin model browser (lists all registered schemas).
      login.hbs            Standalone admin login page (no layout).
      placeholder.hbs      Stub page for sections not yet built out.
      logs/
        audit-list.hbs     Paginated audit log table with filters.
        audit-detail.hbs   Single audit log entry with before/after diff.
        diagnostics.hbs    System health dashboard (DB status, memory, uptime).
      permissions/
        matrix.hbs         Role × Resource permission grid (checkboxes).
      sessions/
        list.hbs           Active session table with force-logout button per row.
      settings/
        index.hbs          Grouped settings form (Identity, Content, Email, Security, UI).
      workflows/
        list.hbs           Admin workflow definition list.
        detail.hbs         Admin workflow metadata and role capability matrix.
      integrations/
        list.hbs           Organization connection list with provider/test status.
        new.hbs            Create connection form; credentials are write-only.
        detail.hbs         Connection metadata, test, rotate credentials, and disable actions.
        workflow-bindings.hbs Workflow requirement-to-connection binding matrix.
      workflow-operations/
        dashboard.hbs      Temporal diagnostics, worker pollers, schedule counts, and stale projection reconciliation.
        schedules.hbs      Organization schedule list.
        new-schedule.hbs   Temporal schedule create form.
        schedule-detail.hbs Schedule status, Temporal description, pause/unpause/trigger/delete controls.
    pages/
      show.hbs             Public CMS page renderer (walks blocks array).
    projects/
      index.hbs            Public project list.
      show.hbs             Public project detail + task list.
      form.hbs             Task create/edit form.
    workflows/
      catalog.hbs          Authenticated workflow catalog for the active organization.
      start.hbs            Generic workflow start form rendered from registry metadata.
      executions.hbs       Organization-scoped execution list.
      execution-detail.hbs Execution status, summaries, refresh, and cancel controls.
    maintenance.hbs        Standalone HTTP 503 page (no layout).
    error.hbs              Generic error page.
    helpers/
      renderField.ts       Recursive admin form field renderer; registers renderField + blockPartial helpers.
      viewHelpers.ts       General Handlebars helpers: eq, formatDate, json, truncate, etc.

prisma/
  schema.prisma          All models (see Prisma schema section below).
  seed.ts                Idempotent demo data for all models.
skills/                  Agent instructions — read the relevant one before building.
tests/                   Vitest setup + example service tests.
```

## Prisma schema — current models

```
Domain
  User          id/email/name/roleId/bio/isActive/passwordHash/address(JSON)/tags(String[])/posts/sessions/projects
  Post          id/title/body/published/authorId — 1-to-many child of User
  Session       id/userId/token/expiresAt — hard-deleted on revoke; no soft delete
  AuditLog      id/actorId/action/entityType/entityId/changes(JSON)
  Role          id/name/description/permissions(String[])/users/pageRoles/routeRoles/workflowDefinitionRoles

CMS
  Page          id/slug/title/status(PageStatus)/blocks(JSON)/seo(JSON)/allowedRoles(PageRole[])/isHardcoded/filePath/publishedAt
  PageRole      join table: pageId + roleId (M2M Page <-> Role)
  PageStatus    enum: DRAFT | PUBLISHED | ARCHIVED
  NavigationItem  id/label/url/order/parentId/children (self-referencing tree)

Dynamic Routing
  Route         id/pattern/targetType/targetValue/redirectCode/isActive/allowedRoles(RouteRole[])/priority
  RouteRole     join table: routeId + roleId (M2M Route <-> Role)
  RouteTargetType  enum: PAGE | REDIRECT | APP

Demo: Project / Task / Tag Manager
  Project       id/name/description/status(ProjectStatus)/ownerId/tasks
  Task          id/title/description/status(TaskStatus)/priority(TaskPriority)/dueDate/meta(JSON)/projectId/taskTags
  Tag           id/name/color
  TaskTag       join table: taskId + tagId (M2M Task <-> Tag)
  ProjectStatus enum: ACTIVE | ON_HOLD | COMPLETED | ARCHIVED
  TaskStatus    enum: TODO | IN_PROGRESS | IN_REVIEW | DONE | CANCELLED
  TaskPriority  enum: LOW | MEDIUM | HIGH | CRITICAL

Configuration
  SiteSetting   id/key(unique)/value — global key-value store for site config

Multi-Tenancy
  Organization  id/name/slug/logoUrl/members
  OrgMember     orgId/userId/role(OrgRole)/joinedAt — soft-deleted membership
  OrgRole       enum: OWNER | ADMIN | MEMBER

Workflow Platform
  WorkflowDefinition  key/slug/workflowType/contractVersion/defaultTaskQueue/name/description/category/icon/isEnabled/presentation(JSON)
  WorkflowDefinitionRole  workflowDefinitionId/roleId/capability(WorkflowCapability)
  WorkflowIntegrationRequirement  workflowDefinitionId/key/providerKey/capabilityKey/label/description/isRequired
  IntegrationConnection  orgId/name/providerKey/status/config/credentialCiphertext/credentialIv/credentialAuthTag/credentialKeyVersion/credentialFingerprint/lastTestedAt/lastTestStatus/lastTestMessage/disabledAt
  WorkflowIntegrationBinding  orgId/workflowDefinitionId/requirementKey/connectionId/isEnabled/lastValidatedAt/lastValidationStatus/lastValidationMessage
  ActivityIdempotency  orgId/scope/idempotencyKey/status/requestHash/response/error/lockedAt/completedAt/expiresAt
  WorkflowSchedule  orgId/workflowDefinitionId/createdById/scheduleId/name/description/cronExpression/timezone/input/inputSummary/status/overlapPolicy/catchupWindowSeconds/pauseOnFailure/lastTemporalStatus/lastSyncedAt/pausedAt
  WorkflowExecution  orgId/workflowDefinitionId/startedById/workflowId/runId/businessKey/status/inputSummary/stateSummary/error/startedAt/completedAt/lastSyncedAt
  WorkflowHumanTask  orgId/workflowExecutionId/workflowId/runId/taskKey/taskType/title/description/status/assignedUserId/actionForm/context/result/dueAt/openedAt/closedAt
  WorkflowHumanTaskRole  taskId/roleId
  WorkflowTaskToken  taskId/tokenHash/recipientEmail/label/expiresAt/consumedAt/revokedAt
  WorkflowActionReceipt  orgId/taskId/workflowExecutionId/actionKey/idempotencyKey/channel/status/actorUserId/tokenId/requestHash/result/error
  WorkflowCapability enum: START | VIEW | ACT | CANCEL | ADMIN
  WorkflowExecutionStatus enum: PENDING | RUNNING | COMPLETED | FAILED | CANCELED | TERMINATED | TIMED_OUT | UNKNOWN
  WorkflowHumanTaskStatus enum: OPEN | COMPLETED | CANCELED | EXPIRED
  WorkflowActionChannel enum: AUTHENTICATED | TOKEN
  WorkflowActionReceiptStatus enum: RECEIVED | SUCCEEDED | FAILED
  IntegrationConnectionStatus enum: ACTIVE | DISABLED | CONFIG_ERROR
  IntegrationTestStatus enum: NOT_TESTED | SUCCEEDED | FAILED
  ActivityIdempotencyStatus enum: RECEIVED | RUNNING | SUCCEEDED | FAILED
  WorkflowScheduleStatus enum: ACTIVE | PAUSED | DELETED | ERROR
  WorkflowScheduleOverlapPolicy enum: SKIP | BUFFER_ONE | BUFFER_ALL | CANCEL_OTHER | TERMINATE_OTHER | ALLOW_ALL
```

## Cross-cutting systems

### Dynamic Routing
The `Route` table stores URL rules managed in the admin. On every GET request
that misses all static Express routes, `dynamicRouting` middleware runs and:
1. Looks up the request path in the Route table.
2. Enforces `allowedRoles` access control (RouteRole[] M2M).
3. Dispatches: `REDIRECT` → `res.redirect`; `PAGE` → looks up Page by slug and
   renders `pages/show`; `APP` → falls through (already handled).

`routeSync.ts` runs at startup to upsert known Express app routes as `APP`-type
inventory records so admins can see them. APP records are read-only; static
Express routes do not acquire database authorization by being discovered.

### Site Settings
`SiteSetting` is a key-value table. `settingService` wraps it with:
- An **in-memory cache** populated at first access (`initCache()`).
- A `SETTING_KEYS` registry that declares every valid key, its group, type,
  label, and default value.
- `get(key)` / `set(key, value)` / `setMany(entries)` — all mutations are
  audited.

Settings are injected into `res.locals` by `app.ts` middleware on every request
(`siteName`, `accentColor`, `logoUrl`, `footerText`, `siteDescription`).
The admin `/settings` page groups them by `SETTING_KEYS[key].group`.

To add a new setting: add an entry to the `SETTING_KEYS` object in
`setting.service.ts`. No migration needed — the key-value table is schema-free.

`PUBLIC_APP_URL` is the admin-managed absolute base URL used for workflow task
email links. Do not put that behavior in `.env`.

### Maintenance Mode
`maintenanceMiddleware` reads `MAINTENANCE_MODE` from `settingService`. If
`true`, non-admin and non-asset requests receive HTTP 503 + `maintenance.hbs`.
Admin paths (`/admin*`) always bypass maintenance.

### Navigation
`NavigationItem` stores a hierarchical tree (self-referencing via `parentId`).
`injectNavigation` middleware fetches the tree on every request, permission-
filters items that link to restricted pages, and writes to `res.locals.navigation`
so all Handlebars templates can render the nav without fetching data.

### Page Sync
`pageSync.ts` runs at startup. It upserts the `HARDCODED_PAGES` list (routes
backed by real `.hbs` files, e.g. `/projects`, `/admin/login`) into the `Page`
table as inventory. Role editing is effective only for CMS pages and explicitly
guarded static slugs in `STATIC_PAGE_POLICIES`; other hardcoded rows hide role
controls and reject role writes. The projects policy currently guards its index,
not every project detail route. Navigation filtering is not direct-URL authorization.

### Workflow Catalog Sync
`workflowSync.ts` runs at startup after page/route sync. It validates the
code-owned registry in `temporal/workflow-registry.ts`, upserts immutable code
facts into `WorkflowDefinition`, and syncs declared integration requirements.
Admins may edit only safe metadata (`name`, `description`, `category`, `icon`,
`presentation`, `isEnabled`) and role capabilities. Executable workflow code,
workflow type names, validators, actions, and integration requirement keys come
from deployed TypeScript code, not database-authored code.

User catalog visibility at `/workflows` requires an active organization context,
global `workflow:read`, an enabled definition, and a matching
`WorkflowDefinitionRole` row with `VIEW` or `START`. When a user belongs to
multiple organizations, the app asks them to choose instead of silently choosing
the first membership.

### Workflow Executions
Authenticated users start workflows from registry-defined forms at
`/workflows/:slug`. The controller validates request shape, then
`workflow-execution.service.ts` re-validates against the code-owned registry,
checks global `workflow:start`, enforces per-definition `START`, verifies that
all required workflow integration bindings are available for the active
organization, starts Temporal through `temporalClient.ts`, and creates a
`WorkflowExecution` projection row.

Execution detail pages are backed by the DB projection, not by direct view-layer
Temporal calls. Refreshing an execution describes the Temporal run, maps Temporal
status into `WorkflowExecutionStatus`, optionally queries the workflow's
registered state query, summarizes the state, and stores it in `stateSummary`.
Cancel requires global `workflow:cancel` plus per-definition `CANCEL`, calls the
Temporal Client gateway, updates the projection, and audits the mutation.

### Workflow Human Tasks
Temporal Workflows surface user input by calling the `createHumanTask` Activity.
That Activity delegates to `workflow-human-task.service.ts`, which creates a
durable `WorkflowHumanTask` row with an action form, optional assigned user,
role visibility, optional email token, and context JSON. Creation is idempotent
by `(workflowExecutionId, taskKey)` so Temporal Activity retries/replays do not
duplicate tasks.

Authenticated users use `/workflow-tasks` and `/workflow-tasks/:id` to see and
act on tasks assigned directly to them or to their role. Public email links use
`/workflow-task-tokens/:token` and store only a SHA-256 token hash in the
database. Browser POSTs are protected with the app CSRF middleware and action
submissions are idempotent through `WorkflowActionReceipt`.

When an action is submitted, the service validates visibility/capability,
records a receipt, signals Temporal through `temporalClient.signalWorkflow()`,
closes the task, consumes token links when applicable, and audits the mutation.
Workflow code receives only the signal payload; it does not import app services,
models, Prisma, email, or settings.

### Workflow Integrations
Workflow integration requirements are declared in
`src/temporal/workflow-registry.ts` and synced to
`WorkflowIntegrationRequirement`. Admins manage actual organization connections
at `/admin/integrations`, where credentials are write-only, encrypted with
`credential-encryption.service.ts`, redacted in audit logs, and testable through
the provider registry.

Requirement bindings are organization-scoped
`WorkflowIntegrationBinding` rows. The public workflow start page renders each
required binding as `AVAILABLE`, `MISSING`, `DISABLED`, `REQUIREMENT_MISSING`,
`CONNECTION_NOT_FOUND`, `CONNECTION_UNAVAILABLE`, `PROVIDER_MISMATCH`,
`PROVIDER_UNREGISTERED`, or `CAPABILITY_MISSING`, with a reason; required
unavailable bindings block launch before Temporal is called.

Integration Activities call providers through `runIntegrationOperation`
(`src/temporal/activities/integration-activity.ts`), which resolves through
`integration-resolver.service.ts` before reserving idempotency and raises
non-retryable `INTEGRATION_*` failures for configuration problems. Start gating
and resolution share `src/integrations/availability.ts`. The
resolver loads the bound connection, decrypts credentials in the Worker process,
validates provider schemas, and returns a provider adapter. Workflow code never
imports the resolver and never stores credentials in Workflow history. Activity
side effects should use `activity-idempotency.service.ts` with a stable
idempotency key so Temporal retries do not duplicate external operations.
Stale `RUNNING` claims are recovered only through a conditional DB takeover
after the admin-managed Workflow Operations timeout.

### Migrated Showcase Workflows
The first showcase migration waves live in the generic workflow platform, not
in workflow-specific web surfaces. `showcase.customerOnboarding`,
`showcase.humanApproval`, `showcase.orderFulfillmentSaga`, and
`showcase.dataSynchronization`, `showcase.employeeLifecycle`, and
`showcase.clientEngagement`, `showcase.aiDocumentProcessing`, and
`showcase.aiSupportAgent`, `showcase.complianceReview`, and
`showcase.underwritingCapstone` are registered in
`src/temporal/workflow-registry.ts`, synced into `WorkflowDefinition`, enabled
for seeded admin role policy, and bound to the seeded `synthetic.echo`
integration requirement through `WorkflowIntegrationBinding`.

Both workflows use the existing `/workflows` start/detail/refresh screens and
the existing `/workflow-tasks` plus `/workflow-task-tokens` human-task surfaces.
If a migrated workflow needs user input, it creates a durable
`WorkflowHumanTask`; submitted action data is validated by the registered action
schema and delivered to Workflow code as `WorkflowHumanActionInput.payload`.
If a migrated workflow needs an integration, Activity code resolves the
admin-bound provider connection and wraps the side effect in
`activity-idempotency.service.ts`. The Workflow stores only non-secret state
needed for queries and summaries.

Future product workflow migrations should follow this same route:
registry metadata/forms/actions/integration requirements first, deterministic
Workflow implementation second, Activity-side services/integrations third, and
only then a new route or template if the generic renderer cannot express a
genuinely domain-specific experience.

`showcase.orderFulfillmentSaga` demonstrates reverse compensation without a
Postgres-backed workflow engine: the Workflow keeps the compensation stack in
Temporal history and Activities perform retry-safe synthetic side effects using
`ActivityIdempotency`. `showcase.dataSynchronization` demonstrates parallel
fan-out/fan-in across CRM, ERP, and Billing targets, then targeted
reconciliation for mismatched targets. Both still use the generic start and
execution projection screens.

`showcase.employeeLifecycle` demonstrates long-running timers, identity/access
provisioning, manager checklist input through durable `WorkflowHumanTask`, and
cancellation cleanup. `showcase.clientEngagement` demonstrates phased delivery,
real Temporal child workflows for implementation workstreams, client approval
through the generic task inbox/token surfaces, blocker tracking, go-live, and
post-launch review. These workflows also stay inside the generic registry,
integration binding, and execution projection model.

`showcase.aiDocumentProcessing` demonstrates document-reference processing,
AI-style classification/extraction, enrichment, confidence and validation gates,
human correction, and result storage. `showcase.aiSupportAgent` demonstrates
safe-message triage, customer/invoice context lookup, approval-gated tool
execution, outcome validation, and response summaries. These workflows use only
document references, safe summaries, structured outputs, and non-secret tool
results in Workflow input/state. Raw files, prompts, transcripts, and provider
credentials stay outside Temporal history and are handled only by
Activity-side integration seams.

`showcase.complianceReview` demonstrates schedule-compatible reviews,
automated control checks, multiple simultaneous evidence tasks, reminders,
escalations, late evidence handling, and report generation.
`showcase.underwritingCapstone` demonstrates parent/child risk-check workflows,
missing-information loops, analyst approve/reject/request-more-information
decisions, cancellation cleanup, and decision history. Both continue to use the
generic workflow catalog, start forms, integration binding checks,
`WorkflowHumanTask` action surfaces, execution projections, and admin Temporal
schedule tooling instead of workflow-specific web routes.

### Workflow Operations and Schedules
Admins with `workflow:admin` use `/admin/workflow-operations` to inspect
Temporal connectivity, configured task-queue pollers, app schedule counts, and
stale execution projections. The dashboard intentionally treats Temporal as
authoritative for workflow histories and timers; the application database stores
admin configuration and queryable projections.

`WorkflowSchedule` is the app-owned projection for Temporal schedules. Creating
a schedule at `/admin/workflow-operations/schedules/new` validates the selected
workflow definition, registry start input, required integration bindings, cron
expression, overlap policy, catch-up window, and organization context before
calling the Temporal Schedule API through `temporalClient.ts`. The service then
stores a local projection and audits the mutation. If the DB write fails after
Temporal creation, the service attempts to delete the Temporal schedule so the
two systems do not drift.

Schedule pause, unpause, trigger, and delete actions always go through
`workflow-schedule.service.ts`. Delete removes the Temporal schedule and
soft-deletes the local projection. Detail pages call `describeSchedule()` and
sync `lastTemporalStatus`; if Temporal cannot describe the schedule, the local
projection moves to `ERROR` with the error summary.

Scheduled workflow executions are not fabricated in Postgres from admin schedule
actions. A scheduled run appears in `WorkflowExecution` when the real Workflow
run calls the projection-ingestion Activity near startup. Temporal UI and the
schedule detail page remain the source of truth for schedule action history.

The reconciliation action refreshes stale `PENDING`, `RUNNING`, or `UNKNOWN`
`WorkflowExecution` rows from Temporal through `workflow-execution.service.ts`.
It is safe to re-run and audits attempted/succeeded/failed counts.

### Admin Sub-controllers
Not everything fits the generic CRUD controller. Feature-specific admin pages
live in `controllers/admin/` and `routes/admin/`:
- **Permissions matrix** (`permission.admin.controller.ts`): edits role
  `permissions` arrays through a checkbox grid.
- **Sessions** (`session.admin.controller.ts`): lists active sessions and
  calls `sessionService.revoke()`.
- **Settings** (`setting.admin.controller.ts`): renders the grouped settings
  form and calls `settingService.setMany()`.
- **Integrations** (`integration.admin.controller.ts`): manages organization
  integration connections, credential tests/rotation, disabling, and workflow
  requirement bindings.
- **Workflow operations** (`workflow-operations.admin.controller.ts`): manages
  Temporal diagnostics, schedule administration, and stale execution projection
  reconciliation.

## Worked example — add a `Product` resource end-to-end
This is the canonical vertical slice. Each step cites its skill.

1. **Schema** (SKILL-data-modeling): add `Product` to `schema.prisma` with
   `id/createdAt/updatedAt/deletedAt` + `@@index([deletedAt])`; run
   `npm run db:migrate`.
2. **Model** (SKILL-model): `src/models/product.model.ts` extending `BaseModel`,
   soft-delete-aware `list/count/findById/create/update/softDelete`.
3. **Service** (SKILL-service): `src/services/product.service.ts` extending
   `BaseService`, injecting the model + audit, throwing `AppError.notFound`,
   auditing mutations. Export a `productService` singleton.
4. **REST** (optional; SKILL-controller + SKILL-route): a controller that
   validates with Zod and wraps responses in `ok()`, plus routes mounted in
   `routes/index.ts`.
5. **Admin** (SKILL-admin): `src/admin/schemas/product.schema.ts`, register it
   in `schema.registry.ts`, and add a `productResource` adapter in
   `resourceRegistry.ts`. The page is now live at `/admin/product`.
6. **Public view** (optional; SKILL-views): a controller + `views/…` template if
   visitors see it.
7. **Test** (SKILL-testing): `tests/services/product.service.test.ts` mocking the
   model.
8. **Seed** (SKILL-data-modeling): add idempotent `upsert` demo rows to `seed.ts`.

Nothing here is invented per-resource — every step copies the `user.*` or
`page.*` files.

## Glossary
- **Layer**: one of route/controller/service/model/view — each with a single
  responsibility and a fixed dependency direction.
- **Singleton**: the shared instance a service/model exports (`userService`).
  Used everywhere except tests.
- **Admin schema**: the declarative description of a model's admin UI (fields +
  types), consumed by the one dynamic admin controller/templates.
- **Schema registry**: the map of model key → admin schema; `getSchema(key)`.
- **Resource adapter**: the object in `resourceRegistry.ts` that presents a typed
  service through the generic CRUD interface the admin controller expects.
- **Relation options map**: `{ id, label }[]` lists the controller pre-fetches
  for relation dropdowns so the view never queries.
- **List params**: normalized pagination/sort/search options passed
  controller → service → model.
- **Content block**: one typed item in a CMS page's `blocks` JSON array, rendered
  by its own partial in `views/partials/blocks/`.
- **Soft delete**: setting `deletedAt` instead of removing a row; all reads
  filter `deletedAt: null`. Exception: `Session` is hard-deleted on revoke.
- **Envelope**: the consistent `{ success, data|error, meta? }` response shape
  used by JSON API endpoints (`ok()` / `fail()`).
- **Dynamic route**: a `Route` row in the DB that maps a URL pattern to a PAGE
  render, a REDIRECT, or a known APP route — managed by admins at runtime.
- **SETTING_KEYS**: the canonical registry in `setting.service.ts` that declares
  every valid site setting key, its type, group, label, and default value.
- **Admin sub-controller**: a dedicated controller in `controllers/admin/` for
  admin features too specialised for the generic CRUD controller
  (permissions matrix, session management, settings).
- **Page sync / Route sync**: startup utilities (`pageSync.ts`, `routeSync.ts`)
  that upsert hardcoded app surfaces into the DB so admins can manage them.
- **Integration connection**: an organization-scoped provider configuration
  whose credentials are encrypted with a versioned key ring and never returned
  to views.
- **Workflow integration binding**: an organization-scoped mapping from a
  workflow requirement key to an active connection.
- **Activity idempotency**: the retry-safe reservation/result record Activities
  use when an external side effect must happen at most once per stable key.
- **Workflow schedule**: an app-owned projection of a Temporal Schedule,
  configured in admin and synchronized through the Temporal Schedule API.
- **Projection reconciliation**: an admin operation that refreshes stale local
  `WorkflowExecution` rows from Temporal history without changing workflow
  execution itself.



## October 20, 2026 implementation status

See `docs/blueprint/EXTENSION-CONTRACTS.md` for the current test ownership,
CSRF, metadata-only audit, atomic command, private-file, tenant-admin, Worker,
transport and release-bundle contracts. `docs/blueprint/DECISIONS.md` records
compatibility and rollback constraints. The execution checklist (`docs/blueprint/EXECUTION-CHECKLIST-2026-10-20.md`) separates
source, component, runtime and acceptance status. Historical test narratives
above are not evidence that the current release is production-accepted.


October 20 local completion: recoverable starts, fenced effects, Update receipts, patch-gated Workflow modules, payload protection and owned full-stack acceptance are now implemented. See `docs/blueprint/EXTENSION-CONTRACTS.md` and `docs/blueprint/LOCAL-OPERATIONS.md` for current contracts and `docs/blueprint/EXECUTION-REPORT-2026-10-20.md` for evidence. Run `npm run test:local:all` after provisioning the explicit owned fixture dependencies. Existing production execution compatibility is still gated on the actual deployed history inventory.


## October 26 security boundaries

User-directory reads are authenticated and permission-gated; account projections exclude credentials. Auth-only credential queries are separate, new accounts require explicit passwords, and public registration never falls back to a privileged role. Protected admin sections require admin:access and their own permission. Domain services check current actors, project ownership, task parents and organization membership; a role name or a hidden organization ID is insufficient.

BaseModel.mutate is the model-owned state/evidence transaction and optional command-receipt primitive. Services pass stable operation identities; no transaction client crosses layers. Metadata fingerprints are keyed and no raw request/credential content enters audit. Existing workflow/private-file journals keep their own guarantees. Public bytes are validated/re-encoded separately from private assets and delivered with restrictive headers, while executable templates use CSP nonces and explicit external UI handlers. Read docs/blueprint/MUTATION-EVIDENCE-MATRIX.md for the precise external-effect and replay boundaries.
