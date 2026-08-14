import { prisma } from "./prisma.js";
import { logger } from "./logger.js";

const APP_ROUTES = [
  "/",
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
      await prisma.route.upsert({
        where: { pattern },
        update: {
          targetType: "APP",
          targetValue: "Internal Application Route",
          isActive: true,
          deletedAt: null // Restore if it was soft-deleted
        },
        create: {
          pattern,
          targetType: "APP",
          targetValue: "Internal Application Route",
          isActive: true
        }
      });
    }

    // Optionally: Clean up any APP routes in the DB that are no longer in APP_ROUTES
    const existingAppRoutes = await prisma.route.findMany({
      where: { targetType: "APP" }
    });

    for (const route of existingAppRoutes) {
      if (!APP_ROUTES.includes(route.pattern) && !route.deletedAt) {
        await prisma.route.update({
          where: { id: route.id },
          data: { deletedAt: new Date() }
        });
        logger.info(`Soft-deleted obsolete app route: ${route.pattern}`);
      }
    }

    logger.info("Application routes synchronized successfully.");
  } catch (error) {
    logger.error({ err: error }, "Failed to sync application routes");
  }
}
