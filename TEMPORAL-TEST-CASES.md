# Temporal Orchestration Test Cases

This catalog converts [`TEMPORAL-INTEGRATION-PLAN.md`](./TEMPORAL-INTEGRATION-PLAN.md)
and [`TEMPORAL-PRODUCTION-ROADMAP.md`](./TEMPORAL-PRODUCTION-ROADMAP.md) into
executable test cases. It is a test design artifact, not application runtime
code. Cases should be implemented in the indicated test layer and linked from
`TEST_RESULTS.md` when run.

## 1. Test conventions

### Test layers

| Layer | Location | Purpose |
|---|---|---|
| Unit | `tests/services/`, `tests/temporal/unit/` | Pure registry, schema, service, policy, redaction, and state logic with mocks |
| Controller | `tests/controllers/` | Zod rejection, authorization, response envelope, redirects |
| Model/integration | `tests/models/`, `tests/integration/` | Real PostgreSQL queries, indexes, soft-delete and org isolation |
| Workflow | `tests/temporal/workflows/` | Temporal time-skipping, timers, retries, Signals, Updates, children, cancellation |
| Replay | `tests/temporal/replay/` | Historical Event History compatibility against the Worker bundle |
| Acceptance | `tests/acceptance/` | Real web + Worker + self-hosted Temporal + Postgres |
| Resilience/load | `tests/temporal/resilience/` | Restart, failover, concurrency, overload, and recovery behavior |

### Required test data

- organizations `org-a` and `org-b` with users having owner/admin/member roles;
- one enabled and one disabled workflow definition;
- one workflow with a required `synthetic.echo` binding and one missing binding;
- valid, expired, revoked, duplicate, and cross-organization task tokens;
- deterministic workflow inputs with unique business keys;
- a redaction corpus containing keys matching `url`, `token`, `secret`, `password`, `credential`, raw document text, prompts, and transcripts;
- current and previous credential/payload encryption keys;
- sanitized histories for timer, retry, Signal, Update, child, compensation, schedule, and projection-ingestion workflows.

### Baseline commands

Every implementation slice runs:

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

Self-hosted cases additionally require the app Postgres, Temporal Postgres,
Temporal server, Web process, and separate Worker process. Never use production
credentials or real provider data in these tests.

## 2. Initial integration plan cases

These cases validate the original Phase 0–7 integration plan and the migrated
showcase waves.

### Phase 0–1: foundation and catalog

| ID | Case | Layer | Expected result |
|---|---|---|---|
| INT-001 | Typed Temporal config accepts valid endpoint, namespace, task queue, and timeout values | Unit | Config parses; invalid URLs, empty namespace, and non-positive timeout fail startup validation |
| INT-002 | Temporal Client gateway connects and reports diagnostics | Service/acceptance | `/health` reports Temporal up; unavailable server produces bounded failure and useful diagnostics |
| INT-003 | Worker starts independently of Express | Acceptance | Worker process boots without importing `app.ts`/`server.ts`; Web process remains functional when Worker is stopped |
| INT-004 | Workflow registry rejects duplicate keys and invalid contracts | Unit | Duplicate key, missing form, invalid action, or unsupported field type fails registry validation |
| INT-005 | Startup workflow sync is idempotent | Integration | Running sync twice updates the same definition, creates no duplicate rows, and preserves admin metadata/policy |
| INT-006 | Catalog filters by active organization and role capability | Service/controller | User sees only enabled definitions allowed by role and organization; disabled/unauthorized definitions are hidden and direct access is forbidden |
| INT-007 | Admin metadata cannot change executable workflow type | Controller/service | Admin may edit presentation, enablement, and policy but cannot point a definition at arbitrary code |
| INT-008 | Generic start form renders registry fields and validation errors | Controller/view/acceptance | Form is generated from metadata; malformed input re-renders safely; no view/database fetch occurs |
| INT-009 | Required integration gating blocks launch | Service/acceptance | Missing, disabled, wrong-provider, or cross-org binding blocks start with an actionable error |
| INT-010 | Organization context never guesses among memberships | Service/controller | No active org yields a clear selection/error; selected org is authorized and all downstream queries are scoped |

