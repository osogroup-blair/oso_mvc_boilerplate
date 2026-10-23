// Process entry point. Starts the HTTP server and handles graceful shutdown.
import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { logger } from "./lib/logger.js";
import { closeDatabase } from "./lib/prisma.js";
import { syncAppRoutes } from "./lib/routeSync.js";
import { syncAppPages } from "./lib/pageSync.js";
import { syncWorkflowDefinitions } from "./lib/workflowSync.js";
import { initRedis, initQueues, redisConnection } from "./lib/queue.js";
import { startWorkers, stopWorkers } from "./workers/index.js";

// Init Redis (non-fatal if unavailable — falls back to synchronous email)
await initRedis();
initQueues();
startWorkers();

const app = createApp();

// Sync routes/pages to database on startup
await syncAppRoutes();
await syncAppPages();
await syncWorkflowDefinitions();

const server = app.listen(config.PORT, () => {
  logger.info(`🚀 Server on http://localhost:${config.PORT}`);
  logger.info(`   Admin: http://localhost:${config.PORT}/admin`);
});

async function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down...`);
  server.close(async () => {
    await stopWorkers();
    if (redisConnection) await redisConnection.quit();
    await closeDatabase();
    process.exit(0);
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
