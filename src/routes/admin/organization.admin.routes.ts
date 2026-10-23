import { Router } from "express";
import { orgAdminController } from "../../controllers/admin/organization.admin.controller.js";

export const orgAdminRoutes = Router();

orgAdminRoutes.get("/", orgAdminController.list.bind(orgAdminController));
orgAdminRoutes.post("/", orgAdminController.create.bind(orgAdminController));
orgAdminRoutes.get("/:id", orgAdminController.detail.bind(orgAdminController));
orgAdminRoutes.post("/:id", orgAdminController.update.bind(orgAdminController));
orgAdminRoutes.post("/:id/delete", orgAdminController.delete.bind(orgAdminController));
orgAdminRoutes.post("/:id/members", orgAdminController.addMember.bind(orgAdminController));
orgAdminRoutes.post("/:orgId/members/:memberId/role", orgAdminController.changeRole.bind(orgAdminController));
orgAdminRoutes.post("/:orgId/members/:memberId/remove", orgAdminController.removeMember.bind(orgAdminController));

