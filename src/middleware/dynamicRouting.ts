import type { Request, Response, NextFunction } from "express";
import { routeService } from "../services/route.service.js";
import { pageService } from "../services/page.service.js";
import { permissionsService } from "../services/permissions.service.js";
import { AppError } from "../lib/AppError.js";

interface Block {
  type: string;
  [key: string]: unknown;
}

interface PageSeo {
  description?: string;
  ogImage?: string;
}

// Extract allowed role names from the M2M relation (PageRole[] or RouteRole[]).
// Each join row includes { role: { name, id, ... } } via the include.
function allowedRoleNames(joinRows: Array<{ role: { name: string } }>): string[] {
  return joinRows.map((r) => r.role.name);
}

export async function dynamicRouting(req: Request, res: Response, next: NextFunction) {
  // Only handle GET requests for dynamic paths/redirects
  if (req.method !== "GET") {
    return next();
  }

  try {
    const matchedRoute = await routeService.getByPattern(req.path);
    if (!matchedRoute) {
      return next();
    }

    // Access control: Route Level — allowedRoles is now RouteRole[] with included role
    const routeAllowedRoles = allowedRoleNames(
      (matchedRoute as any).allowedRoles as Array<{ role: { name: string } }>
    );
    const user = res.locals.user;

    if (routeAllowedRoles.length > 0) {
      if (!user) {
        return res.redirect(`/admin/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
      }
      if (!routeAllowedRoles.includes(user.role)) {
        throw AppError.forbidden("You do not have permission to view this route");
      }
    }

    if (matchedRoute.targetType === "REDIRECT") {
      const code = matchedRoute.redirectCode || 302;
      return res.redirect(code, matchedRoute.targetValue);
    }

    if (matchedRoute.targetType === "PAGE") {
      // Look up page by slug or ID
      let page = await pageService.getPublishedBySlug(matchedRoute.targetValue);
      if (!page) {
        try {
          page = await pageService.getById(matchedRoute.targetValue);
          if (page && page.status !== "PUBLISHED") {
            page = null;
          }
        } catch {
          page = null;
        }
      }

      if (!page) {
        throw AppError.notFound("Dynamic Page Target");
      }

      // Access control: Page Level — allowedRoles is now PageRole[] with included role
      const pageAllowedRoles = allowedRoleNames(
        (page as any).allowedRoles as Array<{ role: { name: string } }>
      );
      if (pageAllowedRoles.length > 0) {
        if (!user) {
          return res.redirect(`/admin/login?returnTo=${encodeURIComponent(req.originalUrl)}`);
        }
        if (!pageAllowedRoles.includes(user.role)) {
          throw AppError.forbidden("You do not have permission to view this page");
        }
      }

      const blocks = (page.blocks as unknown as Block[]) ?? [];
      const seo = (page.seo as unknown as PageSeo) ?? {};
      const userPermissions = user ? await permissionsService.getActionsForRole(user.role) : [];

      return res.render("pages/show", {
        layout: "public",
        title: page.title,
        seo,
        page: { title: page.title, slug: page.slug, publishedAt: page.publishedAt },
        blocks,
        user,
        permissions: userPermissions,
      });
    }

    next();
  } catch (error) {
    next(error);
  }
}

