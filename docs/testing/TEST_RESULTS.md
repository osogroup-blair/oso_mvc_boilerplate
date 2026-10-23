# Browser Acceptance Test Results

The August browser record below is historical. The October 20 source/runtime
verification entry at the end supersedes any inference of current acceptance.

Date: 2026-08-10
Target: `http://127.0.0.1:3000`
Browser engine: Installed Google Chrome, headless mode via Chrome DevTools Protocol
Server mode: `npm run dev`
Database: local Postgres container, seeded via `npm run db:seed`
Redis: local Redis container, worker boot confirmed in server logs

## Setup Findings
- `docker compose up -d db redis` succeeded.
- `npm run db:migrate` is interactive and refused to run in this automation context.
- For automated acceptance, `npx prisma migrate deploy` is the correct command.
- This existing local DB had previously been created via `prisma db push`, so it required one-time local baselining: `npx prisma migrate resolve --applied 20260810220000_init`.
- `npm run dev` initially exposed an ESM startup bug in `queue.admin.controller.ts`; that was fixed by replacing CommonJS `require()` with ESM import.

## Browser Checks Executed
| # | Check | Result |
|---|-------|--------|
| 1 | `/health` returns success envelope and DB up | PASS |
| 2 | `/` renders seeded CMS home content | PASS |
| 3 | `/pages/welcome` renders JSON content blocks | PASS |
| 4 | `/projects` renders Alpha/Beta/Gamma seed projects | PASS |
| 5 | `/projects/seed-project-alpha` renders project tasks | PASS |
| 6 | `/admin` redirects logged-out user to login | PASS |
| 7 | Login form has unique email/password/submit controls | PASS |
| 8 | Invalid login shows authentication error | PASS |
| 9 | Valid admin login reaches dashboard | PASS |
| 10 | `/admin/user` renders seeded users | PASS |
| 11 | `/admin/page` renders seeded CMS page | PASS |
| 12 | `/admin/organizations` renders the corrected Organizations admin page | PASS |
| 13 | `/admin/settings` renders grouped settings page | PASS |
| 14 | `/admin/logs/diagnostics` renders diagnostics/system health | PASS |
| 15 | Authenticated `/api/users` returns success envelope and data | PASS |
| 16 | Unknown route renders handled 404 page | PASS |
| 17 | Logout clears admin session and returns to login | PASS |

## Evidence
The reusable browser acceptance script is `tests/acceptance/browser-acceptance-test.mjs`.
It exits non-zero on any failed check. Latest run: all 17 checks passed. Raw JSON saved during this run to `C:\tmp\mvc-browser-acceptance-latest.json`.

## Notes
- The Codex in-app browser blocked localhost/127.0.0.1 with `ERR_BLOCKED_BY_CLIENT`, so the browser run used installed Chrome headless instead.
- The API user count was 6 in this local database because prior development/browser-test users already existed. The pass condition checks the envelope and array shape, not an exact seed-only count.


## Upload Smoke Test
A reusable upload check lives at `tests/acceptance/upload-smoke-test.mjs`. Latest run passed: login, upload, media-library render, DB metadata, admin delete cleanup, and soft-delete verification.

## Temporal Phase 1
Date: 2026-08-13

