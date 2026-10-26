# MVC Reference Architecture — Node · TypeScript · Express · Prisma · Handlebars

A robust MVC reference architecture with a service layer, a schema-driven admin CRUD generator, and a structured set of instructions (skills) that teach AI coding agents how to predictably extend the codebase.

This repository is the public reference implementation of the application architecture I use as a starting point for AI-assisted application development.

---

## Why this exists

AI tools can dramatically accelerate implementation, but acceleration becomes a liability when system boundaries are blurry or when every new feature introduces a different design pattern. If system boundaries are undefined, coding agents will guess—inventing custom database access logic in controllers, bypassing authorization checks, or sprinkling inconsistent validation schemas throughout the codebase.

This boilerplate solves that design problem by **encoding architectural decisions before implementation begins**. The application architecture is explicit enough that both human developers and AI coding agents can extend it without guessing where business logic, database queries, input validation, permissions, or server-rendered views belong.

---

## Designed for humans + coding agents

Rather than relying on one massive, generalized prompt that an AI agent might easily forget, this repository treats developer documentation as a first-class feature of the codebase. It directs agents through structured paths:

```
Developer / Coding Agent
        ↓
    AGENTS.md
        ↓
 ARCHITECTURE.md
        ↓
Task-specific SKILL
        ↓
Implementation
        ↓
Route → Controller → Service → Model → Prisma → PostgreSQL
```

When an agent is tasked with extending the codebase, it starts at [`AGENTS.md`](./AGENTS.md). This file points it to [`ARCHITECTURE.md`](./ARCHITECTURE.md) to understand the mental model, followed by the global coding conventions in [`skills/SKILL-conventions.md`](./skills/SKILL-conventions.md), and finally a task-specific skill. Each skill is structured to match a single development pattern, guaranteeing that the agent applies the same rigorous rules every single time.

---

## How the architecture works

A request flows straight down through layers, each with one defined job, and the response flows back up. Data flows down as it is fetched; HTML or JSON is produced strictly at the edges.

```
HTTP request
   │
   ▼
Route         (URL → controller method; no logic)
   │
   ▼
Controller    (validates inputs, calls ONE service, shapes the response; no DB)
   │
   ▼
Service       (contains business logic, orchestrates models & cross-cutting systems)
   │
   ▼
Model         (executes Prisma queries; soft-delete aware; no business logic)
   │
   ▼
Prisma → PostgreSQL
```

Server-rendered views receive a clean JSON payload assembled by the controller and render it with Handlebars. Views never query the database or fetch external APIs directly.

---

## Design principles

The codebase strictly enforces the following design principles:

* **Routes map requests** to controller endpoints, containing zero business logic.
* **Controllers validate inputs** via Zod schemas and shape response outputs, but never access the database directly.
* **Services own business logic** and orchestrate models, authorization checks, and audit logging.
* **Models own Prisma queries** and encapsulate database concerns like soft-delete filtering.
* **Views consume JSON payloads** and never fetch data.
* **Mutations are audited** automatically through the audit service.
* **Expected failures** use a consistent application error model (`AppError`).
* **Configuration and site settings** have explicit homes. Global configuration is stored in the database (`SiteSetting` via `settingService`) rather than floating in unstructured environment variables.

---

## Example: adding a new resource

To show how repeatable this architecture is, here is the sequence a developer or coding agent follows to add a new **Client** resource, along with the specific files they read:

1. **Define Prisma model**
   * *Action*: Add `Client` model to `prisma/schema.prisma`.
   * *Instructions*: Read [`skills/SKILL-data-modeling.md`](./skills/SKILL-data-modeling.md).
2. **Create migration**
   * *Action*: Run `npm run db:migrate` to generate SQL and update the DB client.
   * *Instructions*: Read [`skills/SKILL-data-modeling.md`](./skills/SKILL-data-modeling.md).
3. **Add data-access model**
   * *Action*: Create `src/models/client.model.ts` (extending `BaseModel`).
   * *Instructions*: Read [`skills/SKILL-model.md`](./skills/SKILL-model.md).
4. **Add ClientService**
   * *Action*: Create `src/services/client.service.ts` for business rules.
   * *Instructions*: Read [`skills/SKILL-service.md`](./skills/SKILL-service.md).
