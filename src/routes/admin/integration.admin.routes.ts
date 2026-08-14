import { Router } from "express";
import { integrationAdminController } from "../../controllers/admin/integration.admin.controller.js";

export const integrationAdminRoutes = Router();

integrationAdminRoutes.get("/", integrationAdminController.list.bind(integrationAdminController));
integrationAdminRoutes.get("/new", integrationAdminController.newForm.bind(integrationAdminController));
integrationAdminRoutes.post("/", integrationAdminController.create.bind(integrationAdminController));
integrationAdminRoutes.get(
  "/workflow-bindings/:workflowDefinitionId",
  integrationAdminController.workflowBindings.bind(integrationAdminController)
);
integrationAdminRoutes.post(
  "/workflow-bindings/:workflowDefinitionId/:requirementKey",
  integrationAdminController.bindRequirement.bind(integrationAdminController)
);
integrationAdminRoutes.get("/:id", integrationAdminController.detail.bind(integrationAdminController));
integrationAdminRoutes.post("/:id/test", integrationAdminController.test.bind(integrationAdminController));
integrationAdminRoutes.post("/:id/rotate", integrationAdminController.rotate.bind(integrationAdminController));
integrationAdminRoutes.post("/:id/disable", integrationAdminController.disable.bind(integrationAdminController));
