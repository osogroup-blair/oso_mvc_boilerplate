import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { authService } from "../services/auth.service.js";
import { config } from "../config/index.js";

const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
  returnTo: z.string().optional(),
});

export class AdminAuthController {
  loginForm(req: Request, res: Response) {
    // If user is already logged in, redirect to admin index
    if (req.user) {
      return res.redirect("/admin");
    }
    res.render("admin/login", {
      layout: "main",
      title: "Login",
      hideNav: true,
      returnTo: req.query.returnTo || "",
    });
  }

  async login(req: Request, res: Response) {
    try {
      const { email, password, returnTo } = loginSchema.parse(req.body);
      const { token } = await authService.login(email, password);

      const isProd = config.isProd;
      const maxAge = config.SESSION_TTL_HOURS * 3600 * 1000;

      res.cookie("session", token, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/", // Scope cookies globally
        maxAge,
      });

      res.redirect(returnTo || "/admin");
    } catch (err) {
      // Re-render form with errors
      const errorMsg = err instanceof Error ? err.message : "Authentication failed";
      res.render("admin/login", {
        layout: "main",
        title: "Login",
        hideNav: true,
        error: errorMsg,
        email: req.body.email || "",
        returnTo: req.body.returnTo || "",
      });
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const cookieHeader = req.headers.cookie || "";
      const cookies = Object.fromEntries(
        cookieHeader.split(";").map((c) => {
          const parts = c.trim().split("=");
          return [parts[0], parts.slice(1).join("=")];
        })
      );
      const token = cookies.session;

      if (token) {
        await authService.logout(token);
      }

      res.clearCookie("session", { path: "/" });
      res.redirect("/admin/login");
    } catch (err) {
      next(err);
    }
  }
}

export const adminAuthController = new AdminAuthController();
