// Example REST resource routes.
import { Router } from "express";
import { userController } from "../controllers/user.controller.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";
import { verifyBrowserMutation } from "../middleware/csrf.js";

export const userRoutes = Router();

userRoutes.get("/", requireAuth, requirePermission("user", "read"), userController.list.bind(userController));
userRoutes.get("/:id", requireAuth, requirePermission("user", "read"), userController.getOne.bind(userController));
userRoutes.post("/", requireAuth, verifyBrowserMutation, requirePermission("user", "create"), userController.create.bind(userController));
