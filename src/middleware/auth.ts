// Auth guard middleware. Verifies a session via AuthService and attaches the user.
// Wire onto any route that requires a logged-in user.
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/AppError.js";
import { AuthService } from "../services/auth.service.js";
import { permissionsService } from "../services/permissions.service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { id: string; role: string; roleId?: string };
    }
  }
}

const authService = new AuthService();

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const cookieHeader = req.headers.cookie || "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const parts = c.trim().split("=");
        return [parts[0], parts.slice(1).join("=")];
      })
    );
    const token =
      req.headers.authorization?.replace("Bearer ", "") ||
      (cookies.session as string | undefined);

    if (!token) throw AppError.unauthorized("No session token");

    const user = await authService.verifySession(token);
    req.user = { id: user.id, role: user.role, roleId: user.roleId };
    res.locals.user = user;
    next();
  } catch (err) {
    const wantsJson = req.accepts(["html", "json"]) === "json" || req.path.startsWith("/api") || req.xhr;
    if (!wantsJson && req.originalUrl.startsWith("/admin")) {
      return res.redirect(`/admin/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
    }
    next(err);
  }
}

export async function optionalAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const cookieHeader = req.headers.cookie || "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const parts = c.trim().split("=");
        return [parts[0], parts.slice(1).join("=")];
      })
    );
    const token =
      req.headers.authorization?.replace("Bearer ", "") ||
      (cookies.session as string | undefined);

    if (token) {
      const user = await authService.verifySession(token);
      req.user = { id: user.id, role: user.role, roleId: user.roleId };
      res.locals.user = user;
    }
  } catch (_err) {
    // Ignore error, optional authentication
  }
  next();
}

// Factory: returns middleware that enforces a structured resource:action permission.
// Usage: router.post("/admin/role/:id/delete", requirePermission("role", "delete"), handler)
export function requirePermission(resource: string, action: string) {
  return async function permissionGuard(req: Request, _res: Response, next: NextFunction) {
    try {
      if (!req.user) throw AppError.unauthorized("Authentication required");

      // Prefer roleId (more stable) but fall back to role name lookup.
      let allowed: boolean;
      if (req.user.roleId) {
        allowed = await permissionsService.can(req.user.roleId, resource, action);
      } else {
        allowed = await permissionsService.canByName(req.user.role, resource, action);
      }

      if (!allowed) {
        throw AppError.forbidden(`Missing permission: ${resource}:${action}`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}