### Phase 2: execution and projection

| ID | Case | Layer | Expected result |
|---|---|---|---|
| INT-011 | Start workflow with unique business key | Service/workflow/acceptance | Temporal execution starts once; projection stores org, definition, workflow ID/run ID, input summary, and RUNNING state |
| INT-012 | Duplicate start is idempotent or conflicts per contract | Service/acceptance | Same business key cannot create unintended duplicate business execution; response identifies existing/conflicting run |
| INT-013 | Query and refresh projection | Service/acceptance | Query returns safe state summary; refresh reconciles Temporal status; stale/unknown execution is handled without 500 |
| INT-014 | Cancel authorized execution | Service/workflow/acceptance | Authorized cancel reaches Temporal, projection transitions correctly, and audit record is written |
| INT-015 | Unauthorized/cross-org execution access | Service/controller/integration | List, detail, refresh, and cancel cannot access another organization’s execution |
| INT-016 | Workflow retry and Activity failure classification | Workflow | Retryable errors retry with policy; non-retryable errors fail deterministically; projection records safe failure summary |
| INT-017 | Worker restart preserves in-flight execution | Acceptance/resilience | Stop/restart Worker; execution resumes or retries without duplicate irreversible side effect |
| INT-018 | Projection write is idempotent | Service/integration | Duplicate projection-ingestion attempts converge to one row and do not regress terminal state |

### Phase 3: human interaction

| ID | Case | Layer | Expected result |
|---|---|---|---|
| INT-019 | Durable human task created at Workflow wait | Workflow/service/integration | Task row contains org, workflow/run, role, action schema, expiry; no secret payload is stored |
| INT-020 | Authenticated task inbox visibility | Controller/acceptance | User sees only tasks allowed by org and role; completed/expired tasks are clearly separated |
| INT-021 | Public token task flow | Controller/acceptance | Valid token renders task; expired/revoked/consumed/cross-org token is rejected without revealing workflow details |
| INT-022 | CSRF and idempotency protection | Controller | Missing/invalid CSRF fails; duplicate request with same idempotency key returns same receipt and one business effect |
| INT-023 | Concurrent human actions | Workflow/service/integration | Exactly one action wins according to policy; competing action receives deterministic conflict/closed response |
| INT-024 | Human action authorization and schema validation | Controller/service/workflow | Invalid action, wrong role, malformed fields, or stale task is rejected and audited safely |
| INT-025 | Signal delivery and task finalization under Worker restart | Acceptance/resilience | Action receipt remains reconcilable; task does not become falsely completed or permanently stuck |
| INT-026 | Email task link redaction | Unit/acceptance | Email contains only intended tokenized URL; logs/audit/test output never contain raw token or secrets |

### Phase 4: integrations and Activities

| ID | Case | Layer | Expected result |
|---|---|---|---|
| INT-027 | Credentials encrypted at rest | Service/integration | Ciphertext, IV, auth tag, key version, and fingerprint persist; plaintext is absent from safe projections |
| INT-028 | Activity resolves only bound connection | Activity/integration | Activity receives requirement key, resolves org binding, decrypts inside Worker boundary, and returns non-secret result |
| INT-029 | Cross-org credential isolation | Integration | Org A workflow cannot resolve Org B connection even with guessed IDs |
| INT-030 | Provider schema/config validation | Unit/service | Invalid provider config/credentials fail before Activity side effect; redacted error is returned |
| INT-031 | Activity idempotency and retry | Service/integration | Same operation/request hash replays completed result; mismatched hash conflicts; retry does not duplicate side effect |
| INT-032 | Stale RUNNING idempotency claim recovery | Service | Fresh claim conflicts; claim older than configured threshold can be recovered and audited |
| INT-033 | Integration disable/rotation behavior | Acceptance | Disabled binding blocks new starts; in-flight Activity behavior is documented; rotated credentials use active key while old version remains decryptable as configured |
| INT-034 | Secret leak corpus test | Unit/integration | Credentials, token prefixes, URLs with secrets, raw prompts/documents/transcripts do not appear in logs, audit, summaries, emails, or history |

