# Boilerplate improvement execution checklist — October 20, 2026

This is the current execution disposition, superseding the earlier foundation-only checklist. The superseded implementation plans have been removed; current extension contracts are in `docs/blueprint/EXTENSION-CONTRACTS.md` and exact observed evidence is in `docs/blueprint/EXECUTION-REPORT-2026-10-20.md`. Local verification is distinct from production acceptance.

| Package | Source disposition | Local verification | Remaining acceptance boundary |
|---|---|---|---|
| BP-00 | Baseline, provenance and decisions complete | Original dirty files/checksums preserved | Actual deployed release/migration identity not supplied |
| BP-01 | Safe unit/integration split and architecture boundaries complete | Unit guard, owned SQL/process/browser fixtures | CI required-check settings are external |
| BP-02 | Browser CSRF and truthful static metadata complete | Actual browser/forms/uploads; real Redis queue pause/resume and CSRF negatives | Consumer adoption separate |
| BP-03 | Metadata-only audit and atomic command reference complete | Real SQL rollback, duplicate race, CAS/replay | Every consumer command is not automatically converted |
| BP-04 | Local private storage and shared connection resolver complete | Two file policies, authorization/checksum/backend negatives, restore | S3 and legacy confidential public URLs require separate adoption |
| BP-05 | Neutral tenant adapter and accessible validation recovery complete | Two SQL-backed resources in Chromium, version/replay/stale rejection | Consumer specialized editors retained |
| BP-06 | Drain, bounded forced exit and resource close complete | Actual blocked Activity, SIGTERM, forced exit and restart | Actual process-manager/host HA acceptance |
| BP-07 | Encrypted durable start intent and atomic exact-run projection complete | Lost accepted response, durable recovery, HTTP/Activity duplicate races | Deployed compatibility inventory |
| BP-08 | Attempt fencing and explicit uncertainty/reconciliation policy complete | Independent synthetic provider receipt map; delayed old completion and commit-loss recovery | Real provider policies/receipts must be certified separately |
| BP-09 | Durable Update receipts and neutral read/submit task policies complete | Lost Update response; token/receipt atomicity; live expiry/revocation; two task policies | Consumer guest/resource rules; broader workflow-specific resubmission branches |
| BP-10 | Stable modules/exports, patch-gated runtime and cancellation/outcomes complete | Original 15 types replay; waiting-human cancellation; old waiting execution upgrade | Full deployed branch corpus and effect/timer/child/fanout cancellation matrix |
| BP-11 | Shared TLS/mTLS/API-key and authenticated versioned payload codec complete | Real Client/NativeConnection RPC, credential/CA negatives; retained-key/tamper tests | Actual secret-store rotation and retained production history policy |
| BP-12 | Safe Activity logs, application canary, recovery controls and truthful dashboard complete | Real canary/dead queue, Schedule trigger/projection, authorized recovery seams | Production collectors/alert routing/owners; full Schedule partial-operation matrix |
| BP-13a | Exact artifact builder/replay/manifest gate complete | Prior-source synthetic histories; original IDs, integrity and incompatible control | Actual supported deployed release inventory remains BLOCKED |
| BP-13b | CI verification/release gate source complete | Local exact-bundle CLI replay and old waiting execution continuation | Repository required checks and deployed rolling-version routing remain BLOCKED |
| BP-14 | Owned load/outage/restore/forced-recovery harness and runbook complete | Application DB/private-volume restore and waiting work resume; 25 concurrent canaries | Actual HA/Temporal persistence restore, named SLO/RPO/RTO, external monitoring/deployment |
| BP-15 | Platform contracts, examples and second-resource proof complete | Two distinct admin/file/task policies without product branches in common code | SI-01–05 and seven Solution Intent journeys are consumer work, not performed |
| INT-P1 | Integrations hardening Phase 1 (INT-01..05) source complete: shared availability evaluator, disabled-stays-disabled + CAS test results, guarded/scrubbed connection tests, resolve-before-reserve non-retryable `INTEGRATION_*` Activity failures, schedule binding-health on operations dashboard | Unit/component only: gate↔resolver parity matrix, service/Activity/view tests; build + workflow bundle | Owned-SQL CAS, live Temporal non-retryable failure, and browser acceptance not yet run; replay corpus still empty (see `INTEGRATIONS-HARDENING-PLAN.md`) |

## Decisions applied

- [x] DEC-01: static metadata is inventory unless an explicit enforcement adapter is registered.
- [x] DEC-02: general audit is metadata-only; authoritative evidence commits atomically.
- [x] DEC-03: mandatory private-file policy, local backend first; no implicit S3 acceptance.
- [x] DEC-04: services authorize; models own transactions/receipts; no leaked transaction object.
- [x] DEC-05: receipt/delivery/business outcome are separate; uncertainty is recoverable.
- [x] DEC-06: self-hosted target, isolated local drill; production objectives remain owner-specific.
- [x] DEC-07: production TLS plus encryption; retained keys and explicit legacy decode; no silent encrypted downgrade.
- [x] DEC-08: patch retention and stable Signals; exact artifact gate; unknown deployed inventory blocks rollout.
- [x] DEC-09: separate additive private table preserves legacy public Asset shape and URLs.

## Local release checkpoints

- [x] G0: preserved source, safe unit suite, owned fixtures, requirements disposition.
- [x] G1: browser/audit/private-file shared controls verified locally.
- [x] G2: second tenant resource plus distinct private-file/task policies verified locally.
- [ ] G3 production/full matrix: representative local start/effect/action/process/cancel/Schedule cases pass; full domain branch/provider coverage remains.
- [ ] G4 deployed compatibility: local baseline replay/upgrade passes; deployed release inventory is absent.
- [ ] G5 production operations: local drills pass; actual topology/HA/objectives/collectors are not accepted.
- [ ] G6 consumer adoption: platform documentation complete; Solution Intent source unchanged.

No existing application database, production infrastructure or external account was modified. No commit, push, remote CI run or deployment was performed. A complete local result must not be read as production-ready approval.
