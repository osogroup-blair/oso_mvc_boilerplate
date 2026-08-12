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
  admin/          # Schema-driven admin system (definitions, registry, field/model schemas)
  views/          # Handlebars layouts, partials, blocks, and forms
prisma/           # Database schema definition and seed scripts
skills/           # Task-specific instructions for AI coding agents
tests/            # Vitest suite for system validation
```

---

## ⚡ Quick start (one command)

Prerequisites: **Node 20+** and **Docker** (for Postgres).

```bash
npm run setup
```

That single command will automatically:
1. Copy `.env.example` → `.env`
2. Install dependencies
3. Start PostgreSQL in a Docker container
4. Generate the Prisma client, run migrations, and seed demo data
5. Build the CSS assets
6. Start the local development server

Once setup is complete, open:
* **Admin Dashboard:** [http://localhost:3000/admin](http://localhost:3000/admin)
* **Users Management:** [http://localhost:3000/admin/user](http://localhost:3000/admin/user)
* **Pages Admin (CMS):** [http://localhost:3000/admin/page](http://localhost:3000/admin/page)
* **Public CMS page:** [http://localhost:3000/pages/welcome](http://localhost:3000/pages/welcome)
* **Health check:** [http://localhost:3000/health](http://localhost:3000/health)
* **REST API:** [http://localhost:3000/api/users](http://localhost:3000/api/users)

*No Docker? Point `DATABASE_URL` in `.env` to any active PostgreSQL instance, then run:*
`npm install && npm run db:migrate && npm run db:seed && npm run dev`

---

## Technology stack

| Layer | Choice |
|-------|--------|
| **Runtime** | Node 20 + TypeScript |
| **Framework** | Express |
| **Views** | Handlebars (server-rendered templates) |
| **ORM** | Prisma |
| **Database** | PostgreSQL |
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