### Phase 5: operations and schedules

| ID | Case | Layer | Expected result |
|---|---|---|---|
| INT-035 | Operations dashboard diagnostics | Acceptance | Temporal connectivity, Worker pollers, queue, schedules, and projection drift render without controller/view Temporal calls |
| INT-036 | Schedule create validates workflow/org/integration policy | Service/controller | Invalid cron/timezone/input/missing binding is rejected; valid schedule is audited and projected |
| INT-037 | Schedule pause/unpause/trigger/delete | Acceptance | Temporal Schedule API and local projection stay consistent; delete soft-deletes local projection and preserves executions |
| INT-038 | Scheduled run ingests execution projection | Workflow/integration | Real scheduled execution creates its own `WorkflowExecution`; no fake row is created by schedule creation |
| INT-039 | Schedule overlap/catch-up policy | Workflow/acceptance | Overlap and missed-run behavior match documented policy and do not create unintended duplicates |
| INT-040 | Stale execution reconciliation | Service/integration | Reconciliation refreshes bounded stale rows, records attempted/succeeded/failed counts, and is idempotent |

### Phase 6 showcase migration cases

| ID | Workflow family | Required proof |
|---|---|---|
| INT-041 | Customer onboarding / human approval | Generic form, role-gated task, approval/rejection/resubmit, reminder, integration binding, projection, and safe action receipt |
| INT-042 | Order fulfillment saga | Forward Activities, compensation ordering, idempotency ledger, retry classification, cancellation cleanup, and compensated projection |
| INT-043 | Data synchronization | Parallel CRM/ERP/Billing fan-out, reconciliation, retry, target summaries without secrets, and completed projection |
| INT-044 | Employee lifecycle / client engagement | Timers, cancellation/date-change Signals, manager/client tasks, child workflows, cleanup, and no bespoke route/template |
| INT-045 | AI document / support agent | Safe references, structured outputs, confidence/policy gate, human correction/approval, idempotent tools, and no raw content in history |
| INT-046 | Compliance / underwriting | Schedules, parallel evidence tasks, reminders/escalations, missing-information loop, child risk checks, analyst decision history, and cancellation |

Each showcase case requires a unit test, a time-skipping Workflow test, a
service authorization/idempotency test, and one self-hosted acceptance smoke.

### Phase 7 documentation convergence

| ID | Case | Layer | Expected result |
|---|---|---|---|
| INT-047 | New contributor local setup | Documentation/acceptance | README alone is sufficient to start DB, Temporal, Web, Worker, migrations, and seed |
| INT-048 | Agent routing correctness | Documentation review | AGENTS, architecture, conventions, Temporal skill, and task-specific skills identify correct files and prohibited imports |
| INT-049 | Source-of-truth search | Script/review | No stale claim says Worker runs in Web, Temporal is absent, old ports/commands are current, or docs expose secrets |
| INT-050 | Final command/link verification | CI/documentation | Documented commands and local links resolve or are explicitly marked optional/deferred |

## 3. Production roadmap cases

### P0: baseline audit and backlog normalization

| ID | Case | Expected result |
|---|---|---|
| PR-001 | Capability evidence audit | Every claimed codec, replay fixture, Update, metric, smoke, and deployment feature is classified as proven, partial, or absent with source/test evidence |
| PR-002 | Documentation contradiction scan | `SKILL-temporal.md`, runbook, test plan/results, integration plan, and roadmap agree on replay/codecs/Updates status |
| PR-003 | Backlog completeness | Each open risk has ID, severity, owner, acceptance test, and target phase; no untracked production blocker remains |
| PR-004 | Local-state review | `.codex/` is intentionally ignored/documented and contains no product source or secret |

### P1: payload security

