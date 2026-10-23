# Self-hosted Temporal operations and local verification

This is a development acceptance runbook. The Docker fixture is disposable and is not a production topology. Production remains gated on the actual deployed release/history inventory and deployment owner's operating objectives.

## Reproduce local verification

Use Node 24 and the committed dependency lockfile with native binaries for the host OS. Run `npm ci`, `npx prisma generate`, and provision `postgres:16-alpine`, `redis:7-alpine`, `temporalio/auto-setup:1.25.2` explicitly. Provide Playwright 1.62.1 and its Chromium binary (CI installs these without changing the lockfile). Run `npm run test:local:all`. On the transferred workstation, existing matching Linux Prisma, esbuild and browser artifacts are supplied through the environment; see the execution evidence for those paths. Never transplant these workstation paths into deployment configuration.

The runner does not source `.env`. It allocates loopback ports, unique database/container/network/namespace/queue identities and a database ownership sentinel. Cleanup verifies labels and process/profile identity. No command targets the application's database. Logs and result summaries live in `artifacts/platform-<run-id>`. TLS keys, database dumps, browser profiles and private-file backups are ignored local scratch data; do not publish that whole directory.

The test sequence covers migrations; SQL rollback/races and fenced effects; two admin resources in Chromium; real Redis queue actions; actual Worker drain/restart; lost accepted start and human Update response recovery; Schedule ingestion; baseline-source history replay; incompatible replay control; actual Client/NativeConnection mTLS/API-key RPCs; local load/outage; application database plus private volume restore; forced Activity termination/retry. Unit tests cannot reach Prisma.

## Interpret readiness

Cluster RPC success, task-queue poller observations, application Workflow→Activity→database canary and business-provider readiness are different signals. The admin operations page reports the first two; its explicit canary POST and `npm run temporal:canary` test the application path. Neither establishes provider readiness. Queries may fail while engine execution remains live: the projection exposes its sync warning and last successful sync time. Cancellation request is not terminal cancellation; queued human delivery is not a completed business decision. Unknown outcomes stay UNKNOWN.

Recover interrupted starts with the operations page's **Recover my pending starts** action. It rechecks current organization membership, workflow enablement and START capability, and only recovers intents owned by the current actor. Retry browser commands with the original operation UUID and identical payload. Never create a new UUID to resolve an uncertain side effect. Do not manually mark RECEIVED, RUNNING or UNCERTAIN records successful.

## Production release gate for existing executions

1. Inventory running server/SDK versions, namespaces/queues, active workflow types/branches, release/bundle digests, patch markers and retained histories. Compare deployed migration checksums with the preserved historical migrations before applying either additive migration.
2. Capture reviewed synthetic histories using each supported deployed artifact and representative success/rejection/resubmission/retry/cancellation/timer/child/fanout/schedule branches. Include original workflow IDs, source releases and SHA-256 in the replay manifest. Do not edit real history JSON to redact it: that can invalidate replay.
3. `npm run temporal:bundle -- /absolute/release/workflows.js` builds one artifact. Replay that artifact with `npm run temporal:replay -- --bundle=... --bundle-sha256=... --manifest=...`. The checked-in production corpus deliberately remains empty and blocks release. Local baseline histories do not replace deployed inventory.
4. Deploy the same verified bundle using both bundle path and digest settings. Retain `platform-runtime-v2` patch handling and old Signal names until all supported histories age out. Do not route an old Worker that cannot read new enum values or encrypted payloads onto new executions. Prefer an isolated candidate queue and controlled canary until the actual version-routing strategy is reviewed.
5. Keep prior compatible Worker artifacts available. A code rollback may require forward repair: old binaries cannot necessarily read new ledger enum states, encrypted payloads or Update semantics. Never roll schema back by dropping receipts/private bytes or removing keys.

CI includes ordinary verification and a release compatibility job. Required branch/tag protection is an external repository setting and was not changed locally.

## Payloads and keys

Production requires TLS and payload encryption with a non-development master key. The codec derives a distinct AES-256-GCM key using HKDF purpose/version separation; metadata is authenticated. Start-intent envelopes are encrypted even in local development. No decode fallback occurs for an unknown encrypted format, missing retained key or authentication failure.

To rotate, distribute the old and new master versions to every client/Worker, preserve the old version in the key ring, then switch the active version. Test old decode/new encode before promotion. Retain old keys for the maximum history/archive/replay/database-backup lifetime, not just connection-secret rotation. Keep explicit legacy plaintext decode enabled while supported old histories require it; disabling it is a compatibility decision. Encrypting future payloads does not rewrite existing plaintext histories. Workflow IDs, type names, headers, failure metadata and search attributes are not hidden by this codec: keep these content-free. No public codec endpoint or browser key delivery is provided.

## Persistence, restore and incidents

Back up application PostgreSQL, private volume/store identity, Temporal persistence/visibility, retained key versions and exact Worker bundles separately. Redis mail queues need a documented replay/retention policy; they are not the workflow authority. A production restore must preserve a consistent recovery point or reconcile against Temporal/provider receipts before allowing effects. Restore isolation and disable external providers first. An application database rolled back behind an external provider must not cause that provider effect to run again: use the provider's operation identity/receipt reconciliation policy. Local tests preserve independent Temporal history while restoring application DB and private files; they do not certify Temporal persistence failover or coordinated point-in-time recovery.

For pending starts, use authorized recovery. For pending action receipts, retry the same operation and payload to retrieve its Update result and finish the receipt transaction. For uncertain Activity effects, use the registered provider reconciliation callback; otherwise leave the operation blocked for investigation. For stale projections, reconcile against the exact Workflow/run. For task cancellation, let non-cancellable bounded cleanup close open tasks.

Worker termination allowance must exceed force timeout plus resource-close allowances and process-manager margin. Default graceful/force/resource-close values are 10s/30s/5s; multiple resources may consume separate close allowances. SIGTERM triggers drain; exceeding the bound returns a nonzero exit. Alert on repeated forced exits, failed canaries, growing pending/uncertain receipts, projection lag and delivery age. Route logs by bounded component/code/queue fields; keep workflow/run IDs in logs rather than metric labels. Choose retention, collectors, thresholds and owners against the actual deployment.

Before production acceptance, the owner must set and measure availability/latency targets, restore point/time targets, capacity/backpressure, persistence HA/failover and supported upgrade order. The local 25-concurrent-canary / 10-second envelope is a regression limit, not a production SLO. No production monitoring service, backup schedule, infrastructure deployment or provider certification was created by this work.


## Full local Docker startup

`docker compose up --build -d --wait` now starts both application processes and all local infrastructure. It requires Docker/Compose only; the image installs locked Linux dependencies, generates Prisma, compiles TypeScript and builds CSS. The one-shot initializer deploys migrations and seeds an empty development database once, retaining a bootstrap marker and skipping demo reapplication on later starts. It never resets an existing database. App/Worker run as the node user; only the local app (3000) and Temporal UI (8244) publish loopback ports. Named volumes preserve both databases, Redis, public/private uploads and bootstrap state. `docker compose down` keeps them. `compose.host.yml` is an optional explicit override for host Node development ports. No production settings or external deployed Temporal namespace are used by the default stack.

The Docker smoke test (`npm run test:docker`, after image build) uses an independently named Compose project and free ports. It verifies initial health, real login/CSRF, CSS, Redis board, actual Worker canary, non-root runtime, no baked host `.env`, and data/private/public file persistence across down/up. Cleanup checks project labels before removing test containers and volumes. For a deliberately fresh local reset, `docker compose down --volumes` destroys this project's stored data; ordinary shutdown must omit `--volumes`.
