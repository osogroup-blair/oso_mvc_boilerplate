import { Router } from "express";
import { workflowTaskController } from "../controllers/workflowTask.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { enforcePagePermissions } from "../middleware/pageMeta.js";
import { ensureCsrfToken, verifyCsrfToken } from "../middleware/csrf.js";

export const workflowTaskRoutes = Router();
export const workflowTaskTokenRoutes = Router();

workflowTaskRoutes.get(
  "/",
  requireAuth,
  enforcePagePermissions("workflow-tasks"),
  workflowTaskController.inbox.bind(workflowTaskController)
);
workflowTaskRoutes.get(
  "/:id",
  requireAuth,
  enforcePagePermissions("workflow-tasks"),
  ensureCsrfToken,
  workflowTaskController.detail.bind(workflowTaskController)
);
workflowTaskRoutes.post(
  "/:id/actions/:actionKey",
  requireAuth,
  enforcePagePermissions("workflow-tasks"),
  verifyCsrfToken,
  workflowTaskController.submitAuthenticated.bind(workflowTaskController)
);

workflowTaskTokenRoutes.get(
  "/:token",
  ensureCsrfToken,
  workflowTaskController.tokenDetail.bind(workflowTaskController)
);
workflowTaskTokenRoutes.post(
  "/:token/actions/:actionKey",
  verifyCsrfToken,
  workflowTaskController.submitToken.bind(workflowTaskController)
);
