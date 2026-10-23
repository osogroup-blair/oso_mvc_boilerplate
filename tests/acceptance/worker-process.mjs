// Invoked only by the owned fixture runner after build and migrations.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { Connection, Client } from "@temporalio/client";

const manifest = JSON.parse(await readFile(process.env.PLATFORM_TEST_MANIFEST, "utf8"));
const url = new URL(process.env.PLATFORM_TEST_DATABASE_URL);
assert.equal(manifest.owner, "mvc-boilerplate-platform-tests");
assert.equal(manifest.database.name, `bp_platform_${manifest.runId.replaceAll("-", "")}`);
assert.equal(url.pathname, `/${manifest.database.name}`);
assert.equal(url.hostname, manifest.database.host); assert.equal(Number(url.port), manifest.database.port);
assert.equal(manifest.temporal.namespace, `bp-platform-${manifest.runId}`);
assert.equal(manifest.temporal.taskQueue, `bp-platform-${manifest.runId}`);
assert.equal(manifest.artifactDirectory.endsWith(`/platform-${manifest.runId}`), true);
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const sentinel = await prisma.$queryRaw`SELECT run_id FROM platform_test.ownership`;
assert.deepEqual(sentinel, [{ run_id: manifest.runId }]);
const deadline = async (check, label, timeout = 45000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(150); }
  throw Error(`Deadline exceeded: ${label}`);
};
let connection;
let child;
let release;
let lock;
const logs = [];
const children = new Set();
const startWorker = () => {
  const process = spawn(globalThis.process.execPath, ["dist/temporal/worker.js"], { env: { ...globalThis.process.env,
    DATABASE_URL: url.toString(), TEMPORAL_SHUTDOWN_GRACE_MS: "5000", TEMPORAL_SHUTDOWN_FORCE_MS: "10000" }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(process);
  process.exited = false;
  process.exitResult = new Promise(resolve => process.once("exit", (code, signal) => { process.exited = true; resolve({ code, signal }); }));
  for (const stream of [process.stdout, process.stderr]) stream.on("data", bytes => logs.push(bytes.toString()));
  return process;
};
try {
  await deadline(async () => {
    try { connection = await Connection.connect({ address: `${manifest.temporal.host}:${manifest.temporal.port}`, connectTimeout: 1000 }); return true; }
    catch { return false; }
  }, "owned Temporal readiness");
  await connection.workflowService.registerNamespace({ namespace: manifest.temporal.namespace, workflowExecutionRetentionPeriod: { seconds: 86400 } });
  const client = new Client({ connection, namespace: manifest.temporal.namespace });
  const role = await prisma.role.create({ data: { name: randomUUID(), permissions: [] } });
  const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, name: "Synthetic Worker test", passwordHash: "not-a-login", roleId: role.id } });
  const org = await prisma.organization.create({ data: { slug: randomUUID(), name: "Synthetic Worker test" } });
  await prisma.workflowDefinition.upsert({ where: { key: "platform.heartbeat" }, update: {}, create: { key: "platform.heartbeat", slug: "platform-heartbeat", workflowType: "temporalPlatformHeartbeatWorkflow",
    contractVersion: 1, defaultTaskQueue: manifest.temporal.taskQueue, name: "Synthetic heartbeat" } });
  let locked;
  const acquired = new Promise(resolve => { locked = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  lock = prisma.$transaction(async tx => { await tx.$executeRawUnsafe('LOCK TABLE "WorkflowExecution" IN ACCESS EXCLUSIVE MODE'); locked(); await held; }, { timeout: 60000 });
  await acquired;
  child = startWorker();
  const workflowId = `${manifest.temporal.namespace}-drain`;
  let handle;
  await deadline(async () => {
    if (child.exited) throw Error("Built Worker exited before task processing");
    try { handle = await client.workflow.start("temporalPlatformHeartbeatWorkflow", { workflowId, taskQueue: manifest.temporal.taskQueue,
      args: [{}, { orgId: org.id, startedById: user.id, workflowDefinitionKey: "platform.heartbeat" }] }); return true; }
    catch { return false; }
  }, "start owned Workflow");
  await deadline(async () => {
    if (child.exited) throw Error("Built Worker exited before Activity started");
    // Temporal may defer persisting ActivityTaskStarted until completion.
    // Scheduled history plus the actual owned SQL lock wait below proves start.
    return (await handle.fetchHistory()).events.some(event => event.activityTaskScheduledEventAttributes);
  }, "Activity scheduling");
  await deadline(async () => {
    const waiting = await prisma.$queryRaw`SELECT count(*)::int AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%WorkflowExecution%'`;
    return waiting[0].count > 0;
  }, "Activity blocked on owned SQL lock");
  const signalledAt = Date.now();
  assert.equal(child.kill("SIGTERM"), true);
  await delay(300);
  assert.equal(child.exited, false, "Worker must drain the actual in-flight Activity");
  release(); await lock; lock = undefined;
  await deadline(async () => child.exited, "Worker drain exit", 12000);
  assert.deepEqual(await child.exitResult, { code: 0, signal: null });
  const elapsed = Date.now() - signalledAt;
  assert(elapsed >= 300 && elapsed < 12000);
  assert.equal(await prisma.workflowExecution.count({ where: { workflowId } }), 1);
  // Finish the retained Workflow task after restarting the same built entry point.
  child = startWorker();
  let completed = false;
  const result = handle.result().then(value => { completed = true; return value; });
  await deadline(async () => completed, "Workflow recovery after Worker restart", 20000);
  assert.equal(await result, "ok");
  child.kill("SIGTERM");
  await deadline(async () => child.exited, "restarted Worker exit", 12000);
  assert.deepEqual(await child.exitResult, { code: 0, signal: null });
  assert(!logs.join("").includes("WORKER_START_OR_RUN_FAILED"));
  assert(!logs.join("").includes("WORKER_RESOURCE_CLOSE_FAILED"));
  console.log(JSON.stringify({ result: "PASS", test: "actual built Worker SIGTERM with in-flight SQL Activity, drain, projection and restart recovery", drainMs: elapsed }));
} finally {
  release?.();
  if (lock) await lock.catch(() => {});
  for (const process of children) if (!process.exited) process.kill("SIGKILL");
  await writeFile(resolve(manifest.artifactDirectory, "worker-stdout-stderr.log"), logs.join(""));
  await connection?.close();
  await prisma.$disconnect();
}
