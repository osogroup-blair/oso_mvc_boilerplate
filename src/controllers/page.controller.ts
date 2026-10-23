import { allowedRoleNames } from "../lib/pageAccess.js";
// Public-facing CMS controller. Fetches a published Page and renders it by
// passing its JSON `blocks` payload straight to the view. The view walks the
// blocks and renders each by type — the controller does no HTML work.
import type { Request, Response, NextFunction } from "express";
import { pageService } from "../services/page.service.js";
import { gettingStartedService } from "../services/getting-started.service.js";
import { AppError } from "../lib/AppError.js";
import { permissionsService } from "../services/permissions.service.js";

interface Block {
  type: string;
  [key: string]: unknown;
}

interface PageSeo {
  description?: string;
  ogImage?: string;
}

import { settingService } from "../services/setting.service.js";

export class PageController {
  // GET / — render the designated home page based on site settings.
  async renderHome(req: Request, res: Response, next: NextFunction) {
    try {
      const homePageSlug = await settingService.get("HOME_PAGE_SLUG", "getting-started");
      if (!homePageSlug || homePageSlug === "getting-started") {
        return res.render("pages/getting-started", { layout: "getting-started", title: "Build your next application", ...await gettingStartedService.getPage() });
      }
      req.params.slug = homePageSlug;
      return this.render(req, res, next);
    } catch (err) {
      next(err);
    }
  }

  // GET /pages/:slug — render a published CMS page.
  async render(req: Request, res: Response, next: NextFunction) {
    try {
      const page = await pageService.getPublishedBySlug(req.params.slug);
      if (!page) throw AppError.notFound("Page");

      // Check access permission
      const allowedRoles = allowedRoleNames(page.allowedRoles);
      const user = res.locals.user;

      if (allowedRoles.length > 0) {
        if (!user) {
          // Redirect to login page
          return res.redirect(`/admin/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
        }
        if (!allowedRoles.includes(user.role)) {
          throw AppError.forbidden("You do not have permission to view this page");
        }
      }

      // The payload handed to the view: title, SEO, and the ordered blocks.
      // Blocks are stored as JSON; we type them for the template's helper.
      const blocks = (page.blocks as unknown as Block[]) ?? [];
      const seo = (page.seo as unknown as PageSeo) ?? {};
      const userPermissions = user ? await permissionsService.getActionsForRole(user.role) : [];

      res.render("pages/show", {
        layout: "public",
        title: page.title,
        seo,
        page: { title: page.title, slug: page.slug, publishedAt: page.publishedAt },
        blocks,
        user,
        permissions: userPermissions,
      });
    } catch (err) {
      next(err);
    }
  }
}

export const pageController = new PageController();