5. **Add controller**
   * *Action*: Create `src/controllers/client.controller.ts` with Zod schemas.
   * *Instructions*: Read [`skills/SKILL-controller.md`](./skills/SKILL-controller.md) and [`skills/SKILL-validation-errors.md`](./skills/SKILL-validation-errors.md).
6. **Register routes**
   * *Action*: Add routes to `src/routes/client.routes.ts` and mount them in `routes/index.ts`.
   * *Instructions*: Read [`skills/SKILL-route.md`](./skills/SKILL-route.md).
7. **Define AdminSchema**
   * *Action*: Create `src/admin/schemas/client.schema.ts` to register the UI fields.
   * *Instructions*: Read [`skills/SKILL-admin.md`](./skills/SKILL-admin.md).
8. **Add permissions**
   * *Action*: Define access rules in `permissions.service.ts`.
   * *Instructions*: Read [`skills/SKILL-cross-cutting.md`](./skills/SKILL-cross-cutting.md).
9. **Add tests**
   * *Action*: Create `tests/services/client.service.test.ts`.
   * *Instructions*: Read [`skills/SKILL-testing.md`](./skills/SKILL-testing.md).

Because the agent reads the exact instructions for each layer, it produces predictable, idiomatic code without deviating from repository standards.

---

## Schema-driven admin

Adding business resources should not require rebuilding the administrative UI from scratch. The boilerplate resolves this with a generic administrative controller and reusable, recursive templates that automatically generate complete CRUD interfaces from an `AdminSchema`.

```
Prisma Model
     ↓
AdminSchema
     ↓
Resource Registry
     ↓
Generic Admin Controller
     ↓
Dynamic Handlebars Fields
     ↓
CRUD Interface
```

For example, by defining `src/admin/schemas/user.schema.ts`, the admin interface immediately gains support for:
* **Scalars**: text, email, number, boolean, date, select, textarea
* **Nested objects** (`type: "object"`): rendered as recursive nested fieldsets and stored as JSON
* **Arrays of primitives**: repeatable inputs
* **Arrays of objects**: inline-editable tables
* **Relations** (`type: "relation"`): searchable dropdowns, with options pre-fetched dynamically by the controller

---

## Cross-cutting services

Security, audit logging, caching, storage, logging, and error handling are designed as core architectural services rather than scattered utility functions.

```
                   Permissions
                       │
Request → Service ← Audit
             ↑         │
          Cache     Storage
             ↑
          Logging
```

* **Permissions**: Role-based access control (RBAC) managed via `permissionsService`.
* **Audit**: Automatic logging of mutations (updates, deletes, creations) to track actors and entity changes.
* **Cache & Storage**: Isolated behind clean interfaces, allowing them to be swapped (e.g., from an in-memory Map to Redis, or local disk to AWS S3) without modifying business logic.
* **Logging**: Pino-powered logger with correlation IDs to trace individual HTTP requests.

---

## Project structure

```
src/
  config/         # Zod-validated environment configuration (the only place process.env is read)
  lib/            # Core utilities (AppError, logger, prisma, response envelope, query helpers)
  middleware/     # Request logging, security (Helmet + rate limiting), auth, maintenance mode, errors
  services/       # Business logic services (BaseService + auth, cache, storage, audit, settings)
  models/         # Database query wrappers (BaseModel + user, auditLog, role, page, route)
  controllers/    # Route handlers (REST controllers + dynamic admin controller)
  routes/         # Endpoint mappings (health, user, index, admin, pages)
  temporal/       # Separate Temporal worker bootstrap, workflows, and activities
  admin/          # Schema-driven admin system (definitions, registry, field/model schemas)
  views/          # Handlebars layouts, partials, blocks, and forms
prisma/           # Database schema definition and seed scripts
skills/           # Task-specific instructions for AI coding agents
tests/            # Vitest suite for system validation
```

---

## Quick start with Docker

Install Docker Engine or Docker Desktop with Compose v2. No host Node/npm or `.env` file is needed.

```bash
docker compose up --build -d --wait
```

