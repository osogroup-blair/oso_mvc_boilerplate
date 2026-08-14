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
- Seeded workflow catalog: internal `platform.heartbeat` and `platform.test`
  definitions, migrated showcase `showcase.customerOnboarding` and
  `showcase.humanApproval`, plus Phase 6B `showcase.orderFulfillmentSaga` and
  `showcase.dataSynchronization`, plus Phase 6C
  `showcase.employeeLifecycle` and `showcase.clientEngagement`, plus Phase 6D
  `showcase.aiDocumentProcessing` and `showcase.aiSupportAgent` definitions,
  plus Phase 6E `showcase.complianceReview` and
  `showcase.underwritingCapstone` definitions, plus `/workflows`
- Seeded workflow integration: development-only `synthetic.echo` connection
  bound to `platform.test`, `showcase.customerOnboarding`, and
  `showcase.humanApproval`, `showcase.orderFulfillmentSaga`, and
  `showcase.dataSynchronization`, `showcase.employeeLifecycle`, and
  `showcase.clientEngagement`, `showcase.aiDocumentProcessing`, and
  `showcase.aiSupportAgent`, `showcase.complianceReview`, and
  `showcase.underwritingCapstone`
- Temporal schedules are not seeded because creating them requires a live
  Temporal service; create disposable paused schedules during runtime smoke.

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
6. Authenticated workflow catalog: visit `/workflows`.
   - Expected: organization selector/catalog renders; only enabled and role-permitted workflows are listed.
7. Open `/workflows/platform-test` as an admin user.
   - Expected: generic start form renders from registry metadata.
8. Start `platform.test` with a short duration and unique business key.
   - Expected: app redirects to an execution detail page with RUNNING/terminal status, input summary, and state summary.
9. Refresh/cancel a visible execution.
   - Expected: refresh returns a JSON success envelope; cancel requires permission and audits the mutation.
10. Confirm `platform.test` integration gating.
   - Expected: `/workflows/platform-test` renders Required Integrations and shows the seeded Synthetic Echo binding as `AVAILABLE`.
11. Open `/workflows/showcase-human-approval` as an admin user.
   - Expected: generic migrated-workflow start form renders, Required Integrations shows seeded Synthetic Echo as `AVAILABLE`, and no workflow-specific route/template is needed.
12. Start `showcase.humanApproval` with an amount above threshold, submit the generated manager-review task from `/workflow-tasks`, then refresh execution detail.
   - Expected: task action validates with CSRF/idempotency, receipt is `SUCCEEDED`, Temporal completes, and `stateSummary.status` becomes `approved` or `rejected` without provider secrets.
13. Open `/workflows/showcase-customer-onboarding` as an admin user.
   - Expected: generic migrated-workflow start form renders requested users/integrations fields and Required Integrations shows seeded Synthetic Echo as `AVAILABLE`.
14. Start `showcase.orderFulfillmentSaga` with the compensation demo scenario.
   - Expected: generic start form launches the workflow, Activity idempotency rows are written, final projection is `compensated`, and compensation history shows reverse cleanup without provider secrets.
15. Start `showcase.dataSynchronization` with the targeted reconciliation demo scenario.
   - Expected: generic start form launches the workflow, CRM/ERP/Billing targets sync through parallel Activity calls, first target is reconciled, projection is `completed`, and target summaries contain only non-secret data.
16. Start `showcase.employeeLifecycle` with zero demo delays, then submit the generated manager-checklist task from `/workflow-tasks`.
   - Expected: generic start form launches the workflow, identity/access side effects use the admin-bound Synthetic Echo integration, manager checklist action validates, receipt is `SUCCEEDED`, access verification completes, and projection is `completed`.
17. Start `showcase.clientEngagement` with zero demo delays, then approve the generated client UAT task from `/workflow-tasks`.
   - Expected: generic start form launches the workflow, implementation workstreams run as Temporal child workflows, client approval action validates, receipt is `SUCCEEDED`, go-live/post-launch review complete, and projection is `completed`.
18. Start `showcase.aiDocumentProcessing` using a document reference and low-confidence/correction demo scenario, then submit the generated document-review task from `/workflow-tasks`.
   - Expected: generic start form launches the workflow, no raw document text is submitted or projected, AI-style side effects use the admin-bound Synthetic Echo integration, correction action validates, receipt is `SUCCEEDED`, result storage completes, and projection is `completed`.
