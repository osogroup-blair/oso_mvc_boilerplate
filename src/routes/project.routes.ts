// Routes for the server-rendered Project demo (public read, auth-gated writes).
// Demonstrates: one router per feature, requireAuth on mutating routes, method binding.
import { Router } from "express";
import { projectController } from "../controllers/project.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { enforcePagePermissions } from "../middleware/pageMeta.js";
import { verifyBrowserMutation } from "../middleware/csrf.js";

export const projectRoutes = Router();
projectRoutes.use(verifyBrowserMutation);

// Read — public
projectRoutes.get("/",    enforcePagePermissions("projects"), projectController.list.bind(projectController));
projectRoutes.get("/new", requireAuth, projectController.newForm.bind(projectController));
projectRoutes.get("/:id", projectController.show.bind(projectController));

// Write — require login
// NOTE: HTML forms only support GET/POST, so edit/delete use POST.
projectRoutes.get( "/:id/edit",   requireAuth, projectController.editForm.bind(projectController));
projectRoutes.post("/",           requireAuth, projectController.create.bind(projectController));
projectRoutes.post("/:id",        requireAuth, projectController.update.bind(projectController));
projectRoutes.post("/:id/delete", requireAuth, projectController.destroy.bind(projectController));
