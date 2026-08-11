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
- [ ] New hardcoded pages/routes are added to `pageSync.ts` / `routeSync.ts`.
- [ ] `npm run typecheck` and `npm test` pass.