Local validation after adding workflow catalog and policy:

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm test` | PASS: 13 files, 62 tests |
| `npm run build` | PASS |
| Registry collision tests | PASS |
| Workflow catalog sync/permission tests | PASS |
| Built-server smoke on port 3101 | PASS: login, `/admin/workflows`, `/workflows` |

Later phases added reusable workflow acceptance coverage and live self-hosted
Temporal smoke tests for start, action, integration, schedule, and migrated
showcase behavior.

## Temporal Phase 2
Date: 2026-08-13

Local validation after adding generic workflow execution start/detail/refresh/cancel:

| Check | Result |
|-------|--------|
| `npx prisma validate` | PASS |
| `npm run db:seed` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 14 files, 67 tests |
| `npm run build` | PASS |
| Workflow execution service tests | PASS: start, duplicate business-key conflict, refresh/query projection, cancel, permission denial |
| Live self-hosted Temporal smoke on port 3102 | PASS: login, `/workflows`, `/workflows/platform-test`, start real `platform.test`, execution detail, refresh JSON, cancel |

Smoke evidence:
- Started execution id: `e925e482-3d09-4c13-9ce3-b625fc211619`
- Business key: `phase2-a0f8bd98e1`

Finding fixed during smoke: workflow UI org-id validation was too strict
(`uuid()`), while the app seed uses the opaque id `seed-org-acme`. The
controller now treats `orgId` as an opaque non-empty string, matching current
schema/seed reality.

## Temporal Phase 3
Date: 2026-08-13

Local validation after adding generic workflow human tasks, authenticated inbox
actions, public token links, CSRF-protected action forms, Temporal action
signals, and the internal `platform.approval` workflow:

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm test` | PASS: 15 files, 72 tests |
| `npm run build` | PASS |
| Workflow registry action-signal tests | PASS |
| Workflow human task service tests | PASS: idempotent Activity creation, email token creation, authenticated signal/close, permission denial |
| Authenticated self-hosted Temporal smoke on port 3103 | PASS: `platform.approval` task created, authenticated action submitted, Temporal completed, projection refreshed to `phase: approved` |
| Public token self-hosted Temporal smoke on port 3103 | PASS: email URL used `PUBLIC_APP_URL`, token form rendered with CSRF/idempotency, token action submitted, completion view rendered, receipt `SUCCEEDED`, token consumed, projection refreshed to `COMPLETED` |

Smoke evidence:
- Authenticated task id: `326ea265-0327-4a78-b22f-602f36e574b2`
- Authenticated execution id: `3c6f4531-ccde-44ea-9b09-aaf2c0daae1f`
- Token task id: `e89fbb99-bac9-46c0-8dd5-833cb1b04e1a`
- Token execution id: `5040239f-9b04-494c-b531-d90d25b26bb9`

Finding fixed during smoke: public token submissions should not redirect back
to a consumed token URL. The token POST now renders a completion view directly.

## Temporal Phase 4
Date: 2026-08-13

Local validation after adding organization-scoped workflow integrations,
encrypted credentials, admin connection/binding screens, workflow-start
integration gating, Activity-side integration resolution, and Activity
idempotency:

| Check | Result |
|-------|--------|
| `npx prisma validate` | PASS |
| `npm run db:seed` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 19 files, 82 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS |
| Targeted Phase 4 service tests | PASS: credential encryption, Activity idempotency, integration service, integration resolver |
| Live self-hosted Temporal smoke on port 3104 | PASS: admin login, `/admin/integrations`, workflow binding page, `/workflows/platform-test` Required Integrations, start real `platform.test`, Activity resolved `synthetic.echo`, idempotency `SUCCEEDED`, execution `COMPLETED`, encrypted credential projection had no plaintext |

Smoke evidence:
- Workflow definition id: `b1bfb0dd-914f-4830-8399-1090601612a5`
- Execution id: `730478f5-492c-4f89-83db-98e71dede622`
- Business key: `phase4-smoke-344d28a798`
- Run id: `a2f9c09c-2293-4e9f-b46d-572e91f44af8`

Findings fixed during smoke: service hardening now rejects duplicate
organization connection names with `AppError.conflict`, and failed Activity
idempotency-key reuse now returns a conflict instead of falling through to a DB
unique constraint. The live smoke also confirmed the binding-page issue was a
PowerShell interpolation mistake in the test script, not an app route bug.

## Temporal Phase 5
Date: 2026-08-14

Local validation after adding Temporal operations dashboard, task-queue poller
diagnostics, app-owned `WorkflowSchedule` projections, schedule create/detail/
pause/unpause/trigger/delete admin screens, and stale execution projection
reconciliation:

