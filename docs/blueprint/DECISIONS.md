# Boilerplate execution decisions — October 20, 2026

These decisions describe the current implementation. They do not certify production readiness or change Solution Intent's domain policy.

| Decision | Current disposition | Consequences / remaining work |
|---|---|---|
| DEC-01 Static metadata | Implemented: static Page/Route discovery is inventory; explicit `enforcePagePermissions` registration supplies enforcement. | Only the declared static slugs expose effective role editing. Inventory-only role writes are rejected server-side. CMS role joins are normalized correctly. |
| DEC-02 Audit | Implemented: bounded metadata allowlist and safe failure codes. | General audit cannot reconstruct document content. Business evidence must commit atomically with the state it proves; best-effort logging alone is insufficient. Historical audit rows are not rewritten. |
| DEC-03 Private files | Implemented local-only service with mandatory resource policy, bounded bytes, backend identity and SHA-256. | No permissive singleton or generic private-file HTTP route. S3 remains unavailable through this primitive until separately implemented and accepted. |
| DEC-04 Transactions | Implemented reference: service validates/authorizes; model owns transaction and receipt identity. | Project create uses an atomic AuditLog receipt; private-file reservation/transitions use atomic metadata audit. This is a reference, not a retrofit of every mutation. No transaction object crosses into controllers/services. |
| DEC-05 Human action outcomes | Implemented locally: RECEIVED, queued/delivered acknowledgment and business outcome are separate. | New starts use Updates; old Signal names remain available. Stable receipts recover uncertain delivery. Never describe a transport acknowledgment as business acceptance. |
| DEC-06 Topology | User selected self-hosted Temporal with existing executions on October 20. | Exact deployment/version, namespace/task queues, process manager, secret store, termination grace, SLO/RPO/RTO and accountable owners still need inventory. No production connection or deployment was performed. |
| DEC-07 Transport and history | Implemented locally: shared transport and versioned authenticated payload codec. | Client and Worker share TLS/mTLS/API-key configuration. Production plaintext is rejected. Local real-RPC transport and retained-key codec tests pass; actual deployment rotation remains an acceptance gate. |
| DEC-08 Compatibility | Existing executions are in scope; supported releases/history corpus not supplied. | Workflow modules now use patch-gated runtime changes and preserve old exports/Signals. Fifteen pre-change-source histories replay locally. Empty/partial replay corpus blocks the gate. Before production rollout: identify deployed release/bundle digests, retained branches and patch/version routing, then review synthetic histories from those releases. Current-code replay is not historical proof. |
| DEC-09 Expand-only private storage | Implemented using a separate PrivateAsset table, rather than adding a nullable URL/classification to public Asset. | Public rows/URLs remain compatible. Private records have no URL and are structurally unreachable from public Asset queries/deletion. Preserve private bytes and metadata during rollback; inventory legacy confidential public URLs separately. |

## Compatibility and rollback

- The new `20261020170000_add_private_asset` migration adds one enum, one table, indexes and an organization foreign key. No old table is dropped or relabelled. The migration has been tested only on owned disposable PostgreSQL fixtures.
- Historical migrations and the lockfile had pre-existing local modifications. Their bytes were preserved; production migration checksums must be compared against the actual deployed database before any migration rollout.
- Roll back application code while retaining the additive table/private volume. Do not make private data public to roll back. Do not delete pending uploads without resource retention authorization.
- PENDING uploads are unavailable for reads. A stable operation ID validates actor, metadata, backend and digest before replay. Repeating upload or `recoverUpload` can finish publication only after verified bytes exist. Interrupted deletion remains DELETING and repeating `remove` resumes cleanup.
- Partial/stale upload bytes are not overwritten by a replay. Authorized retention/repair procedures must decide whether to discard the pending object. Existing public confidential-file exposure is not repaired automatically.
- Worker graceful/force configuration must be less than the orchestrator's termination allowance, with time left for resource cleanup. Actual graceful and bounded forced exit/restart tests pass locally. Actual host/HA failover remains a production acceptance gate.

The additive `20261020200000_workflow_recovery` migration adds start intents, effect attempts/uncertainty and delivery/outcome fields. Old clients may not understand new enum values. Preserve the new tables/ledger states during rollback and retain compatible readers. See `LOCAL-OPERATIONS.md` for release, key retention, restore and incident procedures.
