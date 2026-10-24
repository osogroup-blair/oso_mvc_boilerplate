// Live Temporal proof for integrations hardening Phase 1 (INT-04): a real built
// Worker fails configuration problems fast and non-retryably, reserves no
// idempotency row for them, and keeps credentials out of Workflow history.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { ActivityFailure, ApplicationFailure, Client, Connection, WorkflowFailedError } from "@temporalio/client";
import { PrismaClient } from "@prisma/client";
import { temporalClientGateway } from "../../dist/lib/temporalClient.js";
import { temporalDataConverter } from "../../dist/lib/temporalPayload.js";
import { credentialEncryptionService } from "../../dist/services/credential-encryption.service.js";
import { INTEGRATION_FAILURE_TYPES } from "../../dist/temporal/contracts.js";

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
const SECRET = `owned-temporal-secret-${randomUUID()}`;
const logs = [];
const checks = [];
let worker;

try {
  worker = spawn(process.execPath, ["dist/temporal/worker.js"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  worker.exited = false;
  worker.once("exit", (code) => { worker.exited = true; worker.code = code; });
  for (const stream of [worker.stdout, worker.stderr]) stream.on("data", (chunk) => logs.push(chunk.toString()));
  await wait(async () => {
    try { return (await temporalClientGateway.applicationCanary(2000)).result.status === "ok"; } catch { return false; }
  }, "built Worker application canary");

  const role = await prisma.role.create({ data: { name: `integration-failures-${randomUUID()}`, permissions: [] } });
  const user = await prisma.user.create({ data: { name: "Synthetic integration operator", email: `${randomUUID()}@example.invalid`, passwordHash: "not-login", roleId: role.id } });
  const org = await prisma.organization.create({ data: { name: "Synthetic integration failures", slug: randomUUID() } });
  const definition = await prisma.workflowDefinition.upsert({
    where: { key: "platform.test" },
    update: { isEnabled: true, defaultTaskQueue: manifest.temporal.taskQueue, deletedAt: null },
    create: { key: "platform.test", slug: "platform-test", name: "Platform Test Workflow", workflowType: "platformTestWorkflow", defaultTaskQueue: manifest.temporal.taskQueue, contractVersion: 1, isEnabled: true },
  });
  await prisma.workflowIntegrationRequirement.upsert({
    where: { workflowDefinitionId_key: { workflowDefinitionId: definition.id, key: "syntheticEcho" } },
    update: { providerKey: "synthetic.echo", capabilityKey: "echo", deletedAt: null, isRequired: true },
    create: { workflowDefinitionId: definition.id, key: "syntheticEcho", providerKey: "synthetic.echo", capabilityKey: "echo", label: "Synthetic Echo" },
  });
  const integrationConnection = await prisma.integrationConnection.create({
    data: { orgId: org.id, name: "Owned synthetic", providerKey: "synthetic.echo", status: "ACTIVE", config: { endpointLabel: "Owned endpoint" }, ...credentialEncryptionService.encrypt({ apiToken: SECRET }) },
  });
  const binding = await prisma.workflowIntegrationBinding.create({
    data: { orgId: org.id, workflowDefinitionId: definition.id, requirementKey: "syntheticEcho", connectionId: integrationConnection.id, isEnabled: true },
  });

  async function runCase(label, mutate) {
    await mutate();
    const workflowId = `${manifest.temporal.namespace}-integration-${label}-${randomUUID()}`;
    const handle = await client.workflow.start("platformTestWorkflow", {
      workflowId,
      taskQueue: manifest.temporal.taskQueue,
      args: [{ message: "Owned integration failure check", durationSeconds: 1 }, { orgId: org.id, startedById: user.id, workflowDefinitionKey: "platform.test" }],
    });
    const outcome = await handle.result().then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));
    const history = await handle.fetchHistory();
    const scheduled = history.events.filter((event) => event.activityTaskScheduledEventAttributes?.activityType?.name === "runSyntheticIntegration");
    const scheduledIds = new Set(scheduled.map((event) => String(event.eventId)));
    const started = history.events.filter((event) => event.activityTaskStartedEventAttributes && scheduledIds.has(String(event.activityTaskStartedEventAttributes.scheduledEventId)));
    const reservations = await prisma.activityIdempotency.findMany({ where: { orgId: org.id, idempotencyKey: `${workflowId}:syntheticEcho` } });
    const historyText = JSON.stringify(history.events, (_key, value) => (typeof value === "bigint" ? String(value) : value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : value));
    assert(!historyText.includes(SECRET), `${label}: credential absent from Workflow history`);
    return { workflowId, outcome, scheduled, started, reservations };
  }

  function assertConfigurationFailure(label, result, expectedType) {
    assert.equal(result.outcome.ok, false, `${label}: workflow fails`);
    assert(result.outcome.error instanceof WorkflowFailedError, `${label}: WorkflowFailedError`);
    const activityFailure = result.outcome.error.cause;
    assert(activityFailure instanceof ActivityFailure, `${label}: ActivityFailure cause`);
    const applicationFailure = activityFailure.cause;
    assert(applicationFailure instanceof ApplicationFailure, `${label}: ApplicationFailure cause`);
    assert.equal(applicationFailure.type, expectedType, `${label}: failure type`);
    assert.equal(applicationFailure.nonRetryable, true, `${label}: non-retryable`);
    assert.equal(result.scheduled.length, 1, `${label}: one integration Activity scheduled`);
    assert.equal(result.started.length, 1, `${label}: one started event`);
    assert.equal(Number(result.started[0].activityTaskStartedEventAttributes.attempt), 1, `${label}: failed on first attempt (no retries)`);
    assert.equal(result.reservations.length, 0, `${label}: no ActivityIdempotency reservation`);
  }

  const disabledBinding = await runCase("binding-disabled", () =>
    prisma.workflowIntegrationBinding.update({ where: { id: binding.id }, data: { isEnabled: false } }));
  assertConfigurationFailure("binding disabled", disabledBinding, INTEGRATION_FAILURE_TYPES.DISABLED);
  checks.push("disabled binding: non-retryable INTEGRATION_DISABLED on attempt 1, no idempotency reservation, no secret in history");

  const staleActive = await runCase("connection-disabled-at", () => prisma.$transaction([
    prisma.workflowIntegrationBinding.update({ where: { id: binding.id }, data: { isEnabled: true } }),
    prisma.integrationConnection.update({ where: { id: integrationConnection.id }, data: { disabledAt: new Date() } }),
  ]));
  assertConfigurationFailure("connection disabledAt with ACTIVE status", staleActive, INTEGRATION_FAILURE_TYPES.CONNECTION_UNAVAILABLE);
  checks.push("connection disabledAt with stale ACTIVE status: non-retryable INTEGRATION_CONNECTION_UNAVAILABLE on attempt 1, no reservation");

  const healthy = await runCase("healthy", () =>
    prisma.integrationConnection.update({ where: { id: integrationConnection.id }, data: { disabledAt: null } }));
  assert.equal(healthy.outcome.ok, true, "healthy binding completes");
  assert.equal(healthy.outcome.value.phase, "completed");
  assert.equal(healthy.outcome.value.integration.connectionId, integrationConnection.id);
  assert.equal(healthy.reservations.length, 1, "healthy run reserves exactly one idempotency row");
  assert.equal(healthy.reservations[0].status, "SUCCEEDED");
  assert(!JSON.stringify(healthy.reservations[0].response).includes(SECRET), "stored Activity response has no credential");
  checks.push("healthy binding: completes through runIntegrationOperation with one SUCCEEDED reservation and no secret in history or response");

  await writeFile(resolve(root, "integration-failures-results.json"), JSON.stringify({ result: "PASS", checks }, null, 2) + "\n");
  console.log(JSON.stringify({ result: "PASS", checks }));
} finally {
  if (worker && !worker.exited) {
    worker.kill("SIGTERM");
    await wait(async () => worker.exited, "cleanup Worker").catch(() => worker.kill("SIGKILL"));
  }
  await writeFile(resolve(root, "integration-failures-worker.log"), logs.join("").replaceAll(SECRET, "[REDACTED]"));
  await temporalClientGateway.close();
  await connection.close();
  await prisma.$disconnect();
}
