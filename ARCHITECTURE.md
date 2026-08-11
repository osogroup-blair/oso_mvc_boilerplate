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
  server.ts              Process entry: starts HTTP server, calls syncAppPages/syncAppRoutes, graceful shutdown.
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
    session.service.ts     listActive / countActive / revoke (hard delete + audit).
    setting.service.ts     Site settings: SETTING_KEYS registry, in-memory cache, get/set/setMany.
    project.service.ts     Project CRUD. Owner FK. Soft-delete aware.
    task.service.ts        Task CRUD with M2M tag management (TaskTag join rows).
    tag.service.ts         Tag vocabulary CRUD.

  models/                Prisma wrappers. Extend BaseModel. Soft-delete aware.
    BaseModel.ts           Shared soft-delete filter helpers.
    user.model.ts
    page.model.ts          Includes allowedRoles (PageRole[]) with role relation.
    auditLog.model.ts      Supports LogFilters (actorId, entityType, action, from/to).
    role.model.ts
    route.model.ts         Includes allowedRoles (RouteRole[]) with role relation.
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
    resourceRegistry.ts    Maps admin model key → AdminResource interface (the CRUD seam).

    admin/                 Feature-specific admin controllers (break out of generic CRUD).
      permission.admin.controller.ts  Role × Resource permission matrix view + save.
      session.admin.controller.ts     Active session list + force-logout.
      setting.admin.controller.ts     Grouped settings form (get/post per group).

  routes/
    index.ts               Mounts all route groups.
    health.routes.ts       GET /health
    user.routes.ts         /api/users
    admin.routes.ts        /admin — login, logout, logs, permissions, sessions, settings, /:model CRUD.
    page.routes.ts         /pages/:slug
    project.routes.ts      /projects (public-facing project pages)
    task.routes.ts         /api/projects/:projectId/tasks and /api/tasks (tag endpoints)

    admin/
      setting.admin.routes.ts  /admin/settings (GET index, POST update-group)

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
    pages/
      show.hbs             Public CMS page renderer (walks blocks array).
    projects/
      index.hbs            Public project list.
      show.hbs             Public project detail + task list.
      form.hbs             Task create/edit form.
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
  Role          id/name/description/permissions(String[])/users/pageRoles/routeRoles

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
records so admins can see them and add role restrictions.

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
table so the admin can see them, assign access roles, and they appear in nav.

### Admin Sub-controllers
Not everything fits the generic CRUD controller. Feature-specific admin pages
live in `controllers/admin/` and `routes/admin/`:
- **Permissions matrix** (`permission.admin.controller.ts`): edits role
  `permissions` arrays through a checkbox grid.
- **Sessions** (`session.admin.controller.ts`): lists active sessions and
  calls `sessionService.revoke()`.
- **Settings** (`setting.admin.controller.ts`): renders the grouped settings
  form and calls `settingService.setMany()`.

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

