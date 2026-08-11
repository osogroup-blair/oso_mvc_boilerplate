# MVC Boilerplate Acceptance Test Plan

## Purpose
Prove the boilerplate is stable enough to use as a starting point for new applications. The plan checks that the foundation works end to end: build/runtime assets, database schema, seed data, auth/session flow, public server-rendered pages, admin CRUD scaffolding, site settings, dynamic data, API envelopes, and error handling.

## Test Environment
- Runtime: Node 20+
- Database: local Postgres from `docker-compose.yml`
- Optional queue: local Redis from `docker-compose.yml`
- App URL: `http://localhost:3000` or `http://127.0.0.1:3000`
- Seeded admin credentials: `alice@example.com` / `password123`
- Seeded public content: `/`, `/pages/welcome`, `/projects`

## Preflight Checks
1. Run `npm install`.
   - Expected: dependencies install without package-resolution errors.
2. Run `docker compose up -d db redis`.
   - Expected: Postgres and Redis containers start; Redis may be unavailable without blocking app boot.
3. Run migrations.
   - Interactive local development: `npm run db:migrate`.
   - Automated/non-interactive acceptance: `npx prisma migrate deploy`.
   - Expected: Prisma applies migration history successfully.
4. Run `npm run db:seed`.
   - Expected: seed completes idempotently and creates roles, users, CMS page, settings, projects, tasks, and nav.
5. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.
   - Expected: all pass.
6. Confirm production templates exist after build.
   - Expected: `dist/views/layouts/main.hbs`, `dist/views/admin/index.hbs`, and `dist/views/emails/welcome.hbs` exist.

## Browser Smoke Tests
1. Health endpoint: visit `/health`.
   - Expected: JSON envelope with `success: true`, `status: up`, and `db: up`.
2. Public home page: visit `/`.
   - Expected: HTTP 200 page renders using public layout and seeded welcome content.
3. CMS page: visit `/pages/welcome`.
   - Expected: title/content blocks render; no missing partial or template errors.
4. Project index: visit `/projects`.
   - Expected: seeded projects show, including Alpha Platform, Beta Redesign, and Gamma Analytics.
5. Project detail: open a project.
   - Expected: project details and seeded task rows render.

## Authentication And Admin Tests
1. Visit `/admin` logged out.
   - Expected: redirect to `/admin/login`.
2. Submit invalid credentials.
   - Expected: login page re-renders with an authentication error.
3. Submit `alice@example.com` / `password123`.
   - Expected: redirect to `/admin`, cookie-based session is created, dashboard renders.
4. Visit `/admin/user`.
   - Expected: schema-driven user list renders with seeded users.
5. Visit `/admin/page`.
   - Expected: CMS page list renders with `Welcome to the boilerplate`.
6. Visit `/admin/settings`.
   - Expected: grouped settings form renders.
8. Visit `/admin/logs/diagnostics`.
   - Expected: diagnostics page renders and DB status is visible.
8. Logout.
   - Expected: redirect to login; subsequent `/admin` access requires auth again.

## API Smoke Tests
1. GET `/api/users` without auth.
   - Expected: JSON error envelope for missing/invalid session.
2. After login, GET `/api/users`.
   - Expected: JSON success envelope with seeded users and pagination metadata.
3. GET an unknown route.
   - Expected: HTML or JSON 404 handled by global error handler, not a raw stack trace.

## CRUD Extension Confidence Checks
1. Admin list pages use `schema.registry.ts` and `resourceRegistry.ts`.
   - Expected: registered resources load through the generic admin controller.
2. Relation dropdown pages load create/edit forms.
   - Expected: relation options are pre-fetched server-side and rendered without view-layer DB access.
3. Soft-delete actions route through services/models.
   - Expected: delete buttons/forms do not hard-delete domain records except sessions.

## Existing Local Database Baseline Note
If this repository was previously bootstrapped with `prisma db push`, the database may already contain tables before migration history exists. For that one-time local case only, run `npx prisma migrate resolve --applied 20260810220000_init`, then continue with `npx prisma migrate deploy`. Fresh databases should not need this step.

## Regression Areas To Watch
- Production start must find copied `.hbs` files under `dist/views`.
- Services/controllers must not import Prisma directly outside the model layer.
- New app resources should follow schema -> model -> service -> controller/route -> admin schema/resource registry.
- Site settings should be added through `SETTING_KEYS`, not `.env`.

## Pass Criteria
The boilerplate is accepted when preflight commands pass, browser smoke tests complete without visible runtime errors, seeded admin login works, representative public/admin pages render, API envelopes are correct, and production build includes runtime templates.


## Acceptance Test Files
Reusable end-to-end and smoke tests live under 	ests/acceptance/. These are test artifacts, not application runtime code. Build/runtime helper scripts remain under scripts/.