| ID | Case | Expected result |
|---|---|---|
| PR-005 | Payload codec round trip | Client encrypts; Worker decrypts; workflow executes; ciphertext envelope includes version and authenticated integrity |
| PR-006 | Wrong key/tamper fail closed | Missing, wrong, retired-without-fallback, malformed, or tampered payload is rejected without plaintext logging |
| PR-007 | Key rotation with in-flight history | New payloads use active key; old histories replay/decrypt with previous key; rotation procedure is reversible within policy |
| PR-008 | Payload size/type limits | Oversized, unsupported, cyclic, or sensitive raw payload is rejected or transformed to safe reference before start |
| PR-009 | End-to-end secret absence | Raw credentials, tokens, prompts, documents, transcripts, and provider responses are absent from Event History, projections, logs, audit, email, and browser HTML |

### P2: replay and versioning

| ID | Case | Expected result |
|---|---|---|
| PR-010 | Fixture coverage inventory | Every registered workflow family has sanitized timer/retry/action/child/schedule/terminal fixture coverage where applicable |
| PR-011 | Replay CI pass | Replay command passes against the exact Worker bundle in a clean checkout |
| PR-012 | Intentional nondeterminism detection | Changing command ordering/API or removing a history branch makes replay CI fail with actionable output |
| PR-013 | Additive schema compatibility | Optional input/state field addition replays old histories and new runs |
| PR-014 | Versioned behavior rollout | `patched`/versioned Workflow behavior supports old and new histories; rollout and retirement steps are documented |

### P3: human-task interaction contract

| ID | Case | Expected result |
|---|---|---|
| PR-015 | Update validation response | Invalid human action is rejected synchronously by Workflow Update; valid action returns accepted result and advances state once |
| PR-016 | Signal asynchronous contract | Signal-based action explicitly returns pending/accepted semantics and reconciliation closes the task only after authoritative Workflow state |
| PR-017 | Duplicate/concurrent Update | Same request ID is idempotent; concurrent conflicting Updates have deterministic winner/rejection |
| PR-018 | Claim/ack/expiry | Task claim, acknowledgement, expiry, revocation, and reassignment survive Worker/Web restarts and are audited |
| PR-019 | Public token abuse | Rate limits, CSRF, expiry, replay, enumeration, and cross-org attempts are rejected without oracle leakage |

### P4: projection and schedule reliability

| ID | Case | Expected result |
|---|---|---|
| PR-020 | Scheduled projection live smoke | Real Temporal schedule starts a Workflow and creates exactly one local execution projection |
| PR-021 | Projection convergence | Duplicate, delayed, out-of-order, and failed ingestion attempts converge to correct terminal state |
| PR-022 | Temporal unavailable | Refresh/reconciliation returns bounded operational status; no destructive local state transition occurs |
| PR-023 | Child visibility policy | Parent/child visibility matches documented Temporal-vs-Postgres projection policy and authorization |
| PR-024 | Schedule overlap/catch-up | Configured overlap and catch-up behavior is proven under time-skipping and self-hosted tests |

### P5: observability and operations

| ID | Case | Expected result |
|---|---|---|
| PR-025 | Metric emission | Starts, completions, failures, retries, cancellations, tasks, Activities, integrations, drift, schedules, and pollers emit bounded labeled metrics |
| PR-026 | Correlation safety | Request/workflow/run/activity IDs correlate logs without payloads, credentials, or high-cardinality unbounded labels |
| PR-027 | Alert fault injection | Injected Worker outage, Activity failure, projection drift, and schedule lag produce the intended alert with runbook link/owner |
| PR-028 | Safe remediation | Authorized retry/reconcile/cancel controls are audited, scoped, idempotent, and cannot execute arbitrary signals |

### P6: self-hosted production topology and DR

| ID | Case | Expected result |
|---|---|---|
| PR-029 | Reproducible deployment | Deployment manifests pin compatible versions and configure separate Temporal persistence, Web, Worker, and UI boundaries |
| PR-030 | Persistence backup | Scheduled Temporal persistence backup completes, is encrypted, monitored, and retained per policy |
| PR-031 | Restore drill | Restore reaches documented RPO/RTO and resumes/reconciles in-flight workflows without duplicate side effects |
| PR-032 | Worker rolling replacement | Drain/stop one Worker; another Worker continues polling and in-flight executions complete |
| PR-033 | Temporal upgrade rehearsal | Version upgrade/rollback procedure is exercised against representative histories and replay fixtures |
| PR-034 | UI/network security | Temporal UI is inaccessible from unauthorized networks/users and uses TLS/auth in the production topology |

