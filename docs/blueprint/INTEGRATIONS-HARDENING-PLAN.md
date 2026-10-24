# Workflow Integrations Hardening Plan

**Status:** Phase 1 complete and owned-stack accepted (2026-10-24; see §4 Phase 1 implementation notes). Phases 2–7 not started.
**Baseline:** `0dc7d01` (`Integrate platform reliability improvements and clean up documentation`)
**Scope:** fix correctness and security gaps in the integration platform
(providers, connections, bindings, resolvers, Activity idempotency). Make the
feature type-safe and give it a realistic reference provider. Then give coding
agents precise, machine-checkable context, delivered as a skill, a generated
manifest, an intake template, architecture guardrails and a repo-local MCP
server, so they can implement integrations from a requirements document without
guessing.

Work item IDs (`INT-xx`) are stable. Reference them in commits, PRs and
checklist updates.

---

## 1. Current state (as of baseline)

| Concern | Where | Shape today |
|---|---|---|
| Provider catalog | `src/integrations/provider-registry.ts` | One static array; only `synthetic.echo` (no network). Adapter type erased to `unknown`. |
| Requirement declaration | `integrationRequirements` in `src/temporal/workflow-registry.ts` | Synced to `WorkflowIntegrationRequirement` at boot; removed keys are soft-deleted. |
| Connections + credentials | `integration.service.ts`, `integrationConnection.model.ts`, `credential-encryption.service.ts` | AES-256-GCM; AAD = key version only; fingerprint = HMAC of `JSON.stringify`. |
| Bindings | `workflowIntegrationBinding.model.ts` | One connection per org × workflow × requirement. `lastValidated*` columns never written. |
| Start gating | `IntegrationService.getRequirementStatuses` / `assertRequiredBindingsAvailable` | Used by `workflow-execution.service.ts` and `workflow-schedule.service.ts` at create time only. |
| Activity resolution | `integration-resolver.service.ts` → `integration-connection-resolver.service.ts` | Checks org, deleted, `status`, `disabledAt`, provider, capability, *then* decrypts. |
| Retry safety | `activity-idempotency.service.ts` | Reservation/claim/fence model; `response` stored indefinitely (`expiresAt` never set). |
| Admin surface | `/admin/integrations` | Create, view, test, rotate, disable, bind. **No** edit config, re-enable, delete connection, or unbind. |
| Agent guidance | `SKILL-temporal.md` §Phase 4, `SKILL-cross-cutting.md` §Provider resolution, `ARCHITECTURE.md`, `EXTENSION-CONTRACTS.md` | Spread across four files; no "add a provider" recipe; no machine-readable catalog. |
| Tests | `tests/services/integration*.test.ts`, `credential-encryption`, `activity-idempotency` | `integration.service.test.ts` has 4 cases; no provider contract suite. |

---

## 2. Findings driving this plan

