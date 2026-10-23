import { NativeConnection, Runtime, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { logger } from "../lib/logger.js";
import { activities } from "./activities/index.js";
import { runWorkerLifecycle } from "./worker-lifecycle.js";
import { workerResourcesService } from "../services/worker-resources.service.js";
import { temporalDataConverter } from "../lib/temporalPayload.js";
import { activityLogging } from "./activity-logging.js";
import { verifiedWorkflowBundle } from "./workflow-bundle.js";
import { temporalConnectionOptions } from "../lib/temporalTransport.js";

const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
let connection: NativeConnection | undefined;
let closed = false;
const bounded = async (promise:Promise<unknown>) => {
  let timer:ReturnType<typeof setTimeout>|undefined;
  try { await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("Worker resource cleanup deadline")),config.TEMPORAL_RESOURCE_CLOSE_MS);})]); }
  finally {if(timer)clearTimeout(timer);}
};
const close = async () => {
  if (closed) return;
  closed = true;
  try { await bounded(connection?.close() ?? Promise.resolve()); }
  finally { await bounded(workerResourcesService.close()); }
};
try {
  Runtime.install({ shutdownSignals: [] });
  connection = await NativeConnection.connect(await temporalConnectionOptions());
  const workflowSource = config.TEMPORAL_WORKFLOW_BUNDLE_PATH
    ? { workflowBundle: await verifiedWorkflowBundle(config.TEMPORAL_WORKFLOW_BUNDLE_PATH, config.TEMPORAL_WORKFLOW_BUNDLE_SHA256!) }
    : { workflowsPath: fileURLToPath(new URL(`./workflows/index.${extension}`, import.meta.url)) };
  const worker = await Worker.create({
    connection, namespace: config.TEMPORAL_NAMESPACE, taskQueue: config.TEMPORAL_TASK_QUEUE,
    ...workflowSource,
    dataConverter: temporalDataConverter, interceptors: { activity: [activityLogging] },
    activities, identity: config.TEMPORAL_WORKER_IDENTITY,
    shutdownGraceTime: config.TEMPORAL_SHUTDOWN_GRACE_MS, shutdownForceTime: config.TEMPORAL_SHUTDOWN_FORCE_MS,
  });
  logger.info({ namespace: config.TEMPORAL_NAMESPACE, taskQueue: config.TEMPORAL_TASK_QUEUE, identity: config.TEMPORAL_WORKER_IDENTITY }, "Temporal worker started");
  await runWorkerLifecycle(worker, close);
} catch (_error) {
  logger.error({ code: "WORKER_START_OR_RUN_FAILED" }, "Temporal Worker failed");
  process.exitCode = 1;
} finally {
  try { await close(); }
  catch (_error) { logger.error({ code: "WORKER_RESOURCE_CLOSE_FAILED" }, "Temporal Worker cleanup failed"); process.exitCode = 1; }
}

// Forced shutdown must not hang on an uncancellable database/socket operation.
if(process.exitCode)process.exit(process.exitCode);
