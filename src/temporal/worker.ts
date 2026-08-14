import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "url";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";
import { activities } from "./activities/index.js";

function workflowBundlePath() {
  const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
  return fileURLToPath(new URL(`./workflows/index.${extension}`, import.meta.url));
}

const connection = await NativeConnection.connect({
  address: config.TEMPORAL_ADDRESS,
  tls: config.TEMPORAL_TLS_ENABLED ? {} : undefined,
});

const worker = await Worker.create({
  connection,
  namespace: config.TEMPORAL_NAMESPACE,
  taskQueue: config.TEMPORAL_TASK_QUEUE,
  workflowsPath: workflowBundlePath(),
  activities,
  identity: config.TEMPORAL_WORKER_IDENTITY,
});

logger.info(
  {
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    identity: config.TEMPORAL_WORKER_IDENTITY,
  },
  "Temporal worker started"
);

let shutdownRequested = false;

async function shutdown(signal: string) {
  if (shutdownRequested) return;
  shutdownRequested = true;

  logger.info({ signal }, "Temporal worker shutting down");
  worker.shutdown();
  await connection.close();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await worker.run();
