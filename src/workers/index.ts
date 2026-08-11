/**
 * Worker entry point — starts all BullMQ workers.
 * Imported by server.ts after Redis is initialised.
 */
import { startEmailWorker, stopEmailWorker } from "./email.worker.js";
import { logger } from "../lib/logger.js";

export function startWorkers() {
  logger.info("Starting background workers...");
  startEmailWorker();
}

export async function stopWorkers() {
  logger.info("Stopping background workers...");
  await stopEmailWorker();
}