19. Start `showcase.aiSupportAgent` with a safe case summary and credit-approval demo scenario, then approve or modify the generated agent-action task from `/workflow-tasks`.
   - Expected: generic start form launches the workflow, context/tool side effects use the admin-bound Synthetic Echo integration, tool execution waits for human approval, receipt is `SUCCEEDED`, outcome validation completes, and projection is `completed` with no prompts, transcripts, credentials, or unredacted tool payloads.
20. Start `showcase.complianceReview` with one automated and at least one manual control, then submit the generated evidence task from `/workflow-tasks`.
   - Expected: generic start form launches the workflow, automated checks use the admin-bound Synthetic Echo integration, evidence tasks are durable `WorkflowHumanTask` rows, action receipts are `SUCCEEDED`, reminders/escalations remain Temporal timers, and projection is `completed` with a report summary.
21. Start `showcase.underwritingCapstone` with a missing-information or manual-review demo scenario, submit the missing-information task, then approve/reject/request more information from the analyst task.
   - Expected: generic start form launches the workflow, risk checks run as Temporal child workflows, missing-information and analyst actions validate through registered forms, receipts are `SUCCEEDED`, cancellation cleanup is available through the same action surface, and projection reaches `approved`, `rejected`, or `cancelled` with decision history.
22. Admin workflow operations dashboard: visit `/admin/workflow-operations`.
   - Expected: Temporal status, task queue, worker poller counts or diagnostic notes, schedule counts, and stale projection section render.
23. Admin schedule lifecycle: create a paused schedule for `platform.heartbeat` or `showcase.complianceReview`, open detail, pause/unpause if safe, then delete.
   - Expected: Temporal Schedule API calls succeed, local schedule projection is created/updated, delete soft-deletes the projection, and mutations are audited.

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
6. Visit `/admin/organizations`.
   - Expected: corrected Organizations admin page renders.
7. Visit `/admin/workflows`.
   - Expected: code-registered workflow definitions render with status and configure links.
8. Open a workflow detail page.
   - Expected: metadata form, integration requirements, and role capability matrix render.
9. Visit `/admin/integrations`.
   - Expected: seeded Synthetic Echo connection renders without plaintext credentials.
10. Open `/admin/integrations/workflow-bindings/:workflowDefinitionId`.
   - Expected: workflow integration requirement rows render with binding status and provider-compatible connection options.
11. Visit `/admin/workflow-operations`.
   - Expected: operations dashboard renders without view-layer data fetching or Temporal calls from the controller/view boundary.
12. Visit `/admin/workflow-operations/schedules`.
   - Expected: schedule list renders and links to the create page.
13. Visit `/admin/settings`.
   - Expected: grouped settings form renders.
14. Visit `/admin/logs/diagnostics`.
   - Expected: diagnostics page renders and DB status is visible.
15. Logout.
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
- Workflow definitions should be code-registered and synced through `workflowSync.ts`; admin edits are metadata/policy only.
- Workflow executions should route through `workflow-execution.service.ts`; views must render controller payloads and never call Temporal directly.
- Workflow human tasks should be created/closed by Activities through `workflow-human-task.service.ts`; authenticated and tokenized browser actions must validate CSRF/idempotency, record receipts, signal Temporal, and close/consume correctly.
- Workflow integrations should be configured through `/admin/integrations`, encrypted at rest, resolved only by Activities, redacted from audit/browser payloads, and launch-gated when required bindings are unavailable.
- Workflow schedules should be configured through `/admin/workflow-operations/schedules`, call Temporal Schedule APIs through `temporalClient.ts`, store only local projections, and soft-delete projections on delete.
- Workflow operations reconciliation should refresh stale projections through `workflow-execution.service.ts` and audit attempted/succeeded/failed counts.
- Migrated showcase/standalone workflows should register generic start/action forms, state summaries, role policy, and integration requirements before adding bespoke routes or templates.
- AI/file workflow smoke should confirm Workflow input, signal payloads, state summaries, and audit/browser payloads use safe references or structured summaries rather than raw documents, prompts, full transcripts, credentials, or unredacted tool payloads.

## Pass Criteria
The boilerplate is accepted when preflight commands pass, browser smoke tests complete without visible runtime errors, seeded admin login works, representative public/admin pages render, API envelopes are correct, and production build includes runtime templates.


## Acceptance Test Files
Reusable end-to-end and smoke tests live under 	ests/acceptance/. These are test artifacts, not application runtime code. Build/runtime helper scripts remain under scripts/.