| Check | Result |
|-------|--------|
| `npx prisma validate` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 87 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS |
| Targeted Phase 5 service tests | PASS: schedule create/duplicate/pause/unpause, operations dashboard, stale reconciliation audit |
| Live self-hosted Temporal smoke on port 3105 | PASS: admin login, `/admin/workflow-operations`, schedule create detail, unpause, pause, delete, local projection soft-delete |

Smoke evidence:
- Schedule projection id: `3cf7b165-66c2-4cfb-9b92-71c6a032d664`
- Schedule name: `Phase 5 Smoke a7dc2931`
- Workflow definition id: `b1bfb0dd-914f-4830-8399-1090601612a5`
- Business key: `phase5-schedule-eb26240e`
- DB soft-delete check: status `DELETED`, `deletedAt=2026-08-14T01:15:06.061Z`

Finding fixed during smoke: Node ESM rejected a named import from the CommonJS
`@temporalio/proto` package at runtime even though TypeScript accepted it. The
Temporal Client gateway now imports the proto package via the CJS-safe default
interop and destructures `temporal`.

## Temporal Phase 6A
Date: 2026-08-14

Local validation after migrating the first showcase workflows onto the generic
Temporal platform:

| Check | Result |
|-------|--------|
| `npx prisma validate` | PASS |
| `npm run db:seed` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 90 tests |
| `npm run build` | PASS |
| Targeted Phase 6A service tests | PASS: migrated registry entries, customer-onboarding start transform, human-approval manager/resubmit action validation, human-task signal payload preservation |
| Live self-hosted Temporal smoke on port 3106 | PASS: admin login, `/workflows/showcase-human-approval`, seeded Synthetic Echo binding visible as available, start real `showcase.humanApproval`, generic manager-review task created, authenticated task action submitted, receipt `SUCCEEDED`, Temporal completed, projection refreshed to approved state |

Smoke evidence:
- Execution id: `0bdd010f-523e-4e7f-ad4c-3bd6c0fc65cc`
- Task id: `8d792ddb-7c0c-48b1-b5c2-4c62f9dee7bf`
- Workflow id: `org-seed-org-acme.showcase.humanapproval.phase6a-human-approval-6e83e491`
- Run id: `1c783c4e-7f4f-4f2d-94e8-618b5daf7c31`
- Final projection: `COMPLETED` with `stateSummary.status=approved`

Finding fixed during implementation: human-task signals now preserve the full
validated browser action as `WorkflowHumanActionInput.payload`. This allows
migrated workflows to read action-specific fields such as resubmission amount
or description while keeping the common `decision`/`comment` summary fields.

## Temporal Phase 6B
Date: 2026-08-14

Local validation after migrating the external side-effect and failure-recovery
showcase workflows onto the generic Temporal platform:

| Check | Result |
|-------|--------|
| `npx prisma validate` | PASS |
| `npm run db:seed` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 93 tests |
| `npm run build` | PASS |
| Targeted Phase 6B registry tests | PASS: migrated registry entries, order item textarea parsing, data-sync changed-field/target parsing and defaulting |
| Live self-hosted Temporal order saga smoke on port 3107 | PASS: generic start page, seeded Synthetic Fulfillment binding visible as available, start real `showcase.orderFulfillmentSaga`, shipment-rejected scenario completed as `compensated`, reverse compensation history projected |
| Live self-hosted Temporal data sync smoke on port 3107 | PASS: generic start page, seeded Synthetic Data Sync binding visible as available, start real `showcase.dataSynchronization`, CRM/ERP/Billing fan-out completed, first target reconciled, final projection completed |

