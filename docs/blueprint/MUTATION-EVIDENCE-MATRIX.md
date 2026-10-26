# Mutation evidence matrix — October 26, 2026

This inventory distinguishes authoritative database evidence from operational telemetry and external effects. `BaseModel.mutate` commits a write and a `safeAuditEntry` in one SQL transaction. Audit failure rolls back that write. It stores only event identity, COMMITTED/NOT_APPLIED, counters, result references and optional command fingerprints. Services retain authorization; transaction clients never leave models.

When a model command accepts `CommandMetadata`, the service creates it with `commandMetadata(input, operationId)`. The receipt identity includes action, entity type, actor, target and operation UUID. Identical concurrent commands converge; changed input conflicts. Fingerprints are keyed HMACs, never raw bodies or standalone password verifiers. Keep the configured JWT secret stable during the retry window; rotation safely causes fingerprint conflicts rather than reapplying old requests. The older project-create receipt remains compatible with its existing SHA-256 contract.

Replay readers use the same safe projection as the original write. They return the current referenced row, as the original project reference did, rather than a historical content snapshot. Missing referenced results conflict. Services reauthorize before replay; revocation/deactivation/deletion can deny a retry even when a receipt exists. An omitted operation UUID creates a fresh identity and does not provide cross-request replay protection. These contracts do not promise that every read model is versioned or that an external effect participates in SQL atomicity.

| Model / writers | Authoritative contract | Replay / actor boundary |
|---|---|---|
| `user.model.ts`: create, update, softDelete | Safe selected output and metadata receipt in one transaction | Command metadata; current user/role authority checked by UserService. No credential fields in results. |
| User createAuthUser, updatePassword, markEmailVerified | State plus metadata event | Internal auth operations. Registration selects only USER and fails when it is absent. |
| User resetPasswordAndRevokeSessions, verifyEmailAndClearTokens | User state, token cleanup/session revocation and event in one transaction | AuthService validates token flow; no raw token/password in evidence. |
| `role.model.ts`: create, update, softDelete | State plus command receipt | Current role-management authority; unknown permissions rejected. |
| Role replacePermissions | Entire permission matrix plus one receipt in one transaction | One operation identity for the submitted matrix; no partial role updates. |
| `page.model.ts`, `route.model.ts`: create/update | Scalar state and role joins plus one receipt in one transaction | Roles are nested database writes, not a later service call. Existing hardcoded-page/APP-route restrictions retained. |
| Page/Route softDelete, standalone setAllowedRoles | State/join replacement plus metadata evidence | CRUD commands accept metadata; standalone join replacement is atomic and internal. |
| `navigationItem.model.ts`, `tag.model.ts`: CRUD | State plus command receipt | Existing resource permission boundary retained. |
| `project.model.ts`: createWithReceipt | Existing atomic project-create receipt and duplicate-race recovery | Stable public/generic admin create identity preserved. Owner or explicit admin create authority. |
| Project create / update / softDelete | State plus metadata event/receipt | Direct create is internal; update/delete constrain active owner as authorized by the service. |
| `task.model.ts`: create/update/softDelete | State plus command receipt | Lock and recheck active parent and authorized owner; nested URL parent checked independently. |
| Task addTag/removeTag | Join mutation plus command receipt | Recheck active task/parent and tag as applicable; attach is an upsert; remove replay retains the committed count. |
| `organization.model.ts`: createWithOwner | Organization, initial owner and receipt in one transaction | Current organization:create authority; retry does not create another organization. |
| Organization updateAuthorized/deleteAuthorized | Organization state plus command receipt | Current membership/explicit platform override; row lock and query constraints rechecked in transaction. |
| Organization addMemberAuthorized/changeMemberAuthorized | Membership/role/removal plus command receipt | Shared organization lock; owner invariant and target role constraints; soft-deleted members can be deliberately re-added. |
| `orgMember.model.ts`: primitive add/changeRole/remove | Primitive write plus metadata event | Query wrappers for trusted internal callers. Web management exclusively uses OrganizationService's aggregate commands above. |
| `session.model.ts`: create/deleteByToken/deleteByUserId | Session mutation plus metadata event | Authentication/logout internals; tokens remain internal and session list/detail projections exclude them. |
| Session deleteById | Hard deletion plus receipt | SessionService requires session:revoke; a successful receipt can replay after the session row is gone. |
| `setting.model.ts`: set/setMany | Setting or entire group plus receipt | Registry and admin:settings policy validated by service. Cache reloads from committed DB state even on replay. Values never enter general audit. |
| `asset.model.ts`: create/softDelete | Public metadata publication/deletion plus event | File bytes remain an external effect. Upload cleans bytes if metadata fails; deletion failure does not silently soft-delete metadata. |
| `appSync.model.ts`: page/route upserts, route soft deletion | Startup inventory write plus event | System actor; repeated inventory syncs remain upserts. |
| `passwordResetToken.model.ts`, `emailVerificationToken.model.ts`: create/delete | Token-state write plus metadata event | Auth-only internal operations; no token/hash in event payload. |
| `workflowDefinition.model.ts`: code facts, metadata, softDelete, requirement sync, role policy | Each catalog command and its evidence commit together | Code facts/requirements use system actor; web metadata/role policy forwards initiating actor. |
| `workflowExecution.model.ts`: create/update/updateStatus/softDelete | Projection mutation plus event | Existing workflow/org authorization and client gateway unchanged. |
| WorkflowExecution reserveStart/createOrFind | Existing immutable encrypted intent ledger; exact-run projection, STARTED state and creation evidence commit together | Existing start/recovery identity and replay contracts retained. Updating an already proven intent to STARTED is reconciliation of existing evidence. |
| `workflowHumanTask.model.ts`: createWithRoles/createReceipt | Task plus role joins, or action receipt plus logical delivery-slot reservation, and metadata event | Existing assignment, task/token policy and Update identities retained. |
| Human task update/token creation/consumption/finalization/cancelOpenWorkflowTasks | State change plus event | Internal task-delivery transitions; no raw token/payload in evidence. |
| Human task rejectDelivery/commitDelivery | Existing transactional rejection or accepted Update result, task/token state and evidence | Existing durable workflow action receipt is authority; transport acknowledgement is not business completion. |
| `workflowSchedule.model.ts`: create/update/markDeleted | Projection mutation plus event | Current schedule admin policy; web delete forwards actor. Temporal remains timer/action authority. |
| `integrationConnection.model.ts`: create/update/softDelete/updateTestResult | Connection/CAS write plus event | Current org/integration policy; CAS preserves credential fingerprint fencing and forwards test actor. Secret material stays outside evidence. |
| `workflowIntegrationBinding.model.ts`: upsert/update/softDelete | Binding write plus event | Existing organization/requirement/connection policy retained. |
| `activityIdempotency.model.ts`: createRunning/claim/complete/fail | Generation-fenced state change and event | System Activity actor; zero-row attempts record NOT_APPLIED, not a successful effect. Existing uncertainty/reconciliation policy retained. |
| `privateAsset.model.ts`: createPending/transition | Existing atomic metadata/state audit contract | Mandatory domain policy, scoped operation identity and private backend unchanged. |
| `auditLog.model.ts`: create | Operational event itself | Deliberate terminal writer: it must not recursively audit itself. AuditService remains best-effort telemetry. |

