import type { Request, Response, NextFunction } from "express";
import { pageModel } from "../models/page.model.js";
import { AppError } from "../lib/AppError.js";

export function enforcePagePermissions(slug: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = await pageModel.findPublishedBySlug(slug);

      if (!page) {
        return next();
      }

      const allowedRoles = page.allowedRoles.map((r) => r.role.name);
      const user = res.locals.user;

      if (allowedRoles.length > 0) {
        if (!user) {
          return res.redirect(`/admin/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
        }
        if (!allowedRoles.includes(user.role)) {
          throw AppError.forbidden("You do not have permission to view this page");
        }
      }

      if (page.seo) {
        res.locals.seo = page.seo;
      }
      if (page.title) {
        res.locals.pageTitle = page.title;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
