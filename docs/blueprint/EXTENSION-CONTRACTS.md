# Implemented extension contracts

## Safe tests and architecture

`npm test` uses a fail-closed Prisma mock and an unreachable synthetic URL. A missing service/model mock throws before database I/O. Integration and Temporal-environment suites are excluded. Do not remove this guard to make a test pass.

`npm run check:architecture` inspects literal imports/re-exports, dynamic imports, require calls and direct environment access. It checks the MVC direction, Activity/service seam, deterministic Workflow imports and model-owned Prisma access. Lifecycle owners may import only `closeDatabase`. This static check is not a complete transitive dependency or alias analysis.

`npm run test:platform:owned -- --image=<locally-provisioned-image-or-digest>` creates a unique, labelled PostgreSQL container, uses a per-run database and ownership sentinel, deploys migrations, executes integration tests and removes only its owned container. It never sources an application's database URL. Results are under `artifacts/platform-<uuid>/` without database passwords. The default image must already exist locally; provision images explicitly.

Build first, then add `--temporal` to test the actual built Worker against a new owned Docker network, PostgreSQL container and Temporal 1.25.2 container. That image must also exist locally. This test creates a new namespace/task queue, blocks an actual projection Activity on a SQL lock, sends SIGTERM, releases the lock, checks clean drain and restarts the Worker to finish retained work. The extended acceptance runner also tests bounded forced exit/restart, local baseline replay, transport and restore; none proves actual host HA or production compatibility.

For manually provisioned integration fixtures, `PLATFORM_TEST_MANIFEST` and `PLATFORM_TEST_DATABASE_URL` are mandatory. `tests/fixtures/temporal-runtime.json.example` defines the identity contract. Setup first validates the endpoint/name, then reads `platform_test.ownership` and requires exactly the current run ID before mutation. A manifest alone is not ownership proof.

Legacy browser/upload acceptance scripts now reject missing ownership rather than falling back to localhost:3000 or an existing Chrome tab. They require an explicit app URL, a test app PID whose Linux process environment matches the run/database/port, and the DB sentinel. Browser runs additionally require an owned browser PID and an isolated profile under the run artifact directory. Those process fields are optional in DB-only manifests, mandatory for acceptance. The `--browser` runner supplies owned app/Chromium/Redis processes and tests two tenant fixtures plus legacy browser/upload flows; do not point these scripts at a user's browser profile.

## Browser mutations

All ordinary browser mutation forms include `_csrf`. URL-encoded forms carry the body token; multipart upload is memory-bounded and parsed before verification; JavaScript may send `X-CSRF-Token`. Bull Board receives a readable XSRF-TOKEN cookie restricted to `/admin/jobs`; its Axios client sends X-XSRF-TOKEN. The signed, HTTP-only csrf cookie remains the authority. Suffixes and forged tokens fail. Cookie-less Bearer requests may skip CSRF but still require route authentication and authorization. Requests with a session cookie cannot use that exemption.

The explicit execution refresh endpoint is now POST. Existing GET clients must switch to POST with CSRF. Page discovery does not make static Express handlers dynamically enforce database policy; declare and test an enforcement adapter. `STATIC_PAGE_POLICIES` lists current enforced slugs. Generic admin now enforces record read-only policy on updates and deletes, beyond disabling form fields.

## Audit and atomic commands

`AuditService.record` and `AuditLogModel.create` enforce `safeAuditEntry`. Store identifiers, status, numeric counters/versions and explicitly approved hashes; never raw canonical JSON, document text, instructions, prompts, tokens, credentials or arbitrary error payloads. Failure logs contain stable codes. HTTP logs omit headers, cookies, URL/query/token values; unexpected errors and database driver messages are minimized to safe classifications. This is a safer platform default, not proof that every SDK/provider independently obeys the same log policy.

`ProjectService.create(data, actorId, operationId)` delegates to a model-owned transaction that creates a project and an authoritative metadata receipt. Use the same UUID when retrying the same command. A changed payload under that identity conflicts; receipt failure rolls the project back; concurrent duplicates converge to one result. The public project form supplies that UUID. Callers that omit it receive a new identity and therefore do not get cross-request replay protection. Update/delete and other resources have not all been converted to atomic commands.

## Private assets

Create a resource adapter; there is deliberately no permissive default policy:

```ts
import { PrivateAssetService } from "../../services/private-asset.service.js";
import type { PrivateAssetPolicy } from "../../lib/private-asset-contracts.js";

const policy: PrivateAssetPolicy = {
  maxBytes: 1024 * 1024,
  allowedMimeTypes: ["application/pdf"],
  authorize: (scope, action) => domainService.canAccessAttachment(scope, action),
};
const assets = new PrivateAssetService(policy);
const file = await assets.upload(
  { orgId, actorId, resourceType: "Evidence", resourceId },
  { filename, mimeType, buffer }, operationId,
);
```

The example requires the consuming domain service to supply real current membership/resource/assignment checks. A claimed org ID from a form is not authorization. Use the same scoped policy for `read`, `recoverUpload` and `remove`. Download controllers must authenticate and apply the domain policy, set private/no-store caching and a safe attachment Content-Disposition, and return only the authorized bytes; no generic private download route ships in this tranche.

