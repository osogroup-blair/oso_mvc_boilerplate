import { Router } from "express";
import { settingAdminController } from "../../controllers/admin/setting.admin.controller.js";
import { requirePermission } from "../../middleware/auth.js";

export const settingAdminRoutes = Router();

settingAdminRoutes.get("/", requirePermission("admin", "settings"), settingAdminController.index);
settingAdminRoutes.post("/", requirePermission("admin", "settings"), settingAdminController.update);
