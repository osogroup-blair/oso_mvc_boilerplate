// Live Temporal proof for integrations hardening Phase 3 (INT-09/10): the
// data-sync workflow on a real built Worker delivers its optional billing
// webhook through webhook.outbound to a local signed receiver. Injected faults
// show exactly-once processing (Temporal retries + Idempotency-Key dedupe),
// optional-requirement skipping, and terminal rejection without retries.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Client, Connection } from "@temporalio/client";
import { PrismaClient } from "@prisma/client";
import { temporalClientGateway } from "../../dist/lib/temporalClient.js";
import { temporalDataConverter } from "../../dist/lib/temporalPayload.js";
import { credentialEncryptionService } from "../../dist/services/credential-encryption.service.js";
import { INTEGRATION_FAILURE_TYPES } from "../../dist/temporal/contracts.js";
import { startMockWebhookServer } from "../fixtures/mock-webhook-server.mjs";

const manifest = JSON.parse(await readFile(process.env.PLATFORM_TEST_MANIFEST, "utf8"));
const root = resolve(manifest.artifactDirectory);
const prisma = new PrismaClient();
assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM platform_test.ownership`, [{ run_id: manifest.runId }]);
const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS });
const client = new Client({ connection, namespace: manifest.temporal.namespace, dataConverter: temporalDataConverter });
const wait = async (check, label, timeout = 30000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await check()) return; await delay(100); }
  throw Error(`Deadline: ${label}`);
};
const SIGNING_SECRET = `owned-webhook-secret-${randomUUID()}`;
const SYNTHETIC_TOKEN = `owned-synthetic-token-${randomUUID()}`;
const mock = await startMockWebhookServer({ signingSecret: SIGNING_SECRET });
const logs = [];
const checks = [];
let worker;

try {
  // The Worker (not this process) makes the HTTP calls, so only it needs private egress for the loopback receiver.
  worker = spawn(process.execPath, ["dist/temporal/worker.js"], { env: { ...process.env, INTEGRATION_ALLOW_PRIVATE_EGRESS: "true" }, stdio: ["ignore", "pipe", "pipe"] });
  worker.exited = false;
  worker.once("exit", (code) => { worker.exited = true; worker.code = code; });
  for (const stream of [worker.stdout, worker.stderr]) stream.on("data", (chunk) => logs.push(chunk.toString()));
  await wait(async () => {
    try { return (await temporalClientGateway.applicationCanary(2000)).result.status === "ok"; } catch { return false; }
  }, "built Worker application canary");

  const role = await prisma.role.create({ data: { name: `webhook-delivery-${randomUUID()}`, permissions: [] } });
  const user = await prisma.user.create({ data: { name: "Synthetic webhook operator", email: `${randomUUID()}@example.invalid`, passwordHash: "not-login", roleId: role.id } });
  const org = await prisma.organization.create({ data: { name: "Synthetic webhook delivery", slug: randomUUID() } });
  const definition = await prisma.workflowDefinition.upsert({
    where: { key: "showcase.dataSynchronization" },
    update: { isEnabled: true, defaultTaskQueue: manifest.temporal.taskQueue, deletedAt: null },
    create: { key: "showcase.dataSynchronization", slug: "showcase-data-synchronization", name: "Data Synchronization", workflowType: "dataSynchronizationWorkflow", defaultTaskQueue: manifest.temporal.taskQueue, contractVersion: 1, isEnabled: true },
  });
  for (const requirement of [
    { key: "syntheticEcho", providerKey: "synthetic.echo", capabilityKey: "echo", label: "Synthetic Data Sync Connection", isRequired: true },
    { key: "billingWebhook", providerKey: "webhook.outbound", capabilityKey: "deliver", label: "Billing Webhook", isRequired: false },
  ]) {
    await prisma.workflowIntegrationRequirement.upsert({
      where: { workflowDefinitionId_key: { workflowDefinitionId: definition.id, key: requirement.key } },
      update: { ...requirement, deletedAt: null },
      create: { workflowDefinitionId: definition.id, ...requirement },
    });
  }
  const synthetic = await prisma.integrationConnection.create({
    data: { orgId: org.id, name: "Owned synthetic", providerKey: "synthetic.echo", status: "ACTIVE", config: { endpointLabel: "Owned" }, ...credentialEncryptionService.encrypt({ apiToken: SYNTHETIC_TOKEN }) },
  });
  const webhook = await prisma.integrationConnection.create({
    data: { orgId: org.id, name: "Owned billing webhook", providerKey: "webhook.outbound", status: "ACTIVE", config: { baseUrl: mock.url, path: "/webhooks/billing", extraHeaders: {} }, ...credentialEncryptionService.encrypt({ signingSecret: SIGNING_SECRET }) },
  });
  await prisma.workflowIntegrationBinding.create({ data: { orgId: org.id, workflowDefinitionId: definition.id, requirementKey: "syntheticEcho", connectionId: synthetic.id, isEnabled: true } });
  const webhookBinding = await prisma.workflowIntegrationBinding.create({ data: { orgId: org.id, workflowDefinitionId: definition.id, requirementKey: "billingWebhook", connectionId: webhook.id, isEnabled: true } });

  async function runSync(label) {
    const workflowId = `${manifest.temporal.namespace}-webhook-${label}-${randomUUID()}`;
    // Idempotency-Key carries the hashed operation key, so attribute receiver requests by arrival window.
    const firstRequest = mock.requests.length;
    const eventId = `evt-${randomUUID()}`;
    const handle = await client.workflow.start("dataSynchronizationWorkflow", {
      workflowId,
      taskQueue: manifest.temporal.taskQueue,
      args: [
        { sourceRecordId: `rec-${label}`, eventId, sourceSystem: "crm", changedFields: ["status"], targetSystems: ["billing"], validationScenario: "all_match" },
        { orgId: org.id, startedById: user.id, workflowDefinitionKey: "showcase.dataSynchronization" },
      ],
    });
    const outcome = await handle.result().then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
    const history = await handle.fetchHistory();
    const historyText = JSON.stringify(history.events, (_key, value) => (typeof value === "bigint" ? String(value) : value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : value));
    assert(!historyText.includes(SIGNING_SECRET) && !historyText.includes(SYNTHETIC_TOKEN), `${label}: credentials absent from Workflow history`);
    const idempotencyKey = `${workflowId}:billingWebhook:${eventId}`;
    const runRequests = mock.requests.slice(firstRequest);
    assert(new Set(runRequests.map((request) => request.idempotencyKey)).size <= 1, `${label}: every send reused one Idempotency-Key`);
    const deliveryRequests = () => runRequests;
    const reservations = await prisma.activityIdempotency.findMany({ where: { orgId: org.id, scope: "integration.webhook.deliver", idempotencyKey } });
    const webhookActivity = history.events.filter((event) => event.activityTaskScheduledEventAttributes?.activityType?.name === "deliverIntegrationWebhook");
    const scheduledIds = new Set(webhookActivity.map((event) => String(event.eventId)));
    const started = history.events.filter((event) => event.activityTaskStartedEventAttributes && scheduledIds.has(String(event.activityTaskStartedEventAttributes.scheduledEventId)));
    return { outcome, deliveryRequests, reservations, started, history };
  }
  const processedFor = (requests) => requests.filter((request) => request.outcome.startsWith("processed")).length;

  mock.injectFaults("503");
  const retried503 = await runSync("retry-503");
  assert.equal(retried503.outcome.ok, true, "503 case completes");
  assert.equal(retried503.outcome.value.targets.billing.webhook.status, "delivered");
  assert.deepEqual(retried503.deliveryRequests().map((request) => request.outcome), ["503", "processed"], "one 503 then one processed delivery");
  assert.equal(processedFor(retried503.deliveryRequests()), 1, "exactly one delivery processed");
  assert.equal(Number(retried503.started[0].activityTaskStartedEventAttributes.attempt), 2, "Temporal retried the Activity once");
  assert.equal(retried503.reservations.length, 1);
  assert.equal(retried503.reservations[0].status, "SUCCEEDED");
  assert(!JSON.stringify(retried503.reservations[0].response).includes(SIGNING_SECRET));
  checks.push("injected 503: Temporal retried the Activity once and the receiver processed exactly one signed delivery");

  mock.injectFaults("500-after-processing");
  const ambiguous = await runSync("processed-then-500");
  assert.equal(ambiguous.outcome.ok, true, "ambiguous case completes");
  assert.deepEqual(ambiguous.deliveryRequests().map((request) => request.outcome), ["processed-then-500", "duplicate"], "retry reused the Idempotency-Key");
  assert.equal(processedFor(ambiguous.deliveryRequests()), 1, "receiver processed the event once despite two sends");
  assert.equal(ambiguous.outcome.value.targets.billing.webhook.duplicate, true, "workflow state records the receiver-side duplicate");
  checks.push("receiver processed then failed (500): retry carried the same Idempotency-Key, receiver deduplicated, exactly one processed delivery");

  await prisma.workflowIntegrationBinding.update({ where: { id: webhookBinding.id }, data: { isEnabled: false } });
  const before = mock.requests.length;
  const skipped = await runSync("binding-disabled");
  assert.equal(skipped.outcome.ok, true, "optional requirement does not fail the workflow");
  assert.deepEqual(skipped.outcome.value.targets.billing.webhook, { status: "skipped", reason: INTEGRATION_FAILURE_TYPES.DISABLED });
  assert.equal(mock.requests.length, before, "no request sent while the binding is disabled");
  assert.equal(skipped.reservations.length, 0);
  checks.push("optional billingWebhook disabled: workflow completes with webhook skipped (INTEGRATION_DISABLED), no request, no reservation");

  await prisma.workflowIntegrationBinding.update({ where: { id: webhookBinding.id }, data: { isEnabled: true } });
  await prisma.integrationConnection.update({ where: { id: webhook.id }, data: credentialEncryptionService.encrypt({ signingSecret: `wrong-${SIGNING_SECRET}` }) });
  const rejected = await runSync("rejected-401");
  // dataSynchronizationWorkflow reports failures in its returned state (status "failed") rather than throwing.
  assert.equal(rejected.outcome.ok, true);
  assert.equal(rejected.outcome.value.status, "failed", "terminal rejection fails the data sync");
  assert.equal(rejected.outcome.value.targets.billing.webhook, undefined);
  assert(!String(rejected.outcome.value.lastError).includes(SIGNING_SECRET));
  const failed = rejected.history.events.find((event) => event.activityTaskFailedEventAttributes);
  const failure = failed?.activityTaskFailedEventAttributes?.failure;
  assert.equal(failure?.applicationFailureInfo?.type, INTEGRATION_FAILURE_TYPES.PROVIDER_REJECTED);
  assert.equal(failure?.applicationFailureInfo?.nonRetryable, true);
  assert(String(failure?.message).includes("HTTP 401") && !String(failure?.message).includes(SIGNING_SECRET));
  assert.equal(Number(rejected.started[0].activityTaskStartedEventAttributes.attempt), 1, "no retries after a 401");
  assert.deepEqual(rejected.deliveryRequests().map((request) => request.outcome), ["unauthorized"]);
  checks.push("bad signing secret (401): non-retryable INTEGRATION_PROVIDER_REJECTED on attempt 1, one request, no secret in failure");

  await writeFile(resolve(root, "webhook-delivery-results.json"), JSON.stringify({ result: "PASS", checks, requests: mock.requests.map(({ idempotencyKey, outcome, test }) => ({ idempotencyKey, outcome, test })) }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "PASS", checks }));
} finally {
  if (worker && !worker.exited) {
    worker.kill("SIGTERM");
    await wait(async () => worker.exited, "cleanup Worker").catch(() => worker.kill("SIGKILL"));
  }
  await writeFile(resolve(root, "webhook-delivery-worker.log"), logs.join("").replaceAll(SIGNING_SECRET, "[REDACTED]").replaceAll(SYNTHETIC_TOKEN, "[REDACTED]"));
  await mock.close();
  await temporalClientGateway.close();
  await connection.close();
  await prisma.$disconnect();
}
