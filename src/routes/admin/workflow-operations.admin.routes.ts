import { Router } from "express";
import { workflowOperationsAdminController } from "../../controllers/admin/workflow-operations.admin.controller.js";

export const workflowOperationsAdminRoutes = Router();

workflowOperationsAdminRoutes.get("/", workflowOperationsAdminController.dashboard.bind(workflowOperationsAdminController));
workflowOperationsAdminRoutes.post("/reconcile", workflowOperationsAdminController.reconcile.bind(workflowOperationsAdminController));
workflowOperationsAdminRoutes.get("/schedules", workflowOperationsAdminController.schedules.bind(workflowOperationsAdminController));
workflowOperationsAdminRoutes.get("/schedules/new", workflowOperationsAdminController.newSchedule.bind(workflowOperationsAdminController));
workflowOperationsAdminRoutes.post("/schedules", workflowOperationsAdminController.createSchedule.bind(workflowOperationsAdminController));
workflowOperationsAdminRoutes.get("/schedules/:id", workflowOperationsAdminController.scheduleDetail.bind(workflowOperationsAdminController));
workflowOperationsAdminRoutes.post("/schedules/:id/pause", workflowOperationsAdminController.pauseSchedule.bind(workflowOperationsAdminController));
workflowOperationsAdminRoutes.post("/schedules/:id/unpause", workflowOperationsAdminController.unpauseSchedule.bind(workflowOperationsAdminController));
workflowOperationsAdminRoutes.post("/schedules/:id/trigger", workflowOperationsAdminController.triggerSchedule.bind(workflowOperationsAdminController));
workflowOperationsAdminRoutes.post("/schedules/:id/delete", workflowOperationsAdminController.deleteSchedule.bind(workflowOperationsAdminController));

workflowOperationsAdminRoutes.post("/recover-starts", workflowOperationsAdminController.recoverStarts.bind(workflowOperationsAdminController));

workflowOperationsAdminRoutes.post("/canary", workflowOperationsAdminController.canary.bind(workflowOperationsAdminController));