Smoke evidence:
- Order execution id: `a250a6f7-4a37-4d7e-bf89-87adaf790a26`
- Order workflow id: `org-seed-org-acme.showcase.orderfulfillmentsaga.phase6b-order-8f959170`
- Order run id: `504571e3-9980-4da0-83d7-9b73d50bc3b6`
- Order final projection: `COMPLETED` with `stateSummary.status=compensated`
- Order compensation history: `Refund Payment`, `Release Inventory`, `Cancel Order`
- Order Activity idempotency rows: 6, all `SUCCEEDED`
- Data Sync execution id: `049504ab-dd81-42fc-a48d-85da57859b83`
- Data Sync workflow id: `org-seed-org-acme.showcase.datasynchronization.phase6b-sync-44ca7dee`
- Data Sync run id: `0259f1fa-6045-4aba-a183-b073d4159be7`
- Data Sync final projection: `COMPLETED` with `stateSummary.status=completed`
- Data Sync Activity idempotency rows: 7, all `SUCCEEDED`

Finding fixed during smoke: PowerShell's redirect handling did not expose the
generic start redirect location reliably. The app route itself worked; the
smoke verified the exact executions through the app projection and database
rows instead of relying on the shell client's redirect metadata.

## Temporal Phase 6C
Date: 2026-08-14

Local validation after migrating the long-running and child-workflow showcase
workflows onto the generic Temporal platform:

| Check | Result |
|-------|--------|
| `npx prisma validate` | PASS |
| `npm run db:seed` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 96 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS: no whitespace errors; existing CRLF warnings only |
| Targeted Phase 6C registry tests | PASS: migrated registry entries, employee lifecycle start/action parsing, client engagement start/action parsing |
| Live self-hosted Temporal employee lifecycle smoke on port 3108 | PASS: generic start page, seeded Synthetic Employee Provisioning binding visible as available, start real `showcase.employeeLifecycle`, manager checklist task submitted from `/workflow-tasks`, receipt `SUCCEEDED`, access verification completed |
| Live self-hosted Temporal client engagement smoke on port 3108 | PASS: generic start page, seeded Synthetic Engagement Delivery binding visible as available, start real `showcase.clientEngagement`, three implementation workstreams ran as Temporal child workflows, client UAT approval submitted from `/workflow-tasks`, receipt `SUCCEEDED`, final projection completed |

Smoke evidence:
- Employee execution id: `8ebfd19a-1d70-4054-ba14-86cc317c7465`
- Employee workflow id: `org-seed-org-acme.showcase.employeelifecycle.phase6c-employee-e80a7ddb`
- Employee run id: `03d0fd8c-ea0d-4c31-ae5c-1dbf23fa095f`
- Employee manager checklist task id: `23e5fbcd-4f05-43b0-8296-22ebe0a013d2`
- Employee final projection: `COMPLETED` with `stateSummary.status=completed`, `managerChecklistStatus=completed`, and email/GitHub/SaaS systems `verified`
- Employee Activity idempotency rows: 5, all `SUCCEEDED`
- Client engagement execution id: `603e3dbc-08d7-48c3-b425-3ca264a14a26`
- Client engagement workflow id: `org-seed-org-acme.showcase.clientengagement.phase6c-client-e80a7ddb`
- Client engagement run id: `8d138fb6-f137-425b-9f38-a1ce451830f8`
- Client approval task id: `60a2599c-c8f2-4e4a-aba9-7b476522b265`
- Client final projection: `COMPLETED` with `stateSummary.status=completed`, no blockers, all phases completed, and no active child workflows
- Client child workflow ids:
  - `org-seed-org-acme.showcase.clientengagement.phase6c-client-e80a7ddb.workstream.data`
  - `org-seed-org-acme.showcase.clientengagement.phase6c-client-e80a7ddb.workstream.application`
  - `org-seed-org-acme.showcase.clientengagement.phase6c-client-e80a7ddb.workstream.integrations`
- Client Activity idempotency rows: 8, all `SUCCEEDED`

