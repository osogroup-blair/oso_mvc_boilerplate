# Temporal Operations Runbook

This runbook covers the boilerplate's generic Temporal operations layer after
Phase 7. It applies to the generic workflow platform, the migrated
`showcase.*` workflows, admin-managed integrations, human tasks, schedules, and
execution projections.

## Local startup

1. Start Temporal services:
   ```bash
   npm run temporal:up
   ```
2. Start the web app:
   ```bash
   npm run dev
   ```
3. Start the Worker in a second terminal:
   ```bash
   npm run dev:temporal-worker
   ```
4. Open `/admin/workflow-operations`.

The dashboard reports Temporal connectivity and task-queue pollers. If Temporal
is reachable but no Worker is running, cluster status may be OK while worker
reachability remains unknown.

## Schedule lifecycle

- Create schedules at `/admin/workflow-operations/schedules/new`.
- Prefer creating new schedules paused until the input, cron, integrations, and
  overlap policy have been reviewed.
- Required workflow integrations must be configured under `/admin/integrations`
  before schedule creation.
- Pause, unpause, trigger, and delete schedules only from the schedule detail
  page so the app projection and audit log stay synchronized.
- Delete removes the Temporal schedule and soft-deletes the local
  `WorkflowSchedule` projection. Historical workflow executions are not deleted.

Temporal is authoritative for timers and schedule action history. The app DB is
authoritative for admin configuration, local schedule metadata, and queryable
projections.

## Migrated workflow operations

- Start migrated workflows from `/workflows`; do not use workflow-specific
  routes or direct Temporal UI starts for application flows.
- Required integration bindings are configured under `/admin/integrations` and
  are checked before workflow start or schedule creation.
- Human input appears as `/workflow-tasks` rows or public
  `/workflow-task-tokens/:token` links. Browser submissions must go through the
  app so CSRF, idempotency, permissions, receipts, audit, token consumption,
  and Temporal signaling remain synchronized.
- Schedule-compatible workflows such as `showcase.complianceReview` can be
  scheduled through `/admin/workflow-operations/schedules`; the schedule stores
  validated start input and still relies on the same integration gating.
- Parent/child workflow visibility lives in Temporal. The app projection stores
  compact child workflow ids and state summaries, not complete event history.
- Scheduled workflow runs create their `WorkflowExecution` projection from an
  Activity near the start of the real Temporal Workflow. Do not fabricate
  execution rows from schedule admin actions. The workflow-side hook is guarded
  by Temporal patch id `workflow-execution-projection-ingestion-v1` for replay
  compatibility.

## Projection reconciliation

Use `/admin/workflow-operations` → `Reconcile stale` when local
`WorkflowExecution` rows are still `PENDING`, `RUNNING`, or `UNKNOWN` after the
configured stale window. Reconciliation describes each execution in Temporal and
updates the app projection through `workflow-execution.service.ts`.

Reconciliation is safe to re-run. It audits attempted, succeeded, and failed
counts.

## Production notes

- Run at least one web process and one independent Temporal Worker process.
- Keep `TEMPORAL_TASK_QUEUE` consistent between web and Worker configuration.
- Use `TEMPORAL_WORKER_IDENTITY` values that identify deployment/host clearly.
- Use a dedicated Temporal persistence database/volume and backup policy.
  Application Postgres, Temporal Postgres, and Redis/BullMQ have different
  recovery objectives and should not be treated as one disposable store.
- Do not use Temporal UI as an authorization boundary. Application actions
  should continue to go through app controllers/services.
- Keep Workflow code deterministic: no Prisma, services, config, logger, Node
  I/O, dates, random values, or network calls from Workflow modules.
- Use Activities for side effects and `activity-idempotency.service.ts` for
  retry-safe external operations. `RUNNING` idempotency claims can be recovered
  after the admin-managed stale-claim timeout when a Worker crashes mid-activity.
- Temporal Cloud can replace the local self-hosted endpoint by changing typed
  Temporal config in `.env`; workflow behavior, role policy, and integration
  bindings remain app/admin data.

## Security and secrets