### P7: performance and resilience

| ID | Case | Expected result |
|---|---|---|
| PR-035 | Concurrent start load | At target concurrency, starts meet SLOs, duplicate keys remain safe, and DB/Temporal pools stay within limits |
| PR-036 | Task flood/load shedding | Human-task flood is rate-limited/back-pressured predictably; no unbounded memory or DB growth occurs |
| PR-037 | Large payload rejection | Payload and history limits reject oversized inputs with actionable safe errors |
| PR-038 | Failure matrix | Web, Worker, Temporal, DB, integration, and network failures recover according to documented policy |
| PR-039 | Cancellation storm | Bulk cancellation does not corrupt projections, leak tasks, or duplicate compensation |
| PR-040 | Capacity report | Throughput, latency, queue depth, history size, Worker concurrency, and scaling thresholds are recorded and reproducible |

### P8: security, privacy, and compliance

| ID | Case | Expected result |
|---|---|---|
| PR-041 | Authorization matrix | Every workflow, execution, task, binding, schedule, operations, token, and admin action rejects unauthorized/cross-org access |
| PR-042 | IDOR and enumeration | Guessing IDs/tokens does not reveal existence, metadata, or timing oracle across organizations |
| PR-043 | Secret/dependency scan | CI finds no committed secrets and reports/remediates high-severity dependency vulnerabilities |
| PR-044 | Audit completeness | Mutations and remediation actions have actor/org/entity/action/before-after data with sensitive redaction |
| PR-045 | Retention/deletion policy | Task, execution, credential, payload, audit, backup, and Temporal history retention behavior is documented and tested |
| PR-046 | Key compromise drill | Credential/payload key rotation and revocation procedure limits blast radius and preserves approved in-flight behavior |

### P9: controlled release and P10: documentation

| ID | Case | Expected result |
|---|---|---|
| PR-047 | Workflow production readiness checklist | Every migrated workflow has owner, SLO, data classification, rollback, alerts, replay fixture, and canary evidence |
| PR-048 | Canary disable/rollback | Disabling a workflow blocks new starts while in-flight runs follow documented behavior; rollback does not break history replay |
| PR-049 | Documentation build/setup | Fresh contributor follows README and reaches a healthy Web + Worker + Temporal stack |
| PR-050 | Agent handoff review | Another coding agent can identify architecture boundaries, relevant skills, commands, and phase status without tribal knowledge |
| PR-051 | Documentation secret scan | Docs, fixtures, screenshots, examples, and test artifacts contain no real credentials, raw tokens, or sensitive payloads |
| PR-052 | Final source/doc parity | Model list, routes, process topology, config keys, commands, test counts, and phase statuses match source and CI evidence |

## 4. Release gate matrix

| Gate | Required cases | Block release if |
|---|---|---|
| Foundation | INT-001–010, INT-047–050 | Catalog, org isolation, or setup is not reproducible |
| Execution | INT-011–018 | Duplicate, restart, cancel, or projection behavior is unsafe |
| Human interaction | INT-019–026, PR-015–019 | Human action can double-apply, bypass authorization, or become irreconcilable |
| Security | INT-027–034, PR-005–009, PR-041–046 | Secrets leak or high-severity authorization/privacy issue remains |
| Replay/versioning | PR-010–014 | In-flight histories are not replay-tested |
| Operations/DR | INT-035–040, PR-020–034 | Operators cannot diagnose/recover or restore within RPO/RTO |
| Resilience | PR-035–040 | Load/failure behavior is unknown or corrupts state |
| Workflow release | INT-041–046, PR-047–048 | Any production workflow lacks owner, rollback, fixture, alert, and canary evidence |

## 5. Test result recording template

```text
Case ID:
Phase:
Implemented in:
Environment/commit:
Preconditions:
Command or steps:
Expected result:
Observed result:
Artifacts/evidence:
Status: PASS | FAIL | BLOCKED | DEFERRED
Defect/backlog ID:
Owner and next action:
```