The first run builds the Linux application image, starts PostgreSQL, Redis, Temporal and Temporal UI, applies migrations and initializes demo data. The web app and Temporal Worker run in separate containers. Subsequent starts preserve edited data and uploads rather than reapplying demo seeds. Existing databases with users are not automatically seeded.

- App: [http://localhost:3000](http://localhost:3000)
- Admin: [http://localhost:3000/admin](http://localhost:3000/admin)
- Demo admin: `alice@example.com` / `password123`
- Temporal UI: [http://localhost:8244](http://localhost:8244)

```bash
docker compose ps                         # web/worker and dependencies should be healthy
docker compose logs -f web worker initialize
docker compose down                       # stop; retain databases and uploads
docker compose up -d --wait                # start again
```

If a port is occupied, use `BOILERPLATE_HTTP_PORT=3100 BOILERPLATE_TEMPORAL_UI_PORT=8344 docker compose up --build -d --wait`. Use those same port values on later Compose commands. Set the `PUBLIC_APP_URL` site setting in admin when using a different app URL for task email links.

Public uploads, private assets, database state and bootstrap state use named volumes. Only the app and Temporal UI bind to loopback host ports. Internal services use Compose DNS, keeping this stack separate from other locally running solutions. This is a local demo setup with development credentials; production follows the release/security gates in `docs/blueprint/LOCAL-OPERATIONS.md`.

To verify a fresh installation plus persistence across down/up, run `npm run test:docker` after building the image. It creates a unique disposable Compose project, tests real login/CSRF and the Worker canary, and removes only its own test containers/volumes.

### First-run implementation guide

Fresh installations open an implementation landing page at `/`: fork/run instructions, a searchable feature toolkit, source/skill references, a first-resource walkthrough and a browser-local checklist. It stays available at `/getting-started` when you choose a product homepage under Settings → Identity → Home Page. Existing homepage selections are preserved; on an existing installation, choose the getting-started page in Settings to use the new guide as the homepage. The guide is code-owned in `src/services/getting-started.service.ts` and `src/views/pages/getting-started.hbs`; customize or unmount it before your public product launch.

### Host development alternative

With Node 24 and Docker installed, `npm run setup` retains the host development workflow: it creates `.env` if needed, installs locked dependencies, starts Postgres, deploys migrations, seeds demo data, builds CSS and runs the web watcher. `npm run temporal:up` and `npm run dev:temporal-worker` start Temporal and its host Worker separately. Run `docker compose -f docker-compose.yml -f compose.host.yml up -d db redis` to expose host development database/Redis ports. Avoid running this host-port override alongside another project already using those ports.

---

## Temporal local runtime

Temporal is installed as a self-hosted local runtime. The app can connect to a
local Temporal service, and a separate Temporal Worker process runs workflow
code. The generic workflow platform includes a code-owned workflow registry,
database-synced workflow catalog, admin enablement/role policy at
`/admin/workflows`, and authenticated user screens at `/workflows` for catalog,
start forms, execution lists, execution detail, refresh, and cancel.

The platform also includes:

* **Human tasks:** `/workflow-tasks` for authenticated task inbox/action forms
  and `/workflow-task-tokens/:token` for public email-link actions.
* **Workflow integrations:** `/admin/integrations` for organization-scoped
  integration connections, credential tests/rotation, and workflow requirement
  bindings. Workflow start pages surface required integration availability and
  block launch when a required binding is missing or unavailable.
* **Activity-side secret resolution:** integration credentials are encrypted in
  the app database, decrypted only inside Activity-side services, and never
  passed into Workflow history.
* **Activity idempotency:** external side effects use stable idempotency
  reservations; stale `RUNNING` claims can be recovered after the Workflow
  Operations timeout configured in `/admin/settings`.
* **Workflow operations:** `/admin/workflow-operations` for Temporal cluster
  diagnostics, task-queue poller visibility, schedule counts, and stale
  execution projection reconciliation.
* **Temporal schedules:** `/admin/workflow-operations/schedules` for
  organization-scoped schedule create/detail/pause/unpause/trigger/delete. The
  Temporal Schedule API owns timers; the app stores an audited schedule
  projection, and real scheduled Workflow runs ingest their own
  `WorkflowExecution` projection near startup.
* **Migrated showcase workflows:** `showcase.customerOnboarding`,
  `showcase.humanApproval`, `showcase.orderFulfillmentSaga`, and
  `showcase.dataSynchronization`, `showcase.employeeLifecycle`, and
  `showcase.clientEngagement`, `showcase.aiDocumentProcessing`, and
  `showcase.aiSupportAgent`, `showcase.complianceReview`, and
  `showcase.underwritingCapstone` run through the same generic registry, start
  forms, integration bindings, human-task inbox/token links when needed, child
  workflows where useful, Temporal schedules where configured, and execution
  projection screens. They do not add workflow-specific Express routes or
  templates. AI/file-oriented workflows use safe references and summaries
  instead of storing raw documents, prompts, transcripts, or provider
  credentials in Temporal history.

```bash
# Start self-hosted Temporal services: persistence Postgres, Temporal, and UI
npm run temporal:up

# Start the web app
npm run dev

# In a separate terminal, start the Temporal Worker
npm run dev:temporal-worker
```

Host development ports (with `compose.host.yml`):

| Service | Port |
|---------|------|
| App Postgres | 5436 |
| Temporal Postgres | 5437 |
| Temporal gRPC | 7243 |
| Temporal UI | 8244 |

The `/health` endpoint reports database and Temporal connectivity. Temporal
configuration lives in `.env` and is validated in `src/config/index.ts`;
workflow behavior such as labels, enablement, role policy, and execution
visibility is controlled through admin/database configuration. Workflow task
email links use the `PUBLIC_APP_URL` site setting from `/admin/settings`.

For the production hardening sequence, acceptance gates, known gaps, and
another-agent handoff instructions, see
[`TEMPORAL-PRODUCTION-ROADMAP.md`](./docs/blueprint/TEMPORAL-PRODUCTION-ROADMAP.md). The
operational procedures are in
[`docs/temporal-operations-runbook.md`](./docs/temporal-operations-runbook.md).
The executable test catalog for the integration plan and production roadmap is
in [`TEMPORAL-TEST-CASES.md`](./docs/testing/TEMPORAL-TEST-CASES.md).

Operational admin surfaces:

| Surface | Purpose |
|---------|---------|
| `/admin/workflows` | Code-registered workflow catalog metadata, enablement, and role capabilities |
| `/admin/integrations` | Organization connection credentials, tests, rotation, and workflow requirement bindings |
| `/admin/workflow-operations` | Temporal diagnostics, worker pollers, schedule counts, and stale projection reconciliation |
| `/admin/workflow-operations/schedules` | Temporal schedule lifecycle management |
| `/workflows` | User workflow catalog, start forms, execution list/detail, refresh, and cancel |
| `/workflow-tasks` | Authenticated human-task inbox and action forms |
| `/workflow-task-tokens/:token` | Public email-link human-task action forms |

Integration credential encryption is infrastructure config, so it lives in
`.env` and is read only through `src/config/index.ts`:

| Key | Purpose |
|-----|---------|
| `INTEGRATION_CREDENTIAL_KEY_VERSION` | Active encryption key version label stored with encrypted credentials |
| `INTEGRATION_CREDENTIAL_KEY` | Secret material used to derive the AES-256-GCM credential key |
| `INTEGRATION_CREDENTIAL_KEY_RING` | Optional JSON object of previous key versions to secret material for decrypting credentials created before rotation |

For production, replace the development placeholder with a long random secret
and keep old key versions in `INTEGRATION_CREDENTIAL_KEY_RING` until all stored
credentials have been rotated through `/admin/integrations`. New and rotated
credentials are written with `INTEGRATION_CREDENTIAL_KEY_VERSION`; existing
credentials decrypt by the `credentialKeyVersion` stored on the connection.
The seed creates a development-only `synthetic.echo` connection and binds it to
`platform.test`, `showcase.customerOnboarding`, `showcase.humanApproval`,
`showcase.orderFulfillmentSaga`, `showcase.dataSynchronization`,
`showcase.employeeLifecycle`, `showcase.clientEngagement`,
`showcase.aiDocumentProcessing`, `showcase.aiSupportAgent`,
`showcase.complianceReview`, and `showcase.underwritingCapstone` so local smoke
tests prove the full Activity-side integration path without a paid third-party
account.

---

## Technology stack

| Layer | Choice |
|-------|--------|
| **Runtime** | Node 20 + TypeScript |
| **Framework** | Express |
| **Views** | Handlebars (server-rendered templates) |
| **ORM** | Prisma |
| **Database** | PostgreSQL |
| **Workflow runtime** | Temporal TypeScript SDK, self-hosted locally |
| **Validation** | Zod |
| **Styles** | Tailwind CSS |
| **Logging** | Pino |
| **Tests** | Vitest |

---

## Testing

Run tests once or launch the interactive watcher:

```bash
# Run tests
npm test

# Run tests in watch mode
npm run test:watch
```

---

## 📄 CMS pages (data-driven views)

The boilerplate includes a CMS demonstrating how server-rendered views consume structured JSON payloads. A `Page` stores its layout as an array of JSON **blocks** (e.g. heading, paragraph, image). The controller retrieves the page and hands the blocks to Handlebars, which loops over them and renders the corresponding partial.

* **Add a block type**: Create a layout file in `views/partials/blocks/<type>.hbs` and register it in `views/helpers/viewHelpers.ts`. (See [`skills/SKILL-views.md`](./skills/SKILL-views.md) for step-by-step guidance).
* **Reference Files**: [`src/controllers/page.controller.ts`](file:///c:/Users/blair/OneDrive/Documents/Oso%20Group/mvc-boilerplate/src/controllers/page.controller.ts), [`src/views/pages/show.hbs`](file:///c:/Users/blair/OneDrive/Documents/Oso%20Group/mvc-boilerplate/src/views/pages/show.hbs), and the `welcome` page seed in [`prisma/seed.ts`](file:///c:/Users/blair/OneDrive/Documents/Oso%20Group/mvc-boilerplate/prisma/seed.ts).

---

## What this project demonstrates

As a portfolio and reference implementation, this project showcases:

* **Architecture-first application development**: Clear system boundaries that protect developer sanity and codebase longevity.
* **AI-agent development workflows**: Structured prompts, conventions, and skills integrated directly into the workspace repository.
* **Strict MVC & Service-Layer architecture**: Segregation of responsibilities across routes, controllers, services, and models.
* **Schema-driven application behavior**: Dynamic UI generation from structured definitions, eliminating repetitive boilerplate code.
* **Core infrastructure patterns**: Ready-to-go patterns for RBAC, swappable caching/storage interfaces, and automated audit trails.
* **Node.js, TypeScript, Express, PostgreSQL, Prisma, Zod, Pino, Vitest**: Clean, type-safe implementation of standard backend technologies.

---

## Reference documentation

* **[`AGENTS.md`](./AGENTS.md)** — Core entry point and task mapping for coding agents.
* **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — In-depth request lifecycle, annotated file mappings, and glossary.
* **[`/skills`](./skills)** — Task-specific markdown guidelines for extending each layer of the application.


October 20 local completion: recoverable starts, fenced effects, Update receipts, patch-gated Workflow modules, payload protection and owned full-stack acceptance are now implemented. See `docs/blueprint/EXTENSION-CONTRACTS.md` and `docs/blueprint/LOCAL-OPERATIONS.md` for current contracts and `docs/blueprint/EXECUTION-REPORT-2026-10-20.md` for evidence. Run `npm run test:local:all` after provisioning the explicit owned fixture dependencies. Existing production execution compatibility is still gated on the actual deployed history inventory.


### Security contracts and local verification

Use Node.js 20.9 or later (the image decoder's minimum; CI and the owned runtime use Node 24). The October 26 [audit implementation report](docs/blueprint/EXTERNAL-AUDIT-IMPLEMENTATION-2026-10-26.md) records account/authorization/upload fixes and [mutation evidence guarantees](docs/blueprint/MUTATION-EVIDENCE-MATRIX.md). New resources must adopt these service policies and safe output projections in addition to the layer conventions. Existing deployed roles require reviewed explicit grants; the development seed is not a production migration. Local verification does not establish deployed Temporal compatibility, remote object/CDN policy, production infrastructure acceptance or a clean dependency audit.
