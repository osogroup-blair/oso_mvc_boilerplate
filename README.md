# MVC Boilerplate — Node · TypeScript · Express · Prisma · Handlebars

A schema-driven MVC starter with a service layer, a dynamic admin CRUD area, and
skill files that teach a coding agent how to extend it consistently.

---

## ⚡ Quick start (one command)

Prerequisites: **Node 20+** and **Docker** (for Postgres).

```bash
npm run setup
```

That single command will:
1. Copy `.env.example` → `.env`
2. Install dependencies
3. Start Postgres in Docker
4. Generate the Prisma client, run migrations, and seed demo data
5. Build CSS
6. Start the dev server

When it finishes, open:
- **Admin area:** http://localhost:3000/admin
- **Users admin:** http://localhost:3000/admin/user
- **Pages admin (CMS):** http://localhost:3000/admin/page
- **Public CMS page:** http://localhost:3000/pages/welcome
- **Health check:** http://localhost:3000/health
- **REST API:** http://localhost:3000/api/users

> No Docker? Point `DATABASE_URL` in `.env` at any Postgres instance, then run
> `npm install && npm run db:migrate && npm run db:seed && npm run dev`.

---

## 🧭 For the coding agent (read this first)

This project is designed to be extended by an AI coding agent. Point your agent
at **[`AGENTS.md`](./AGENTS.md)** — it's the entry point IDEs and coding agents
look for automatically. It links to:

- **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — mental model, request lifecycle,
  annotated file map, a worked end-to-end example, and a glossary. Read first.
- **[`/skills`](./skills)** — one skill per pattern, each with YAML frontmatter so
  the agent loads only what it needs. Start at [`skills/README.md`](./skills/README.md).

**Before writing any code**, the agent should read
[`skills/SKILL-conventions.md`](./skills/SKILL-conventions.md) — it covers the
non-obvious rules (ESM `.js` import extensions, layering, anti-patterns) that
cause the most errors.

Skills by task: data-modeling, model, service, controller, route, validation &
errors, cross-cutting services, admin CRUD, views, and testing.

---

## 🏛 Architecture

```
Request
  → Route            (URL → controller; no logic)
  → Controller       (validate, call service, shape response; no DB)
  → Service          (business logic; permissions, audit, cache)
  → Model            (Prisma queries only; soft-delete aware)
  → Prisma → PostgreSQL
```

Server-rendered views receive a **JSON payload** assembled by the controller and
render it with Handlebars. Views never touch the database.

### Project layout
```
src/
  config/         Zod-validated env config
  lib/            AppError, logger, prisma, response envelope, query helper, sanitize
  middleware/     requestId, logging, security (helmet + rate limit), auth, error handler
  services/       BaseService + auth, permissions, user, cache, storage, audit
  models/         BaseModel + user, auditLog (Prisma wrappers)
  controllers/    user (REST) + admin (dynamic) + resourceRegistry
  routes/         health, user, admin, index
  admin/          schema.types, schema.registry, schemas/*  (schema-driven admin)
  views/          Handlebars layouts, partials, admin templates, renderField helper
prisma/           schema.prisma + seed.ts
skills/           agent instructions (SKILL-*.md)
tests/            Vitest setup + example service test
```

---

## 🗂 The schema-driven admin

One controller and two templates render a CRUD UI for **any** registered model.
A model's admin page is fully described by an `AdminSchema` (see
`src/admin/schemas/user.schema.ts`), which supports:

- scalars (`text`, `email`, `number`, `boolean`, `date`, `select`, `textarea`)
- **nested objects** (`type: "object"`) — rendered as a nested fieldset, stored as JSON
- **arrays of primitives** (`type: "array"`, `itemType: "text"`) — repeatable inputs
- **arrays of objects** (`itemType: "object"`) — **inline-editable table**
- **relations** (`type: "relation"`) — **searchable dropdown**, options pre-fetched by the controller

Nesting is handled by the recursive `renderFields` helper in
`src/views/helpers/renderField.ts` (Handlebars itself is logic-less). Add a new
admin page in 4 steps — see `skills/SKILL-admin.md`.

---

## 📜 Scripts
| Command | Does |
|---------|------|
| `npm run setup` | One-command bootstrap (above) |
| `npm run dev` | Start dev server with hot reload |
| `npm run build` / `npm start` | Compile TS / run compiled server |
| `npm run db:migrate` | Create + apply a Prisma migration |
| `npm run db:seed` | Seed demo data |
| `npm run db:reset` | Drop, re-migrate, re-seed |
| `npm run css:watch` | Rebuild Tailwind on change |
| `npm test` / `npm run test:watch` | Run Vitest |
| `npm run typecheck` | Type-check without emitting |

---

## 🔒 Built-in cross-cutting concerns
Typed config, structured logging (Pino) with request correlation IDs, a global
error handler with a consistent error envelope, Helmet + rate limiting, input
sanitization, soft deletes, an audit log, pagination/sort/search, a swappable
cache, a swappable storage service, and a health check — all wired in and ready.

---

## Stack
| Layer | Choice |
|-------|--------|
| Runtime | Node 20 + TypeScript |
| Framework | Express |
| Views | Handlebars (server-side) |
| ORM | Prisma |
| Database | PostgreSQL |
| Validation | Zod |
| Styles | Tailwind CSS |
| Logging | Pino |
| Tests | Vitest |

---

## 📄 CMS pages (data-driven views)

The boilerplate ships with a small CMS that demonstrates the "view rendered off a
JSON payload" pattern end to end. A `Page` stores its content as an ordered array
of JSON **blocks**; the public controller hands those blocks to the view, which
renders each by type via a dynamic partial. Editors manage pages at
`/admin/page`; visitors see the result at `/pages/:slug`.

- Add a block type: create `views/partials/blocks/<type>.hbs` and list it in
  `views/helpers/viewHelpers.ts`. See `skills/SKILL-views.md`.
- Reference: `src/controllers/page.controller.ts`, `src/views/pages/show.hbs`,
  `src/views/partials/blocks/*`, seeded page `welcome`.
