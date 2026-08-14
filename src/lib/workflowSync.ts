import { logger } from "./logger.js";
import { workflowCatalogService } from "../services/workflow-catalog.service.js";

export async function syncWorkflowDefinitions() {
  logger.info("Syncing code-registered workflow definitions...");

  try {
    const synced = await workflowCatalogService.syncCodeRegistrations();
    logger.info({ count: synced.length }, "Workflow definitions synchronized successfully.");
  } catch (error) {
    logger.error({ err: error }, "Failed to sync workflow definitions");
  }
}
