import { appSyncModel } from "../models/appSync.model.js";
import { logger } from "./logger.js";

const APP_ROUTES = [
  "/",
  "/getting-started",
  "/auth",
  "/admin",
  "/admin/integrations",
  "/admin/workflows",
  "/admin/workflow-operations",
  "/projects",
  "/workflows",
  "/workflow-tasks",
  "/workflow-task-tokens",
  "/api/users",
  "/api/projects",
  "/api/tasks",
  "/pages",
  "/uploads"
];

export async function syncAppRoutes() {
  logger.info("Syncing application routes to database...");
  
  try {
    for (const pattern of APP_ROUTES) {
      await appSyncModel.upsertRoute(pattern);
    }

    // Optionally: Clean up any APP routes in the DB that are no longer in APP_ROUTES
    const existingAppRoutes = await appSyncModel.listAppRoutes();

    for (const route of existingAppRoutes) {
      if (!APP_ROUTES.includes(route.pattern) && !route.deletedAt) {
        await appSyncModel.softDeleteRoute(route.id);
        logger.info(`Soft-deleted obsolete app route: ${route.pattern}`);
      }
    }

    logger.info("Application routes synchronized successfully.");
  } catch (error) {
    logger.error({ err: error }, "Failed to sync application routes");
  }
}
