import type { Request, Response, NextFunction } from "express";
import { authService } from "../services/auth.service.js";
import {
  registerSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./schemas/auth.schema.js";
import { ok } from "../lib/response.js";
import { config } from "../config/index.js";

export class AuthController {
  // Render Register View
  registerForm(req: Request, res: Response) {
    if (req.user) return res.redirect("/admin");
    res.render("auth/register", {
      layout: "main",
      title: "Create Account",
      hideNav: true,
    });
  }

  // Handle Registration (Form or API)
  async register(req: Request, res: Response, next: NextFunction) {
    const isJson = req.accepts(["html", "json"]) === "json" || req.path.startsWith("/api") || req.xhr;
    try {
      const data = registerSchema.parse(req.body);
      const { user, verificationToken } = await authService.register(data);

      // Auto login user after registration
      const { token } = await authService.login(data.email, data.password);
      const maxAge = config.SESSION_TTL_HOURS * 3600 * 1000;
      res.cookie("session", token, {
        httpOnly: true,
        secure: config.isProd,
        sameSite: "lax",
        path: "/",
        maxAge,
      });

      if (isJson) {
        return res.status(201).json(ok({ user, verificationToken, sessionToken: token }));
      }

      res.redirect("/admin?registered=1");
    } catch (err) {
      if (isJson) return next(err);
      const errorMsg = err instanceof Error ? err.message : "Registration failed";
      res.render("auth/register", {
        layout: "main",
        title: "Create Account",
        hideNav: true,
        error: errorMsg,
        name: req.body.name || "",
        email: req.body.email || "",
      });
    }
  }

  // Render Forgot Password Form
  forgotPasswordForm(_req: Request, res: Response) {
    res.render("auth/forgot-password", {
      layout: "main",
      title: "Forgot Password",
      hideNav: true,
    });
  }

  // Handle Request Password Reset
  async requestPasswordReset(req: Request, res: Response, next: NextFunction) {
    const isJson = req.accepts(["html", "json"]) === "json" || req.path.startsWith("/api") || req.xhr;
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      const result = await authService.requestPasswordReset(email);

      if (isJson) {
        return res.json(ok(result));
      }

      res.render("auth/forgot-password", {
        layout: "main",
        title: "Forgot Password",
        hideNav: true,
        success: result.message,
        resetToken: result.resetToken, // Displayed in non-prod UI for convenience
      });
    } catch (err) {
      if (isJson) return next(err);
      const errorMsg = err instanceof Error ? err.message : "Request failed";
      res.render("auth/forgot-password", {
        layout: "main",
        title: "Forgot Password",
        hideNav: true,
        error: errorMsg,
        email: req.body.email || "",
      });
    }
  }

  // Render Reset Password Form
  resetPasswordForm(req: Request, res: Response) {
    const token = (req.params.token || req.query.token || "") as string;
    res.render("auth/reset-password", {
      layout: "main",
      title: "Reset Password",
      hideNav: true,
      token,
    });
  }

  // Handle Password Reset
  async resetPassword(req: Request, res: Response, next: NextFunction) {
    const isJson = req.accepts(["html", "json"]) === "json" || req.path.startsWith("/api") || req.xhr;
    try {
      const { token, password } = resetPasswordSchema.parse(req.body);
      const result = await authService.resetPassword(token, password);

      if (isJson) {
        return res.json(ok(result));
      }

      res.render("admin/login", {
        layout: "main",
        title: "Login",
        hideNav: true,
        success: result.message,
      });
    } catch (err) {
      if (isJson) return next(err);
      const errorMsg = err instanceof Error ? err.message : "Reset failed";
      res.render("auth/reset-password", {
        layout: "main",
        title: "Reset Password",
        hideNav: true,
        token: req.body.token || "",
        error: errorMsg,
      });
    }
  }

  // Handle Email Verification
  async verifyEmail(req: Request, res: Response, next: NextFunction) {
    const isJson = req.accepts(["html", "json"]) === "json" || req.path.startsWith("/api") || req.xhr;
    try {
      const token = (req.params.token || req.query.token || req.body.token) as string;
      const parsed = verifyEmailSchema.parse({ token });
      const result = await authService.verifyEmail(parsed.token);

      if (isJson) {
        return res.json(ok(result));
      }

      res.render("admin/login", {
        layout: "main",
        title: "Login",
        hideNav: true,
        success: result.message,
      });
    } catch (err) {
      if (isJson) return next(err);
      res.render("admin/login", {
        layout: "main",
        title: "Login",
        hideNav: true,
        error: err instanceof Error ? err.message : "Verification failed",
      });
    }
  }
}

export const authController = new AuthController();