Severity: **P0** = wrong behaviour or security gap today; **P1** = latent risk
or blocks realistic providers; **P2** = ergonomics and drift.

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| F1 | P0 | **Disabled connections come back to life.** `rotateCredentials` and `testConnection` write `status: ACTIVE` without clearing or checking `disabledAt`. Start gating checks only `status`, so it reports `AVAILABLE`. The resolver also checks `disabledAt` and rejects the connection, so the workflow fails *after* it starts. | `integration.service.ts:165`, `:216`; `requirementStatus` `:336`; resolver `integration-connection-resolver.service.ts` |
| F2 | P0 | **Start gating and the Activity resolver use different rules.** The gate ignores `disabledAt`, capability, provider-still-registered and connection `deletedAt` (the safe binding include doesn't select `deletedAt`). | `integration.service.ts:336–347`, `workflowIntegrationBinding.model.ts` `safeBindingInclude` |
| F3 | P0 | **Configuration errors are retried, and recorded as operation outcomes.** Resolution runs *inside* the `activityIdempotencyService.run` callback, and a missing or disabled binding throws a plain `AppError`. Temporal retries it up to 5 times. Under a non-`retrySafe` policy the reservation is marked `UNCERTAIN`, so operator review is needed for a pure config error. | `src/temporal/activities/index.ts:39–60`, `shared.ts` `integrations` retry policy |
| F4 | P0 | **`testConnection` is unguarded.** It passes unvalidated `connection.config` to the provider. Provider throws or timeouts become 500s with no recorded result. The provider-controlled `message` is stored and audited verbatim, so a secret could be echoed back. | `integration.service.ts:204–235` |
| F5 | P1 | **Ciphertext isn't bound to its row.** AAD covers the key version only. Someone with DB write access, or a buggy migration, could move one tenant's envelope onto another tenant's row and it would still decrypt. | `credential-encryption.service.ts:35`, `:63` |
| F6 | P1 | **The fingerprint is unstable.** `JSON.stringify` depends on key order, and the fingerprint is keyed by the *active* encryption key, so it changes on key rotation even when credentials don't. Encryption and fingerprint share one SHA-256-derived key with no KDF separation. | `credential-encryption.service.ts:85–91` |
| F7 | P1 | **Rotated-out keys are never retired.** There's no re-wrap job, so old key versions have to stay in the ring forever. | — |
| F8 | P1 | **Activity responses are stored forever.** `ActivityIdempotency.response` keeps the full adapter output and nothing sets `expiresAt` or purges it. Real providers will return PII. | `activity-idempotency.service.ts`, schema `ActivityIdempotency` |
| F9 | P1 | **Lifecycle gaps.** There's no edit-config, re-enable, soft-delete connection or unbind, although the model already has `softDelete` for both. `@@unique([orgId, name])` blocks reusing a soft-deleted name. | routes file, schema |
| F10 | P1 | **Test and rotate can race.** `updateTestResult` is unconditional, so a test that read the old credentials can overwrite the status after a rotation. | `integrationConnection.model.ts` `updateTestResult` |
| F11 | P1 | **No egress hygiene for real providers.** There's no shared HTTP client with timeouts, a host allowlist, redacted logging or error classification. An admin-supplied `baseUrl` would become an SSRF vector. | — |
| F12 | P1 | **Schedules gate only at creation.** A scheduled run fires even after its binding was disabled, and fails inside the Activity with no admin-visible signal. | `workflow-schedule.service.ts:129` |
| F13 | P2 | **Adapters are untyped.** `resolve()` returns `adapter: unknown` and every Activity casts it (`as SyntheticEchoAdapter`). | `activities/index.ts:49`, `:79` |
| F14 | P2 | **Requirement keys are bare strings.** Workflows hard-code `requirementKey: "syntheticEcho"` with no compile-time check against the registry. | 5 workflow files |
| F15 | P2 | **Only a stub reference provider.** The sole provider is a no-network stub, so agents have nothing realistic to copy (HTTP, auth headers, idempotency headers, error mapping, rate limits). | `provider-registry.ts` |
| F16 | P2 | **Every provider lives in one file.** `FormDefinition` is (type-only) imported from `src/temporal/forms.ts`. | `provider-registry.ts:2` |
| F17 | P2 | **`lastValidated*` columns are dead.** They exist on `WorkflowIntegrationBinding` but nothing writes them. | schema |
| F18 | P2 | **Agent guidance is fragmented and only in prose.** No checklist, intake template, generated catalog or executable contract. | §1 |
| F19 | P2 | **`integration:admin` is a global role permission**, applied to whichever org the actor is a member of. This needs confirming against the tenant-admin contract in `EXTENSION-CONTRACTS.md`. | `integration.service.ts` `assertCanAdmin` |

---

## 3. Decisions to lock before implementation

Record each one in `docs/blueprint/DECISIONS.md` as it's agreed. Items that
depend on a decision are marked ⟂.

| ID | Question | Recommendation |
|---|---|---|
| D1 | Are OAuth / refreshable credentials in scope? | **Defer to Phase 7.** Design the credential write-back seam now (INT-21), but implement it only for a concrete provider. |
| D2 | Can non-workflow code (plain services, controllers) use integrations? | **Yes, through an explicit app-feature requirement.** Generalise "requirement owner" from workflow-only to `WORKFLOW` or `APP_FEATURE` (INT-22). Until then, document that direct `IntegrationConnectionResolverService` use needs an admin-chosen `connectionId` stored by the owning feature. |
| D3 | AAD migration strategy for existing ciphertext (F5) | **Envelope version column.** `v1` = legacy AAD, `v2` = `v2|orgId|connectionId|providerKey`. Read both, write `v2`. The re-wrap job (INT-12) upgrades rows. |
| D4 | Should `integration:admin` be per-org (F19)? | Align with the tenant-admin contract. If org-scoped roles exist, check the actor's role *in the active org*. Otherwise record the global-role semantics as intended. |
| D5 | What can the MCP server do? | **Read and validate only, plus a dry-run scaffolder** that returns file contents and never writes. No DB, no env, no network, no secrets. |
| D6 | Retention for `ActivityIdempotency.response` | Per-scope TTL declared on the provider operation (default 30 days). Use the admin setting `ACTIVITY_IDEMPOTENCY_RETENTION_DAYS` as the ceiling. |

---

## 4. Phased plan

Each phase can ship on its own and is broken down by layer, following
`AGENTS.md`. Every phase ends with `npm run typecheck`, `npm run lint`,
`npm run check:architecture` and `npm test`. Phases that touch Workflow code
also run `npm run temporal:replay`.

### Phase 1: Correctness and safety fixes (P0)

Goal: start gating, Activity resolution and admin actions agree on exactly when
a connection is usable, and configuration errors fail fast.

**INT-01: One availability evaluator (F1, F2)**
- *Integrations:* new `src/integrations/availability.ts` (pure, no I/O)
  exporting
  `evaluateConnectionAvailability(connection, requirement, provider | null): { status, reason }`.
  Statuses: `AVAILABLE | MISSING | DISABLED | PROVIDER_MISMATCH | CAPABILITY_MISSING | PROVIDER_UNREGISTERED | CONNECTION_UNAVAILABLE`.
  `IntegrationService.requirementStatus` and
  `IntegrationConnectionResolverService.fromConnection` must both call it. The
  resolver maps any non-`AVAILABLE` result to its `AppError`.
- *Model:* add `deletedAt` and `disabledAt` to `safeBindingInclude.connection`,
  and filter out bindings whose connection is soft-deleted.
- *Views:* `workflow-bindings.hbs` and `/workflows/:slug` render the new statuses
  and their reason text.
- *Tests:* a table-driven parity test runs every (status, disabledAt, deletedAt,
  provider, capability) combination through the gate and the resolver and
  asserts they agree.

**INT-02: Disabled stays disabled (F1, F10)**
- *Service:* `rotateCredentials` and `testConnection` must not change
  `status`/`disabledAt` on a `DISABLED` connection. Test may still run, but only
  records `lastTest*`. Rotation keeps it `DISABLED`.
- *Model:* `updateTestResult(id, expectedFingerprint, data)` becomes a
  conditional `updateMany` on `credentialFingerprint` (compare-and-swap). If the
  count is 0, the result is discarded as stale and the service returns
  `{ ok, message, stale: true }`.
- *Tests:* disable → test → still `DISABLED` and gate shows `DISABLED`;
  rotate-during-test → stale result not persisted.

**INT-03: Guarded connection tests (F4)**
- *Service:* in `testConnection`, validate config with `provider.validateConfig`
  and wrap the provider call in a timeout (default 10 s, from the new site
  setting `INTEGRATION_TEST_TIMEOUT_SECONDS` in `SETTING_KEYS`). Catch throws and
  map them to `{ ok: false, message: safeCode }`. Run every message through a new
  `provider.redactMessage?(msg)` and a generic secret scrubber that removes any
  substring equal to a credential value, capped at 300 characters, before
  storing or auditing it.
- *Tests:* a provider that echoes its token in the message → stored and audited
  message contains no token; a provider that hangs → `FAILED` with a timeout
  code.

**INT-04: Resolve before reserving; fail config errors fast (F3)**
- *Temporal/Activities:* new helper `src/temporal/activities/integration-activity.ts`:
  ```ts
  runIntegrationOperation({ orgId, workflowDefinitionKey, requirementKey, scope,
    idempotencyKey, request, providerKey }, (adapter, operationKey) => ..., policy)
  ```
  1. It resolves the binding **outside** `activityIdempotencyService.run`.
  2. It maps resolver `AppError`s (`notFound` / `forbidden` / `conflict` /
     `badRequest`) to
     `ApplicationFailure.nonRetryable(message, "INTEGRATION_<STATUS>")`.
  3. It then runs the idempotent operation.

  Migrate `runSyntheticIntegration` and `runShowcaseSyntheticStep` to it.
- *Contracts:* export the failure-type constants from `src/temporal/contracts.ts`
  so Workflows can match them deterministically (string compare only).
- *Tests:* missing binding → non-retryable failure, no `ActivityIdempotency` row
  created; provider error → existing retry/classify behaviour unchanged.

**INT-05: Schedule runtime guard (F12)**
- *Service:* the projection-ingestion path that already runs for scheduled
  executions records a `WorkflowExecution` failure reason when the first
  integration Activity fails with `INTEGRATION_*`.
  `workflow-operations.service.ts` reports schedules whose required bindings are
  no longer `AVAILABLE`.
- *Views:* `/admin/workflow-operations` shows a "binding unavailable" badge per
  schedule.
- *Tests:* disable a bound connection → operations report flags the schedule.

**Phase 1 implementation notes (2026-10-24):**
- INT-01 lives in `src/integrations/availability.ts`, not `src/services/`: it is
  pure provider-domain logic with no I/O. It also adds `REQUIREMENT_MISSING` and
  `CONNECTION_NOT_FOUND`, and throws `IntegrationUnavailableError` (an
  `AppError` that keeps the old HTTP codes and messages). Bindings to
  soft-deleted connections are reported as `CONNECTION_NOT_FOUND` rather than
  filtered out, so admins can see what to rebind.
- INT-03 test messages carry a code prefix (`INTEGRATION_TEST_TIMEOUT`,
  `INTEGRATION_CONFIG_INVALID`, `INTEGRATION_TEST_ERROR`, `INTEGRATION_<AppError code>`).
  Providers receive an `AbortSignal` and may implement `redactMessage`.
- INT-04 adds `ActivityIdempotencyService.findSucceeded`. When resolution fails
  after a side effect already succeeded, the stored result is replayed instead
  of failing. Failure types live in `INTEGRATION_FAILURE_TYPES`
  (`src/temporal/contracts.ts`).
- INT-05 delivered the operations-dashboard check only. Recording an
  `INTEGRATION_*` failure reason on the `WorkflowExecution` projection is
  **deferred**: nothing writes `WorkflowExecution.error` today, so that needs
  failure-detail ingestion from Temporal history, which is out of Phase 1 scope.
  The non-retryable failure type and message are visible in Temporal UI.
- **Owned-stack acceptance (2026-10-24, run `0fe8fe59-2cc5-45dc-86b7-ec5a63ee64fd`):**
  `npm run test:platform:owned -- --browser --temporal` PASS on every stage
  (migrate, integration, browser, worker-process, integration-failures,
  reliability, transport, restore-failure). Phase 1 coverage added for it:
  - `tests/integration/workflow-integrations.test.ts` (owned SQL): gate and
    resolver agree on real rows (healthy, `disabledAt` with stale `ACTIVE`,
    binding disabled, connection soft-deleted); test and rotate keep `DISABLED`;
    the `updateTestResult` CAS discards a result when credentials rotate
    mid-test; scrubbed test message and audit, with the secret still
    decryptable;
  - `tests/acceptance/integration-failures.mjs` (new runner stage, real built
    Worker): a disabled binding and a `disabledAt` connection each fail the
    workflow with non-retryable `INTEGRATION_DISABLED` /
    `INTEGRATION_CONNECTION_UNAVAILABLE` on attempt 1, with zero
    `ActivityIdempotency` rows; a healthy binding completes with one `SUCCEEDED`
    row; the secret appears in neither history nor stored response;
  - `tests/acceptance/full-browser.mjs`: Disable then Test Connection through
    real CSRF forms keeps `DISABLED`; the start and bindings pages show
    `CONNECTION_UNAVAILABLE` with its reason and block launch; the operations
    dashboard flags an active schedule (`integration-health.png`).

  Playwright 1.63.0 (global, via `NODE_PATH`) was used rather than the
  documented 1.62.1. `temporal:replay` remains BLOCKED on the empty
  reviewed-history corpus (pre-existing).

**Phase 1 acceptance:** the parity test passes; no disabled connection reports
`AVAILABLE`; config errors produce zero idempotency rows and zero retries;
`EXECUTION-CHECKLIST` has a row for each of INT-01 to INT-05.

### Phase 2: Typed contracts and provider modules (F13, F14, F16)

Goal: an agent can't call the wrong adapter or misspell a requirement key
without `tsc` failing.

**INT-06: One module per provider**
- Move to:
  ```
  src/integrations/
    index.ts                    registry: integrationProviders, getIntegrationProvider, ProviderAdapterMap
    types.ts                    IntegrationProviderRegistration, ProviderOperation, IntegrationTestResult
    forms.ts                    FormDefinition (moved from src/temporal/forms.ts; temporal re-exports it)
    http.ts                     shared egress client (INT-09)
    providers/
      synthetic-echo/
        index.ts                registration
        adapter.ts              adapter interface + factory
        schemas.ts              Zod credential/config schemas
        README.md               what it does, operations, retry-safety, data classes
  ```
- Keep `provider-registry.ts` as a one-line re-export for one release, then
  delete it (note in `DECISIONS.md`).

**INT-07: Typed provider → adapter map**
- `types.ts`:
  ```ts
  export interface IntegrationProviderRegistration<K extends string, TAdapter> { key: K; ...; operations: Record<string, ProviderOperation>; }
  ```
  `index.ts` builds the registry with `as const satisfies`, so that
  `type ProviderKey = (typeof integrationProviders)[number]["key"]` and
  `type AdapterFor<K extends ProviderKey>` are derived from it.
- `IntegrationResolverService.resolve<K>()` takes `providerKey: K` and returns
  `{ adapter: AdapterFor<K>, ... }`. It throws if the bound connection's
  provider ≠ `K`. This removes every `as ...Adapter` cast.
- `ProviderOperation` declares
  `{ retrySafe: boolean; supportsProviderIdempotencyKey: boolean; responseRetentionDays?: number; dataClasses: ("pii"|"financial"|"none")[] }`.
  `runIntegrationOperation` reads `retrySafe` and `responseRetentionDays` from
  here, not from per-call literals.

**INT-08: Typed requirement keys**
- `workflow-registry.ts`: declare `integrationRequirements` with `as const` and
  export
  `type RequirementKeyFor<W extends WorkflowKey> = ...`.
  `RunSyntheticIntegrationInput` and friends become generic, so
  `requirementKey: "syntheticEcho"` is checked against the workflow's declaration.
  These are type-only exports, so Workflow determinism is unaffected.
- `scripts/check-architecture.mjs`: Workflows may import `src/integrations/**`
  **type-only**. Any runtime import is an error.
- `eslint.config.js`: `no-restricted-syntax` rule banning `TSAsExpression` whose
  type name ends in `Adapter` under `src/temporal/activities/**`.

**Phase 2 acceptance:** no `as *Adapter` casts remain; a deliberately misspelled
requirement key in a fixture fails `tsc`; architecture check covers the new
rules with cases added to `tests/security/architecture.test.ts`.

### Phase 3: Realistic reference provider and contract test kit (F11, F15)

Goal: give agents a production-shaped provider to copy, plus one test suite that
every provider must pass.

**INT-09: Shared egress client**
- `src/integrations/http.ts` exports `createProviderHttpClient({ baseUrl, allowedHosts, timeoutMs, defaultHeaders, redact })`, built on `fetch`. It provides:
  - an `allowedHosts` check, with private, link-local and loopback ranges denied
    unless the provider registration sets `allowPrivateNetwork: true` (dev only);
  - per-request timeout via `AbortSignal.timeout`;
  - redacted pino logging (no headers or bodies);
  - typed errors `ProviderHttpError { status, retryable, code }` and
    `classifyProviderError(err)`, which returns exactly what
    `ActivityOperationPolicy.classifyError` expects (429/5xx/network →
    `retryable`, 4xx → `terminal`, timeout after send → `uncertain`).
- The provider registration declares `egress: { hosts: string[] | "config.baseUrl" }`.
  Admin config validation rejects a `baseUrl` outside the declared policy.

**INT-10: `webhook.outbound` reference provider**
- Credentials: `signingSecret`. Config: `baseUrl`, `path`, optional
  `extraHeaders` (non-secret).
- Operation `deliver` sends an HMAC-SHA256-signed POST with an
  `Idempotency-Key: <operationKey>` header.
  `retrySafe: true, supportsProviderIdempotencyKey: true`.
- `testConnection` sends a signed `HEAD` (or a `POST` to the configured
  `testPath`) and maps the result to a safe message.
- Bind it to one showcase workflow (`showcase.dataSynchronization`, `billing`
  target) **in addition to** `synthetic.echo`. This demonstrates multiple
  requirements per workflow.
- *Seed:* the webhook connection points at a local mock server
  (`tests/fixtures/mock-webhook-server.ts`). It is not seeded as required, so dev
  boots don't fail.

**INT-11: Provider contract test kit**
- `tests/integrations/provider-contract.ts` exports
  `describeProviderContract(registration, fixtures)`.
  `tests/integrations/all-providers.test.ts` loops over `integrationProviders`,
  so **a new provider gets tested without anyone adding a test file**. Fixtures
  per provider live in `providers/<key>/contract.fixture.ts` (valid/invalid
  credentials and config, plus a mock transport).
- The contract asserts:
  - schema rejects invalid input;
  - `redactConfig` output contains no credential value;
  - `testConnection` never throws, respects the timeout and never returns a
    credential substring;
  - adapter results contain no credential substring;
  - every declared operation has `retrySafe` and `dataClasses`;
  - `capabilities` is non-empty and unique;
  - the egress policy is declared whenever the provider uses `http.ts`.
- A provider with no fixture file fails the suite with a message telling the
  author what to add.

**Phase 3 acceptance:** `webhook.outbound` delivers against the mock server in a
platform integration test with Temporal (retry after an injected 503 produces
exactly one delivery); the contract suite runs for both providers.

### Phase 4: Credential and lifecycle hardening (F5–F10, F17)

**INT-12: Encryption envelope v2 and re-wrap (F5, F6, F7)**
- *Schema:* `IntegrationConnection.credentialEnvelopeVersion String @default("v1")`.
  Migration only adds the column. The row id is generated in the service before
  insert (`uuid` is already a dependency), so AAD can include it on create.
- *Service:* `CredentialEncryptionService`:
  - derives subkeys with HKDF-SHA256 (`info = "integration-cred-enc"` and
    `"integration-cred-fp"`) instead of a single SHA-256;
  - computes the fingerprint as HMAC over `stableHash(credentials)` with a
    **dedicated** fingerprint key (`INTEGRATION_CREDENTIAL_FINGERPRINT_KEY`,
    added to `src/config/index.ts` and `.env.example`; it defaults to an HKDF
    derivation of the active key);
  - uses `v2` AAD = `v2|orgId|connectionId|providerKey`, and decrypts `v1` with
    the legacy AAD.
- *Service:* new `credential-rewrap.service.ts`. For every row that isn't on the
  active key version or on `v2`, it decrypts and re-encrypts. Each row is a
  conditional update on `(id, credentialKeyVersion, credentialEnvelopeVersion)`.
  It is audited once per batch (counts only).
- *Admin/ops:* the `/admin/workflow-operations` card shows connection counts per
  key and envelope version, with a "Re-wrap now" action (CSRF, audited). The
  re-wrap is also an Activity of `platform.integrationMaintenance` (INT-14), so it
  can be scheduled.
- *Tests:* copying a `v2` envelope onto another row → decrypt fails; re-wrap is
  idempotent and safe to run concurrently; the fingerprint is stable across key
  rotation and key order.

**INT-13: Connection and binding lifecycle (F9, F17)**
- *Routes/controller* (`integration.admin.controller.ts`, `integration.admin.routes.ts`):
  - `POST /:id/config` to edit config (validated by the provider; audit stores
    redacted before/after);
  - `POST /:id/enable` to re-enable (clears `disabledAt`, sets `NOT_TESTED`);
  - `POST /:id/delete` to soft-delete (refused while enabled bindings reference
    it, unless `force=1`, which disables those bindings in the same model
    transaction);
  - `POST /workflow-bindings/:workflowDefinitionId/:requirementKey/delete` to
    unbind (soft delete).
- *Service:* `bindRequirement` runs the INT-01 evaluator and rejects anything
  other than `AVAILABLE` or `DISABLED`. It writes `lastValidated*` from that
  evaluation, and its audit includes the `before` binding.
- *Schema:* replace `@@unique([orgId, name])` with a partial unique index
  (`WHERE "deletedAt" IS NULL`) via raw SQL migration, documented in
  `SKILL-data-modeling.md`.
- *Views:* buttons and confirmations in `detail.hbs` and `workflow-bindings.hbs`.
- *Tests:* each new mutation is audited, permission-checked and tenant-isolated
  (a wrong org returns 404).

**INT-14: Idempotency response retention (F8)**
- *Service:* `ActivityIdempotencyService.run` sets `expiresAt` from
  `operation.responseRetentionDays`, capped by the new `SETTING_KEYS` entry
  `ACTIVITY_IDEMPOTENCY_RETENTION_DAYS`. An optional `policy.storeResponse(value)`
  lets an operation persist a summary instead of the full value. It defaults to
  the full value for `dataClasses: ["none"]` and is **required** when
  `dataClasses` includes `"pii"` or `"financial"`; the contract kit enforces this.
- *Service/ops:* add `purgeExpiredResponses(limit)` to the idempotency service.
  It soft-deletes and nulls `response` on expired `SUCCEEDED` rows, and the model
  uses `updateMany ... where expiresAt < now`. There's no periodic operations
  loop today (`reconcileStale` is admin-triggered), so expose the purge (and the
  INT-12 re-wrap) two ways: as an audited admin action on
  `/admin/workflow-operations`, and as a code-registered
  `platform.integrationMaintenance` workflow whose Activities call the services.
  Admins schedule that workflow through the existing `WorkflowSchedule` /
  Temporal Schedule path. Don't add a second scheduler (cron, BullMQ repeatables
  or `setInterval`).