Finding fixed during smoke: the initial evidence query used a non-existent
`ActivityIdempotency.workflowId` field. The workflow behavior had already
completed successfully; the evidence query now uses the idempotency key prefixes
stored by the Activity idempotency ledger.

## Temporal Phase 6D
Date: 2026-08-14

Local validation after migrating the file/AI showcase workflows onto the generic
Temporal platform:

| Check | Result |
|-------|--------|
| `npx prisma validate` | PASS |
| `npm run db:seed` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 99 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS: no whitespace errors; existing CRLF warnings only |
| Targeted Phase 6D registry tests | PASS: migrated registry entries, AI document start/correction parsing, AI support-agent start/approval parsing |
| Live self-hosted Temporal AI document smoke on port 3109 | PASS: generic start page, seeded Synthetic AI Document binding visible as available, start real `showcase.aiDocumentProcessing`, low-confidence review task submitted from `/workflow-tasks`, correction receipt `SUCCEEDED`, result storage completed |
| Live self-hosted Temporal AI support-agent smoke on port 3109 | PASS: generic start page, seeded Synthetic AI Support Agent binding visible as available, start real `showcase.aiSupportAgent`, approval-gated credit tool action submitted from `/workflow-tasks`, receipt `SUCCEEDED`, tool execution and outcome validation completed |
| Safe-history smoke check | PASS: projected state summaries did not include raw-document, prompt, API-key, secret, full-transcript, or `extractedText` markers |

Smoke evidence:
- AI Document execution id: `73a43b78-6918-43f6-bae6-e4cc8df94097`
- AI Document workflow id: `org-seed-org-acme.showcase.aidocumentprocessing.phase6d-doc-3a7d511a`
- AI Document run id: `19ca000a-4527-45a1-9d46-76b3a8b992b1`
- AI Document review task id: `4dd22495-f851-4cd7-b24b-5fe1d5c42956`
- AI Document final projection: `COMPLETED` with `stateSummary.stage=completed`, `humanReviewStatus=corrected`, `storedResultId=stored_phase6d-doc-3a7d511a`, confidence `0.95`, and a safe `extractedDataSummary`
- AI Document Activity idempotency rows: 9, all `SUCCEEDED`
- AI Support Agent execution id: `d005a4a6-e642-4ff9-89dc-614cadf63413`
- AI Support Agent workflow id: `org-seed-org-acme.showcase.aisupportagent.phase6d-support-08bf1473`
- AI Support Agent run id: `6c7a40e2-3831-4d0c-a4b4-a1b903fc6cea`
- AI Support Agent approval task id: `e50fe902-3c32-4bfc-a475-054d616bb4c8`
- AI Support Agent final projection: `COMPLETED` with `stateSummary.stage=completed`, `approvalStatus=approved`, `validation.valid=true`, and completed `lookupCustomer`, `lookupInvoice`, `issueCredit`, `updateCase`, and `sendCustomerResponse` tool calls
- AI Support Agent Activity idempotency rows: 8, all `SUCCEEDED`

Finding fixed during smoke: the generic start service revalidates normalized
workflow input before starting Temporal. The support-agent boolean parser now
accepts both browser string values (`"true"`/`"false"`) and already-normalized
booleans so validation is idempotent across both passes.

## Temporal Phase 6E
Date: 2026-08-14

Local validation after migrating the schedule and complex case-management
showcase workflows onto the generic Temporal platform:

| Check | Result |
|-------|--------|
| `npx prisma validate` | PASS |
| `npm run db:seed` | PASS |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 102 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS: no whitespace errors; existing CRLF warnings only |
| Targeted Phase 6E registry tests | PASS: migrated registry entries, compliance start/action parsing, underwriting start/action parsing |
| Live self-hosted Temporal compliance review smoke on port 3110 | PASS: generic start page, seeded Synthetic Compliance Operations binding available, automated control passed, evidence task submitted from `/workflow-tasks`, receipt `SUCCEEDED`, report generated |
| Live self-hosted Temporal underwriting capstone smoke on port 3110 | PASS: generic start page, seeded Synthetic Underwriting Decisioning binding available, missing-information task submitted, child risk checks reran, analyst approval task submitted, receipts `SUCCEEDED`, final decision approved |

