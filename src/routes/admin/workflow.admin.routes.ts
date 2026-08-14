import { Router } from "express";
import { workflowAdminController } from "../../controllers/admin/workflow.admin.controller.js";

export const workflowAdminRoutes = Router();

workflowAdminRoutes.get("/", workflowAdminController.list.bind(workflowAdminController));
workflowAdminRoutes.get("/:id", workflowAdminController.detail.bind(workflowAdminController));
workflowAdminRoutes.post("/:id", workflowAdminController.updateMetadata.bind(workflowAdminController));
workflowAdminRoutes.post("/:id/policy", workflowAdminController.updatePolicy.bind(workflowAdminController));