- Workflow input, signal payloads, query state, execution summaries, audit
  payloads, and logs must not contain integration credentials, raw task tokens,
  raw documents, prompts, full transcripts, or unredacted provider payloads.
- Integration credentials are encrypted in `IntegrationConnection` and
  decrypted only inside Activity-side resolver paths.
- Integration credential encryption uses a versioned key ring. New/rotated
  credentials are encrypted with `INTEGRATION_CREDENTIAL_KEY_VERSION` and
  `INTEGRATION_CREDENTIAL_KEY`; previous versions can decrypt by listing them in
  `INTEGRATION_CREDENTIAL_KEY_RING`.
- Email task tokens are stored by hash only. Treat raw token URLs as secrets and
  never paste them into docs or logs.
- Redis/BullMQ email jobs can contain auth and workflow task URLs until delivery.
  Secure Redis as secret-bearing infrastructure, restrict queue dashboard access,
  and keep queue/log retention low enough for your operating model.
- Temporal UI is for operators. It does not inherit app authorization and must
  not be exposed as the user workflow UI.
- If a future payload codec is added, document codec key rotation and make sure
  both web Temporal Client and Worker can decode active histories before
  deployment.

## Known hardening backlog

- Payload encryption/codecs are not implemented yet. Keep sensitive values out
  of Workflow histories and plan a coordinated web/Worker codec rollout before
  putting confidential payloads in Temporal.
- Replay fixtures are not implemented yet. Workflow changes that affect replay
  should be treated as high-risk until representative history replay tests
  exist in CI.
- Human task browser submissions currently signal Temporal and then finalize the
  local task/receipt. If the local write fails after a successful signal, manual
  reconciliation may be needed. Temporal Updates are the recommended future path
  for synchronous workflow-side validation plus stronger app/Temporal
  acknowledgement semantics.
- Temporal schedules start workflows directly from Temporal. The app stores the
  schedule projection, and each real scheduled Workflow run records its own
  `WorkflowExecution` projection through the Workflow's projection-ingestion
  Activity.

## Versioning and replay baseline

Before changing a Workflow that already has live histories:

1. Prefer additive payload changes and keep old fields optional.
2. Use Temporal patching/versioning APIs for behavioral changes that affect
   replay.
3. Keep old Activity names available until old histories have completed or been
   migrated.
4. Run a replay test fixture for representative histories before deploy.

Replay fixtures are intentionally still a later phase. Until they exist, treat
Workflow logic changes as high-risk and validate with disposable local histories
plus careful code review.

## Integration credential key rotation

Use your secret manager as the source of truth for key material.

1. Before deploying a new active key, add the previous active version and secret
   to `INTEGRATION_CREDENTIAL_KEY_RING`.
2. Set `INTEGRATION_CREDENTIAL_KEY_VERSION` and `INTEGRATION_CREDENTIAL_KEY` to
   the new active version/material and deploy web plus Worker processes
   together.
3. Rotate each organization connection from `/admin/integrations`; rotated
   credentials are re-encrypted with the active version.
4. After no `IntegrationConnection.credentialKeyVersion` rows reference an old
   version, remove that version from `INTEGRATION_CREDENTIAL_KEY_RING`.

If an old version is removed too early, connection tests and Activity-side
integration resolution fail with a configured-key-version error instead of
guessing or falling back to another key.

## Activity idempotency stale-claim recovery

`ActivityIdempotencyService` protects Activity-side external operations from
duplicate side effects. A first attempt creates a `RUNNING` reservation for the
stable `(orgId, scope, idempotencyKey)` tuple. Retries with the same request
replay `SUCCEEDED` results, reject mismatched request hashes, and reject fresh
`RUNNING` claims.

If a Worker crashes while a claim is `RUNNING`, a retry can recover it only
after `ACTIVITY_IDEMPOTENCY_STALE_CLAIM_MINUTES` has elapsed. The takeover is a
conditional database update against the existing row's id, request hash, status,
and `lockedAt` cutoff; if the update loses the race, the retry still receives an
already-running conflict.

Tune the stale-claim setting from `/admin/settings` -> Workflow Operations. Use
a value longer than the normal maximum duration of the protected external
operation so a slow-but-live Activity is not taken over prematurely.
