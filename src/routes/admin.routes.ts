// Dynamic admin routes. Every model is served by these same handlers —
// the :model param selects the schema + resource at runtime.
import { Router } from "express";
import { adminController } from "../controllers/admin.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { adminAuthController } from "../controllers/adminAuth.controller.js";
import { logController } from "../controllers/log.controller.js";
import { settingAdminRoutes } from "./admin/setting.admin.routes.js";
import { permissionAdminController } from "../controllers/admin/permission.admin.controller.js";
import { sessionAdminController } from "../controllers/admin/session.admin.controller.js";
import { assetController } from "../controllers/asset.controller.js";
import { createQueueBoard } from "../controllers/admin/queue.admin.controller.js";
import { orgAdminRoutes } from "./admin/organization.admin.routes.js";
import { workflowAdminRoutes } from "./admin/workflow.admin.routes.js";
import { integrationAdminRoutes } from "./admin/integration.admin.routes.js";
import { workflowOperationsAdminRoutes } from "./admin/workflow-operations.admin.routes.js";
import multer from "multer";

const upload = multer({ storage: multer.memoryStorage() });



export const adminRoutes = Router();

// Public routes for admin auth
adminRoutes.get("/login", adminAuthController.loginForm.bind(adminAuthController));
adminRoutes.post("/login", adminAuthController.login.bind(adminAuthController));
adminRoutes.post("/logout", adminAuthController.logout.bind(adminAuthController));

// Guard all subsequent admin CRUD routes
adminRoutes.use(requireAuth);

// Inject currentPath + adminUser into every admin render — consumed by the sidebar partial.
adminRoutes.use((req, res, next) => {
  // req.path is sub-router-relative (e.g. "/user"), so combine with baseUrl to
  // get the full path that matches the sidebar href values (e.g. "/admin/user").
  res.locals.currentPath = req.baseUrl + req.path;
  res.locals.adminUser   = res.locals.user;
  next();
});

adminRoutes.get("/", adminController.index.bind(adminController));
adminRoutes.get("/models", adminController.modelsList.bind(adminController));

// Logging and Diagnostics (must be before /:model catch-all)
adminRoutes.get("/logs/audit", logController.auditList.bind(logController));
adminRoutes.get("/logs/audit/:id", logController.auditDetail.bind(logController));
adminRoutes.get("/logs/diagnostics", logController.diagnostics.bind(logController));
adminRoutes.get("/logs/stream", logController.liveStream.bind(logController));

// Placeholder sections — wired in the nav, built out later.
adminRoutes.get("/permissions", permissionAdminController.matrix.bind(permissionAdminController));
adminRoutes.post("/permissions", requirePermission("role", "update"), permissionAdminController.saveMatrix.bind(permissionAdminController));
adminRoutes.use("/settings", settingAdminRoutes);

// Active Sessions
adminRoutes.get("/sessions", sessionAdminController.list.bind(sessionAdminController));
adminRoutes.post("/sessions/:id/logout", requirePermission("user", "update"), sessionAdminController.logout.bind(sessionAdminController));

// Asset / Media Library
adminRoutes.get("/assets", assetController.list.bind(assetController));
adminRoutes.post("/assets/upload", upload.single("file"), assetController.upload.bind(assetController));
adminRoutes.post("/assets/delete/:id", assetController.delete.bind(assetController));

// Background Job Queue Dashboard (Bull Board) — only active when Redis is available
adminRoutes.use("/jobs", createQueueBoard());

// Organizations (Multi-Tenancy)
adminRoutes.use("/organizations", orgAdminRoutes);

// Workflow catalog and policy
adminRoutes.use("/workflows", requirePermission("workflow", "admin"), workflowAdminRoutes);
adminRoutes.use("/integrations", requirePermission("integration", "admin"), integrationAdminRoutes);
adminRoutes.use("/workflow-operations", requirePermission("workflow", "admin"), workflowOperationsAdminRoutes);

adminRoutes.get("/:model", adminController.list.bind(adminController));
adminRoutes.get("/:model/new", adminController.createForm.bind(adminController));
adminRoutes.post("/:model", adminController.create.bind(adminController));
adminRoutes.get("/:model/:id", adminController.editForm.bind(adminController));
adminRoutes.post("/:model/:id", adminController.update.bind(adminController));
adminRoutes.post("/:model/:id/delete", adminController.remove.bind(adminController));

