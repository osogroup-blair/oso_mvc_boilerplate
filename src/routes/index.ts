import { Router } from "express";
import { pageController } from "../controllers/page.controller.js";
import { optionalAuth } from "../middleware/auth.js";
import { healthRoutes } from "./health.routes.js";
import { userRoutes } from "./user.routes.js";
import { adminRoutes } from "./admin.routes.js";
import { pageRoutes } from "./page.routes.js";
import { projectRoutes } from "./project.routes.js";
import { taskRoutes, taskTagRoutes } from "./task.routes.js";
import { authRoutes } from "./auth.routes.js";
import { workflowRoutes } from "./workflow.routes.js";
import { workflowTaskRoutes, workflowTaskTokenRoutes } from "./workflowTask.routes.js";

import { gettingStartedRoutes } from "./getting-started.routes.js";

export const router = Router();

router.use("/", healthRoutes);
router.use("/getting-started", gettingStartedRoutes);
router.use("/auth", authRoutes);
router.use("/api/users", userRoutes);
router.use("/admin", adminRoutes);
router.use("/pages", pageRoutes);
router.use("/projects", projectRoutes);
router.use("/workflows", workflowRoutes);
router.use("/workflow-tasks", workflowTaskRoutes);
router.use("/workflow-task-tokens", workflowTaskTokenRoutes);
router.use("/api/projects/:projectId/tasks", taskRoutes);
router.use("/api/tasks", taskTagRoutes);

router.get("/", optionalAuth, pageController.renderHome.bind(pageController));