- *Tests:* expired rows are purged; replay after purge returns the
  "reconciliation required" conflict rather than re-executing.

**INT-15: Per-org authorization check (F19, ⟂ D4)**
- Implement whatever D4 decides, and add a negative test: a member with admin
  permission in org A and a non-admin role in org B can't manage org B.

**Phase 4 acceptance:** every connection is on the active key and `v2` after a
re-wrap; lifecycle actions have browser acceptance coverage in
`tests/acceptance/browser-acceptance-test.mjs`; all mutations appear in audit
with no credential material (asserted by scanning `AuditLog.changes` for
fixture secret values).

### Phase 5: Precise agent context (F18)

Goal: an agent given a requirements document can find the exact files, steps
and checks without reading four prose docs, and CI catches it when the docs fall
behind the code.

**INT-16: `skills/SKILL-integrations.md` (single source of truth)**
- Frontmatter `name`/`description`, matching the other skills. Sections:
  1. **Decision tree:** "Is there a provider for this system?" → "Does it have
     the capability?" → "Does the workflow declare the requirement?" → "Is there
     an Activity for the operation?" Each leaf names the exact work-item recipe
     below.
  2. **Recipes**, each an ordered file list with copy-from references:
     *new provider*, *new operation or capability on an existing provider*,
     *new workflow requirement*, *new integration Activity*, *non-workflow
     consumer* (⟂ D2).
  3. **Rules**, as MUST / MUST NOT lines (secrets, determinism, idempotency,
     egress, retention, audit redaction), each linked to the test or check that
     enforces it.
  4. **Done checklist**, the provider-specific items from `AGENTS.md` "Verify
     before finishing".
  5. **Anti-patterns**, each with the error message the guardrail produces.
