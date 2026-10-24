import { randomUUID, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

// Never source .env or target an existing application database. Optional native
// engine/NODE_PATH overrides may be supplied by the caller on transferred installs.
const runId = randomUUID();
const name = `bp-platform-${runId}`;
const database = `bp_platform_${runId.replaceAll("-", "")}`;
const password = randomBytes(24).toString("hex");
const owner = "mvc-boilerplate-platform-tests";
const directory = resolve(`artifacts/platform-${runId}`);
const image = process.argv.find(arg => arg.startsWith("--image="))?.slice(8) ?? "postgres:16-alpine";
const browser = process.argv.includes("--browser");
const temporal = process.argv.includes("--temporal");
const temporalImage = "temporalio/auto-setup:1.25.2";
const temporalName = `${name}-temporal`;
const network = `${name}-network`;
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", ...options });
const checked = (command, args) => {
  const result = run(command, args);
  if (result.status !== 0) throw Error(`Owned fixture command failed: ${command} ${args[0]}`);
  return result.stdout;
};
await mkdir(directory, { recursive: true });
let created = false;
let networkCreated = false;
let temporalCreated = false;
let redisCreated = false;
const redisName = `${name}-redis`;
try {
  checked("docker", ["image", "inspect", image]); // Explicitly provision images separately.
  if (temporal || browser) {
    if(temporal)checked("docker", ["image", "inspect", temporalImage]);
    checked("docker", ["network", "create", "--label", `codex.owner=${owner}`, "--label", `codex.run=${runId}`, network]);
    networkCreated = true;
  }
  checked("docker", ["run", "--rm", "-d", "--name", name, "--label", `codex.owner=${owner}`, "--label", `codex.run=${runId}`,
    ...((temporal || browser) ? ["--network", network] : []),
    "-e", "POSTGRES_USER=platform", "-e", `POSTGRES_PASSWORD=${password}`, "-e", `POSTGRES_DB=${database}`, "-p", "127.0.0.1::5432", image]);
  created = true;
  const detail = JSON.parse(checked("docker", ["inspect", name]))[0];
  const port = Number(detail.NetworkSettings.Ports["5432/tcp"][0].HostPort);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (run("docker", ["exec", name, "pg_isready", "-h", "127.0.0.1", "-U", "platform", "-d", database]).status === 0) { ready = true; break; }
    await delay(500);
  }
  if (!ready) throw Error("Owned database readiness deadline exceeded");
  let redisPort = 16379;
  if (browser) {
    checked("docker", ["image", "inspect", "redis:7-alpine"]);
    checked("docker", ["run", "--rm", "-d", "--name", redisName, "--network", network, "--label", `codex.owner=${owner}`, "--label", `codex.run=${runId}`, "-p", "127.0.0.1::6379", "redis:7-alpine"]);
    redisCreated = true;
    redisPort = Number(JSON.parse(checked("docker", ["inspect", redisName]))[0].NetworkSettings.Ports["6379/tcp"][0].HostPort);
  }
  let temporalPort = 17243;
  if (temporal) {
    checked("docker", ["run", "--rm", "-d", "--name", temporalName, "--network", network, "--label", `codex.owner=${owner}`, "--label", `codex.run=${runId}`,
      "-e", "DB=postgres12", "-e", "DB_PORT=5432", "-e", "POSTGRES_USER=platform", "-e", `POSTGRES_PWD=${password}`, "-e", `POSTGRES_SEEDS=${name}`,
      "-p", "127.0.0.1::7233", temporalImage]);
    temporalCreated = true;
    temporalPort = Number(JSON.parse(checked("docker", ["inspect", temporalName]))[0].NetworkSettings.Ports["7233/tcp"][0].HostPort);
  }
  const endpoint = port => ({ host: "127.0.0.1", port });
  const manifest = { owner, runId, database: { ...endpoint(port), name: database },
    // Reserved identity only. This DB runner does not start these other services.
    temporal: { ...endpoint(temporalPort), namespace: name, taskQueue: name }, redis: { ...endpoint(redisPort), database: 14 },
    mail: endpoint(11025), appPort: 13119, browserPort: 19225, artifactDirectory: directory };
  const manifestPath = resolve(directory, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  checked("docker", ["exec", name, "psql", "-U", "platform", "-d", database, "-c",
    `CREATE SCHEMA platform_test; CREATE TABLE platform_test.ownership (run_id text PRIMARY KEY); INSERT INTO platform_test.ownership VALUES ('${runId}');`]);
  const url = `postgresql://platform:${password}@127.0.0.1:${port}/${database}?schema=public`;
  const env = { ...process.env, DATABASE_URL: url, PLATFORM_TEST_DATABASE_URL: url, PLATFORM_TEST_MANIFEST: manifestPath,
    REDIS_URL: `redis://127.0.0.1:${redisPort}/14`, JWT_SECRET: "synthetic-platform-jwt-secret-00000000", NODE_ENV: "test", TEMPORAL_TLS_ENABLED: "false",
    TEMPORAL_ADDRESS: `127.0.0.1:${temporalPort}`, TEMPORAL_NAMESPACE: name, TEMPORAL_TASK_QUEUE: name };
  for (const field of ["TEMPORAL_TLS_CA_PATH", "TEMPORAL_TLS_CLIENT_CERT_PATH", "TEMPORAL_TLS_CLIENT_KEY_PATH", "TEMPORAL_TLS_SERVER_NAME", "TEMPORAL_API_KEY", "TEMPORAL_WORKFLOW_BUNDLE_PATH", "TEMPORAL_WORKFLOW_BUNDLE_SHA256"]) delete env[field];
  for (const [stage, args] of [
    ["migrate", ["node_modules/prisma/build/index.js", "migrate", "deploy"]],
    ["integration", ["node_modules/vitest/vitest.mjs", "run", "--config", "vitest.platform-integration.config.ts", "--maxWorkers=1", "--minWorkers=1"]],
    ...(browser ? [["browser", ["tests/acceptance/full-browser.mjs"]]] : []),
    ...(temporal ? [["worker-process", ["tests/acceptance/worker-process.mjs"]], ["integration-failures", ["tests/acceptance/integration-failures.mjs"]], ["webhook-delivery", ["tests/acceptance/webhook-delivery.mjs"]], ["reliability", ["tests/acceptance/temporal-reliability.mjs"]], ["transport", ["tests/acceptance/transport-verification.mjs"]], ["restore-failure", ["tests/acceptance/restore-and-failure.mjs"]]] : []),
  ]) {
    const stageEnv = { ...env };
    if (stage === "integration") delete stageEnv.DATABASE_URL;
    if (["reliability","restore-failure"].includes(stage)) stageEnv.TEMPORAL_PAYLOAD_ENCRYPTION_ENABLED="true";
    const result = run(process.execPath, args, { env: stageEnv });
    const log = `${result.stdout ?? ""}${result.stderr ?? ""}`.replaceAll(password, "[REDACTED]");
    await writeFile(resolve(directory, `${stage}.log`), log);
    if (result.status !== 0) throw Error(`${stage} failed; inspect sanitized artifacts`);
    console.log(`${stage}: PASS`);
  }
  await writeFile(resolve(directory, "result.json"), JSON.stringify({ runId, image: detail.Image, result: "PASS", scope: temporal ? "Owned PostgreSQL/browser/Redis, Worker lifecycle, integration failure semantics, webhook delivery, reliability/replay, transport, restore and failure verification" : browser ? "Owned PostgreSQL/browser/Redis verification" : "PostgreSQL integration only" }, null, 2) + "\n");
  console.log(`Evidence: ${directory}`);
} catch (error) {
  console.error(error instanceof Error ? error.message.replaceAll(password, "[REDACTED]") : "Owned fixture failed");
  process.exitCode = 1;
} finally {
  if (temporalCreated) {
    const detail = JSON.parse(checked("docker", ["inspect", temporalName]))[0];
    if (detail.Config.Labels?.["codex.owner"] !== owner || detail.Config.Labels?.["codex.run"] !== runId) throw Error("Refusing unowned Temporal cleanup");
    await writeFile(resolve(directory, "temporal-server.log"), checked("docker", ["logs", temporalName]).replaceAll(password, "[REDACTED]"));
    checked("docker", ["rm", "-f", temporalName]);
  }
  if (redisCreated) {
    const detail = JSON.parse(checked("docker", ["inspect", redisName]))[0];
    if (detail.Config.Labels?.["codex.owner"] !== owner || detail.Config.Labels?.["codex.run"] !== runId) throw Error("Refusing unowned Redis cleanup");
    checked("docker", ["rm", "-f", redisName]);
  }
  if (created) {
    const detail = JSON.parse(checked("docker", ["inspect", name]))[0];
    if (detail.Config.Labels?.["codex.owner"] !== owner || detail.Config.Labels?.["codex.run"] !== runId) throw Error("Refusing cleanup of an unowned container");
    checked("docker", ["rm", "-f", name]);
    console.log("Removed owned PostgreSQL test container");
  }
  if (networkCreated) {
    const detail = JSON.parse(checked("docker", ["network", "inspect", network]))[0];
    if (detail.Labels?.["codex.run"] !== runId || detail.Labels?.["codex.owner"] !== owner) throw Error("Refusing unowned network cleanup");
    checked("docker", ["network", "rm", network]);
  }
}
