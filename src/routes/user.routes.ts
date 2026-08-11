// Example REST resource routes.
import { Router } from "express";
import { userController } from "../controllers/user.controller.js";
// import { requireAuth } from "../middleware/auth.js";

export const userRoutes = Router();

userRoutes.get("/", userController.list.bind(userController));
userRoutes.get("/:id", userController.getOne.bind(userController));
userRoutes.post("/", userController.create.bind(userController));
// Protect mutations in a real app:
// userRoutes.post("/", requireAuth, userController.create.bind(userController));
