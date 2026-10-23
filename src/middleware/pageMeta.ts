import type { Request, Response, NextFunction } from "express";
import { pageService } from "../services/page.service.js";
import { AppError } from "../lib/AppError.js";
import { STATIC_PAGE_POLICIES } from "../lib/page-policies.js";

export function enforcePagePermissions(slug: string) {
  if (!STATIC_PAGE_POLICIES.has(slug)) throw new Error("Declare the static Page policy before composing its guard");
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = await pageService.getPublishedBySlug(slug);

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