Smoke evidence:
- Compliance execution id: `47835cda-1e01-4888-970f-f0df602286fa`
- Compliance workflow id: `org-seed-org-acme.showcase.compliancereview.phase6e-compliance-8190336f`
- Compliance run id: `83294a4d-9871-4069-9560-8864f4bc03cc`
- Compliance evidence task id: `a18a2b3d-24de-4930-86a1-eaa010b3f94d`
- Compliance final projection: `COMPLETED` with `stateSummary.status=completed`,
  `completionPercentage=100`, one automated control `passed`, one manual
  control `accepted`, no missing evidence, and
  `reportId=report_phase6e-compliance-8190336f`
- Compliance Activity idempotency rows: 4, all `SUCCEEDED`
- Underwriting execution id: `2e249dc4-d7e3-4fa4-974c-e6b386bed5f6`
- Underwriting workflow id: `org-seed-org-acme.showcase.underwritingcapstone.phase6e-underwriting-ae6bebdf`
- Underwriting run id: `60a82aa9-8c23-434a-8c87-b0dee63627b6`
- Underwriting missing-information task id:
  `1c030961-a233-4cab-89f1-2c6c01230d57`
- Underwriting analyst task id: `18acfb61-c9ea-427e-86e2-f9609a26932b`
- Underwriting final projection: `COMPLETED` with `stateSummary.status=approved`,
  `finalDecision=approved`, `riskScore=58`, empty `missingInformation`,
  `analystReviewStatus=approved`, three child workflow ids, and decision
  history for information request, manual review, and analyst approval
- Underwriting Activity idempotency rows: 9, all `SUCCEEDED`, including five
  child risk-check side effects across identity, financial, and fraud checks

## Temporal Phase 7
Date: 2026-08-14

Documentation convergence and implementation handoff validation:

| Check | Result |
|-------|--------|
| Required architecture/conventions/Temporal skill reread | PASS |
| Stale-language scan | PASS: only Phase 7 checklist references remained |
| Runtime docs cross-check | PASS: `.env.example`, `docker-compose.yml`, package scripts, route sync, page sync, README, and runbook agree on Temporal ports/commands/surfaces |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 102 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS: no whitespace errors; existing CRLF warnings only |

Phase 7 updated the implementation handoff language in
`TEMPORAL-INTEGRATION-PLAN.md`, refreshed `skills/SKILL-temporal.md` to describe
the completed Phase 6A-6E migrated workflow set, expanded
`docs/temporal-operations-runbook.md` with final operations/security guidance,
and removed stale wording from the architecture/test records.


## Organizations Route Spelling
The browser acceptance script now checks `/admin/organizations` and asserts the corrected spelling is rendered without the old spelling variant.

## Temporal Production-Hardening Audit
Date: 2026-08-14

Focused audit and validation after Phase 7:

| Check | Result |
|-------|--------|
| Security-sensitive email/auth/integration tests | PASS: 3 files, 12 tests |
| Sensitive logging scan | PASS: raw token/URL/credential log candidates removed; remaining hits are URL construction or redaction/encryption tests |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 103 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS: no whitespace errors; existing CRLF warnings only |

Findings fixed:
- Mock and error email logs now redact sensitive context keys such as auth URLs,
  workflow task URLs, tokens, credentials, passwords, and secrets.
- Auth registration/password-reset flows no longer log raw verification/reset
  tokens, and production responses omit raw dev helper tokens.
- Auth verification/reset email links now use the admin-managed
  `PUBLIC_APP_URL` site setting instead of hardcoded production/development
  origins.
