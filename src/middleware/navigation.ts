import { allowedRoleNames } from "../lib/pageAccess.js";
import type { Request, Response, NextFunction } from "express";
import { navigationItemService } from "../services/navigationItem.service.js";
import { pageService } from "../services/page.service.js";

interface NavItem {
  id: string;
  label: string;
  url: string;
  children?: NavItem[];
}

/**
 * Middleware that fetches the navigation tree and attaches it to res.locals
 * so it's available in all Handlebars views.
 * Filters out links to restricted pages that the current user does not have permission to view.
 */
export async function injectNavigation(_req: Request, res: Response, next: NextFunction) {
  try {
    const navigationTree = (await navigationItemService.getTree()) as unknown as NavItem[];
    const user = res.locals.user;

    const filterNav = async (items: NavItem[]): Promise<NavItem[]> => {
      const filtered: NavItem[] = [];
      for (const item of items) {
        let isAllowed = true;

        if (item.url.startsWith("/pages/")) {
          const slug = item.url.replace("/pages/", "");
          const page = await pageService.getPublishedBySlug(slug);
          if (page) {
            const allowedRoles = allowedRoleNames(page.allowedRoles);
            if (allowedRoles.length > 0) {
              if (!user || !allowedRoles.includes(user.role)) {
                isAllowed = false;
              }
            }
          }
        }

        if (isAllowed) {
          const children = item.children ? await filterNav(item.children) : [];
          filtered.push({
            ...item,
            children,
          });
        }
      }
      return filtered;
    };

    res.locals.navigation = await filterNav(navigationTree);
    next();
  } catch (error) {
    // If navigation fails, we don't necessarily want to bring down the whole app,
    // but we should log it. We'll pass it to next() so the global error handler catches it if severe.
    next(error);
  }
}
