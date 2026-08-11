import { Router } from "express";
import { authController } from "../controllers/auth.controller.js";

export const authRoutes = Router();

// Registration
authRoutes.get("/register", authController.registerForm.bind(authController));
authRoutes.post("/register", authController.register.bind(authController));

// Password Reset
authRoutes.get("/forgot-password", authController.forgotPasswordForm.bind(authController));
authRoutes.post("/forgot-password", authController.requestPasswordReset.bind(authController));

authRoutes.get("/reset-password/:token?", authController.resetPasswordForm.bind(authController));
authRoutes.post("/reset-password", authController.resetPassword.bind(authController));

// Email Verification
authRoutes.get("/verify-email/:token", authController.verifyEmail.bind(authController));
authRoutes.post("/verify-email", authController.verifyEmail.bind(authController));
