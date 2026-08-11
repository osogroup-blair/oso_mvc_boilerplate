// Task API routes — nested under /api/projects/:projectId/tasks for CRUD,
// and /api/tasks/:id/tags/:tagId for the M2M tag management endpoints.
import { Router } from "express";
import { taskController } from "../controllers/task.controller.js";
import { requireAuth } from "../middleware/auth.js";

// Project-scoped task CRUD
export const taskRoutes = Router({ mergeParams: true });

taskRoutes.get(  "/",    taskController.list.bind(taskController));
taskRoutes.post( "/",    requireAuth, taskController.create.bind(taskController));
taskRoutes.patch("/:id", requireAuth, taskController.update.bind(taskController));
taskRoutes.delete("/:id", requireAuth, taskController.destroy.bind(taskController));

// Tag management (M2M): /api/tasks/:id/tags/:tagId
export const taskTagRoutes = Router();

taskTagRoutes.post(  "/:id/tags/:tagId", requireAuth, taskController.addTag.bind(taskController));
taskTagRoutes.delete("/:id/tags/:tagId", requireAuth, taskController.removeTag.bind(taskController));