The local backend accepts generated UUID object keys, uses exclusive writes and no-follow file opens, rejects public/symlink roots, pins a store identity and verifies size/hash before reads/publication. The default root is `var/private-assets`, outside public. `PRIVATE_ASSET_ROOT` and `PRIVATE_ASSET_STORE_ID` are infrastructure configuration. Back up the private volume with its database metadata. MIME labels are resource allowlist declarations, not malware scanning or file signature validation.

## Integration connections

Use `IntegrationConnectionResolverService.resolve(connectionId, {orgId, providerKey?, capabilityKey?})` for direct resource/provider selection. Workflow binding lookup stays in `IntegrationResolverService`, which delegates adapter construction to the same primitive. Wrong-org, deleted, disabled, wrong-provider and missing-capability records are rejected before decryption. Safe connection metadata excludes credentials. Returned adapters/credentials must never enter Workflow inputs/history, views or general audit.

## Neutral tenant admin

`AdminSchema.adapter` is optional. Existing eight unscoped resources keep their existing interface. A tenant adapter supplies `resolveContext`, `bind`, `parse` and `options`; optional defaults, version extraction and safe form values support richer resources. Resolve current access before any list, record or option read. Binding must call domain services with that verified context and preserve model-owned transaction/receipt/version behavior.

The controller transports operation ID, selected organization and expected version without resource-specific field names. A versioned update/delete without expected version fails. A JSON transport offers a no-JavaScript textarea for nested structures, retaining absent/false/null distinctions. It is bounded to 64 KiB, eight nested levels, 100 rows per array and 256 object keys; prototype keys are rejected. Domain parsing must still use a strict resource schema. Use `formValues` to choose safe editable data; never serialize an entire secret-bearing record into JSON.

Two isolated fixture resources exercise different tenant roles, scoped options, retry/version delegation and legacy compatibility in `tests/admin/resource-contract.test.ts`. They are component fixtures, not production resources or proof of SQL CAS correctness for arbitrary consumer adapters. Accessible validation re-rendering preserves operation/version/payload; real SQL CAS, replay and Chromium acceptance now pass for both fixtures. Keep canonical editors, protected pointers and domain workspaces specialized where their semantics exceed ordinary CRUD.

## Temporal release and transport

`npm run build` then `npm run temporal:bundle -- /absolute/release/workflows.js` produces exact bundle bytes and a sidecar with bundle/lockfile SHA-256 and all exported Workflow types, including children. `npm run temporal:replay -- --bundle=... --bundle-sha256=... --manifest=...` requires a reviewed corpus with supported releases, required branch cases, per-history SHA-256, synthetic/reviewed markers and matching Workflow start types. Empty, incomplete, escaped or tampered fixtures fail before native replay. Current Workflow export inventory is 16 types: the original 15 and one new application canary.

Configure both `TEMPORAL_WORKFLOW_BUNDLE_PATH` and `TEMPORAL_WORKFLOW_BUNDLE_SHA256` to make a Worker load verified release bytes. Without them, local development still bundles the compiled Workflow entry point. Bundle creation and loader tests do not establish historical replay. The checked-in manifest is intentionally empty because supported prior release artifacts were not supplied.

Web client and Worker use `temporalConnectionOptions`: TLS, optional CA, mTLS certificate/key pair, server name and API key. Paths/key pairs are validated; unreadable/malformed/mismatched material produces a safe error with no secret-bearing cause. Production requires TLS; local development/test may use plaintext. Local real-RPC transport and versioned payload/key rotation tests pass; actual deployment transport/rotation acceptance remains required. See `LOCAL-OPERATIONS.md`.


## Recoverable workflow extensions

Starts require a stable operation UUID (or validated business key). The service reserves an encrypted immutable intent before calling Temporal and atomically publishes the exact run projection, creation audit and STARTED intent. Retry must retain actor, input and identity; current membership/START permissions still apply. Recovery is exposed as an authorized operations action for the current actor's intents.

Activity effects use `ActivityIdempotencyService.run` with a stable org/scope/operation key and input hash. Generation-fenced completion prevents a stale attempt from committing over its successor. External effects are unsafe to retry by default: supply a provider reconciliation callback, a trustworthy provider receipt and/or an explicit retry-safe policy. Result-commit loss retains RUNNING; transport ambiguity retains UNCERTAIN. A generic catch/retry must not repeat a payment, email or external mutation.

Human delivery reserves one logical slot and uses a stable receipt/Update identity. Transport uncertainty retains RECEIVED; retry retrieves the existing Update result. Receipt completion, token consumption and metadata evidence commit together. Successful delivery records QUEUED while the Workflow's close Activity owns business completion. Legacy Signal delivery claims only delivery, not state-machine acceptance. Live token expiry/revocation is enforced even on successful receipt replay.

Register additional current resource checks with `WorkflowTaskPolicies.register(taskType, policy)`. Policies run for read and submit after base tenant/permission/assignment checks; they add restrictions and cannot bypass those checks. Two separate resource task policies, private-file policies and tenant-admin adapters are exercised against owned SQL fixtures.

Workflow implementations are separate modules re-exported under stable names. Keep all Workflow imports deterministic. `platform-runtime-v2` gates additional outcome/cancellation commands for retained old histories. Preserve old Signal names and patch handling until supported history retention permits removal. Business outcome is independent of engine status; unclassified results remain UNKNOWN.