- The synthetic integration adapter no longer returns even a prefix of the
  configured API token.

Known hardening backlog was recorded in
`docs/temporal-operations-runbook.md`: payload codecs, replay fixtures,
credential key-ring rotation, stale activity claim recovery, stronger
human-task acknowledgement semantics via Temporal Updates, and scheduled
execution projection ingestion.

## Temporal Production-Hardening: Credential Key Ring
Date: 2026-08-14

Implemented the first hardening backlog slice: integration credential encryption
now supports a versioned key ring.

| Check | Result |
|-------|--------|
| Focused credential/integration tests | PASS: 3 files, 8 tests |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 104 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS: no whitespace errors; existing CRLF warnings only |
| Config-boundary/key-ring scan | PASS: app reads the new key-ring config only through `src/config/index.ts`; test setup remains the only test env mutation |

Implementation notes:
- Added optional `INTEGRATION_CREDENTIAL_KEY_RING` JSON config for previous
  version-to-secret entries.
- `CredentialEncryptionService` encrypts new/rotated credentials with the active
  key version and decrypts stored credentials by their persisted
  `credentialKeyVersion`.
- Existing `IntegrationConnection.credentialKeyVersion` storage was sufficient;
  no Prisma schema or migration changes were required.
- Updated `.env.example`, README, architecture, Temporal skill, and operations
  runbook to describe the real rotation flow.

## Temporal Production-Hardening: Activity Idempotency Stale Claims
Date: 2026-08-14

Implemented the second hardening backlog slice: stale `RUNNING`
`ActivityIdempotency` claims can now be recovered safely after a configurable
timeout.

| Check | Result |
|-------|--------|
| Focused ActivityIdempotency tests | PASS: 1 file, 5 tests |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 21 files, 106 tests |
| `npm run build` | PASS |

Implementation notes:
- Added the admin-managed
  `ACTIVITY_IDEMPOTENCY_STALE_CLAIM_MINUTES` site setting under Workflow
  Operations.
- Added an atomic model-layer takeover that updates only matching `RUNNING`
  rows with the same request hash and `lockedAt` older than the cutoff.
- Fresh `RUNNING` claims still return conflict, successful claims still replay
  cached responses, and failed claims still require a new idempotency key.
- Updated README, architecture, Temporal skill, and operations runbook to
  reflect the implemented recovery behavior.
## Temporal Production-Hardening: Scheduled Execution Projection Ingestion
Date: 2026-08-14

Implemented the third hardening backlog slice: real Temporal scheduled Workflow
runs now call a projection-ingestion Activity near startup so they can create
their app `WorkflowExecution` row.

| Check | Result |
|-------|--------|
| Focused workflow execution/schedule tests | PASS: 2 files, 10 tests |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS: 21 files, 108 tests |
| `npm run build` | PASS |
| `git diff --check` | PASS: no whitespace errors; existing CRLF warnings only |

Implementation notes:
- Added projection Activity contracts and Activity export.
- Added `WorkflowExecutionService.ensureStartedProjection()` for idempotent
  workflow-start ingestion by `(orgId, workflowId)`.
- Scheduled Workflow context already carries `scheduleId`; tests now assert it.
- Registered top-level Workflow functions call the ingestion Activity near
  startup behind Temporal patch id
  `workflow-execution-projection-ingestion-v1`; child workflows remain
  Temporal-only visibility.


## October 20, 2026 — current blueprint verification

The earlier August narrative remains historical. Current verification covers 144 unit tests in 39 files, 8 real PostgreSQL tests in 3 files, typecheck/lint/architecture/build, owned Chromium/Redis acceptance, actual Temporal lifecycle/reliability/replay/transport and restore/failure drills. Exact observed runs and limits are recorded in `docs/blueprint/EXECUTION-REPORT-2026-10-20.md`. Production compatibility remains blocked on the actual deployed release/history inventory; Solution Intent consumer adoption was not performed.
