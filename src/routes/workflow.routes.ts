import { Router } from "express";
import { workflowController } from "../controllers/workflow.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { enforcePagePermissions } from "../middleware/pageMeta.js";
import { ensureCsrfToken, verifyCsrfToken } from "../middleware/csrf.js";

export const workflowRoutes = Router();

workflowRoutes.get(
  "/",
  requireAuth,
  enforcePagePermissions("workflows"),
  workflowController.catalog.bind(workflowController)
);
workflowRoutes.get(
  "/executions",
  requireAuth,
  enforcePagePermissions("workflows"),
  workflowController.executions.bind(workflowController)
);
workflowRoutes.get(
  "/executions/:id",
  requireAuth,
  enforcePagePermissions("workflows"),
  ensureCsrfToken,
  workflowController.executionDetail.bind(workflowController)
);
workflowRoutes.get(
  "/executions/:id/refresh",
  requireAuth,
  enforcePagePermissions("workflows"),
  workflowController.refresh.bind(workflowController)
);
workflowRoutes.post(
  "/executions/:id/cancel",
  requireAuth,
  enforcePagePermissions("workflows"),
  verifyCsrfToken,
  workflowController.cancel.bind(workflowController)
);
workflowRoutes.get(
  "/:slug",
  requireAuth,
  enforcePagePermissions("workflows"),
  ensureCsrfToken,
  workflowController.startForm.bind(workflowController)
);
workflowRoutes.post(
  "/:slug/start",
  requireAuth,
  enforcePagePermissions("workflows"),
  verifyCsrfToken,
  workflowController.start.bind(workflowController)
);