- Replace the long sections in `SKILL-temporal.md` §Phase 4,
  `SKILL-cross-cutting.md` §Provider resolution and `ARCHITECTURE.md`
  §Workflow Integrations with 3-line summaries that link to the new skill, so
  there's only one place to keep up to date.
- Add rows to `AGENTS.md` (Task → skill) and `skills/README.md`.

**INT-17: Integration requirement intake template**
- `docs/templates/integration-requirement.md` is a structured form an agent
  fills in **before** writing code, and that a human reviews. Fields:
  - external system and docs URL;
  - operations (name, read or side effect, provider idempotency-key support,
    expected latency);
  - data classes in and out;
  - credential type (static key / OAuth ⟂ D1 / mTLS);
  - egress hosts;
  - per-org or platform-wide;
  - consuming workflows or features;
  - failure semantics (what's retryable, what needs operator review);
  - retention;
  - test strategy (mock transport, sandbox account).
- The skill tells agents to save the filled template as
  `docs/integrations/<provider-key>.md`. The provider `README.md` links to it.

**INT-18: Generated integration manifest**
- `scripts/integrations-manifest.mjs` (run with `tsx`, imports the registries,
  and must not touch the DB or env) writes `docs/generated/integrations.manifest.json`:
  ```jsonc
  {
    "providers": [{ "key", "label", "capabilities", "operations": { "<op>": { "retrySafe", "dataClasses", "responseRetentionDays" } },
                    "credentialFields": [{ "key", "type", "required" }], "configFields": [...], "egress", "sourceDir" }],
    "requirements": [{ "workflowKey", "requirementKey", "providerKey", "capabilityKey", "isRequired" }],
    "activities": [{ "name", "scope", "providerKey", "operation" }]
  }
  ```
  It also renders `docs/generated/INTEGRATIONS.md` (tables) for humans.
- `npm run check:integrations` regenerates the manifest and fails on any diff.
  Add it to `test:local:all` and CI.
- Activity → provider/operation mapping comes from `runIntegrationOperation` call
  sites, collected with the same TypeScript AST approach as
  `check-architecture.mjs`.

**INT-19: Architecture guardrails for integrations**
- Add to `scripts/check-architecture.mjs` (each rule gets a unit test and an
  error message that names the skill section):
  - `src/integrations/**` must not import `src/services/**`, `src/models/**`,
    `src/lib/prisma*`, `src/config/**`, Express or `src/temporal/workflows/**`;
  - integration Activities must go through `runIntegrationOperation`. A direct
    `integrationResolverService.resolve` under `src/temporal/activities/**` is an
    error, except inside the helper itself;
  - `src/integrations/providers/*/` must contain `index.ts`, `schemas.ts`,
    `adapter.ts`, `README.md` and `contract.fixture.ts`;
  - `fetch(` and `node:http(s)` imports under `src/integrations/providers/**`
    are an error. Providers must use `http.ts`.

**Phase 5 acceptance:** a "cold agent" dry run is recorded in
`EXECUTION-REPORT`. A fresh agent session, given only a filled intake template
for a hypothetical `slack.webhook` provider, produces a passing implementation
(contract kit, manifest check, architecture check, typecheck) without a human
correcting file placement or layering.

### Phase 6: Repo-local MCP server (⟂ D5)

Goal: the same context as Phase 5, but queryable and with validation built in,
for agents that support MCP (Claude Code, Codex). Files remain the source of
truth. The MCP server only reads them and runs the existing checks.

**INT-20: `tools/mcp/boilerplate-context`**
- Stdio server built on `@modelcontextprotocol/sdk` (devDependency, pinned
  version), started with `npm run mcp:context`. Registered in `.mcp.json`
  (Claude Code) and `.codex/config.toml` (Codex; currently empty).
- **Resources** (read-only):
  - `skill://<name>` → each `skills/*.md`;
  - `manifest://integrations` → the generated manifest;
  - `template://integration-requirement` → the intake template;
  - `provider://<key>/readme`.
- **Tools:**

  | Tool | Input | Output |
  |---|---|---|
  | `list_integration_providers` | — | keys, capabilities, operations (from manifest) |
  | `get_provider_contract` | `providerKey` | full manifest entry + source file paths + README |
  | `list_integration_requirements` | `workflowKey?` | requirements + which Activities serve them |
  | `get_change_recipe` | `kind: new-provider \| new-operation \| new-requirement \| new-activity \| non-workflow-consumer` | ordered steps with exact paths and copy-from refs (rendered from SKILL-integrations recipes) |
  | `check_requirement_spec` | path to a filled intake template | missing or invalid fields, unknown providers, conflicts with the existing manifest |
  | `scaffold_provider` | `key, label, capabilities, operations[]` | **dry-run** file map (path → contents) for `providers/<key>/*`, plus registry and manifest diffs. Never writes. |
  | `validate_integrations` | — | structured results of `check:architecture`, `check:integrations`, the provider contract suite and `tsc --noEmit` (spawned with a fixed argv; no shell, no user-supplied args) |
- **Safety:** the server reads only under the repo root through a path
  allowlist. It doesn't load `.env` or `src/config`, never imports Prisma, makes
  no network calls, and its command execution is limited to the fixed set above.
  Tests in `tests/tools/mcp-context.test.ts` assert that path traversal, env
  access and arbitrary command execution are refused.
- **Docs:** add a section to `AGENTS.md`, "If your agent supports MCP, connect
  `boilerplate-context`; it serves the same skills and checks". Explain that
  `scaffold_provider` output must still pass `validate_integrations`.

**Phase 6 acceptance:** repeat the Phase 5 cold-agent dry run using only the MCP
tools plus file edits, and record the tool-call transcript summary in
`EXECUTION-REPORT`.

### Phase 7: Deferred (needs a concrete provider)

- **INT-21: Refreshable credentials (⟂ D1).** The adapter factory receives
  `credentialStore.update(next)`, which goes through `IntegrationService`. It
  re-encrypts, uses a CAS update on the fingerprint, writes the audit with
  fingerprints only, and is safe under concurrent Activities. OAuth
  authorization-code flow pages live under `/admin/integrations/:id/oauth/*`.
- **INT-22: App-feature requirements (⟂ D2).** Add
  `WorkflowIntegrationRequirement.ownerType` (`WORKFLOW | APP_FEATURE`) plus
  `ownerKey`, and generalise the binding to match. Add an
  `appFeatureIntegrationService.resolve(featureKey, requirementKey, orgId)` for
  services. Admins bind them on the same page.

---

## 5. Cross-phase test strategy

| Layer | Suite | What it proves |
|---|---|---|
| Pure | `tests/services/integration-availability.test.ts`, `tests/services/integration-safety.test.ts` | gate and resolver agree on every state (INT-01) |
| Service (mocked models) | `integration.service.test.ts`, `credential-encryption.service.test.ts`, `credential-rewrap.service.test.ts`, `activity-idempotency.service.test.ts` | lifecycle, CAS, redaction, retention |
| Provider contract | `tests/integrations/all-providers.test.ts` | every registered provider meets the contract (INT-11) |
| Activity | `tests/temporal/integration-activity.test.ts` (adds `@temporalio/testing` as a pinned devDependency for `MockActivityEnvironment`; not currently installed) | non-retryable mapping, resolve-before-reserve |
| Static | `tests/security/architecture.test.ts`, `check:integrations` | guardrails and manifest drift |
| Platform (owned DB + Temporal) | `test:platform:owned` | webhook delivered exactly once under retry; v2 envelope transplant rejected in real SQL; re-wrap under concurrency |
| Browser acceptance | `browser-acceptance-test.mjs` | create → test → disable → enable → edit config → unbind → delete |
| Secret leak scan | new `tests/platform/secret-leak-scan.test.ts` | fixture secrets absent from `AuditLog`, `ActivityIdempotency.response`, `IntegrationConnection.lastTestMessage`, Temporal history export and Worker logs |

---

## 6. Rollout and compatibility

- Phase 1 changes no schema and is safe to ship first.
- Phase 2 moves files. Keep `provider-registry.ts` as a re-export for one
  release. Workflow code changes are type-only, but `temporal:replay` is still
  required.
- Phase 4's migration only adds columns or indexes. The envelope `v1` read path
  stays until every environment reports zero `v1` rows on the operations card.
  Removing it is a separate, recorded decision.
- Each phase updates `EXECUTION-CHECKLIST` with source, component, runtime and
  acceptance status, following the existing convention.

## 7. Suggested sequencing

```
Phase 1 ──► Phase 2 ──► Phase 3 ──► Phase 5 ──► Phase 6
                 └────► Phase 4 (parallel with 3 once INT-06/07 land)
```
Phase 5's skill and recipes are written against Phase 2/3 file layout, so they
start after INT-06 and INT-10 merge. INT-16 can be drafted earlier and finalised
then.