## External effects and explicitly different guarantees

- Public object storage writes/deletes, SMTP/BullMQ delivery, provider RPCs and Temporal calls cannot join a PostgreSQL transaction. Do not infer exactly-once provider delivery from these metadata events. Retain Activity receipts, provider idempotency/reconciliation, deterministic Schedule identities and start/action intents where those contracts already exist.
- Public media uploads create a new object per accepted submission. They do not adopt the private-file reservation protocol or claim cross-request upload replay. A process crash between object write and metadata publication can leave an orphan; inventory the dedicated public store during recovery. Cleanup failures emit `UPLOAD_ORPHAN`. A physical deletion failure propagates and leaves metadata available for a retry. DB evidence failure after physical deletion rolls metadata back; repeated physical deletion is idempotent. This is explicitly weaker than a distributed transaction.
- Account signup and reset-email issuance still have multiple staged operations and external email delivery. Each database write has evidence; the whole email workflow is not one SQL transaction. Password replacement/token cleanup/session invalidation itself is atomic.
- Startup/development seed and owned-fixture provisioning are tooling, not web commands. Never run the sample seed as a deployed permission migration or credential repair. System synchronization events legitimately have no human actor.
- Existing best-effort service events remain operational telemetry and may duplicate descriptions of the same business action. Treat the model's committed event/receipt or existing workflow/private ledger as authoritative. No service should rely on a later `AuditService.record` to prove its write.

## Verification ownership

`tests/integration/audit-remediation.test.ts` proves SQL authorization negatives, safe projections, concurrent project/task/tag replay, changed-input conflict, revoked replay access, owner races, and injected evidence-failure rollback for project/role matrix/page+roles/org+owner/session/settings. Existing `command-atomicity`, private-assets, workflow-integrations and workflow-recovery suites retain their specialized contracts. `tests/security/audit-remediation.test.ts`, `admin-authorization.test.ts`, `tests/services/public-storage.test.ts` and the expanded owned Chromium suite cover HTTP/policy/storage boundaries.

The owned runtime reports are local evidence. Deployment-specific history/key inventory, external provider guarantees, real S3/CDN response headers, legacy public-object review, HA/restore objectives and monitoring ownership remain separate acceptance work.
