// Dedicated controller for the permissions matrix admin page.
// GET  /admin/permissions  → renders the role × permission matrix
// POST /admin/permissions  → saves checkbox form data, updating each role's permissions
import type { Request, Response, NextFunction } from "express";
import {
  permissionsService,
  DEFINED_PERMISSIONS,
  permKey,
} from "../../services/permissions.service.js";

export class PermissionAdminController {
  // GET /admin/permissions
  // Pre-computes the full matrix data so the template only loops — no logic in views.
  async matrix(req: Request, res: Response, next: NextFunction) {
    try {
      const roles = await permissionsService.getMatrix();
      const saved = req.query.saved === "1";

      // ── Build column headers (flat list in definition order) ──────────────
      const columnHeaders = DEFINED_PERMISSIONS.map((p) => ({
        permKey: permKey(p.resource, p.action),
        label: p.label,
        description: p.description ?? "",
        resource: p.resource,
        action: p.action,
      }));

      // ── Build resource group spans for the header row ──────────────────────
      // e.g. page×4, user×4, role×2, …
      const resourceGroups: { resource: string; count: number }[] = [];
      for (const col of columnHeaders) {
        const last = resourceGroups[resourceGroups.length - 1];
        if (last && last.resource === col.resource) {
          last.count++;
        } else {
          resourceGroups.push({ resource: col.resource, count: 1 });
        }
      }

      // ── Build matrix rows (one per role, cells aligned to columnHeaders) ──
      const matrixRows = roles.map((role) => {
        const permSet = new Set(role.permissions);
        return {
          roleId: role.roleId,
          roleName: role.roleName,
          description: role.description,
          cells: columnHeaders.map((col) => ({
            permKey: col.permKey,
            checked: permSet.has(col.permKey),
          })),
        };
      });

      res.render("admin/permissions/matrix", {
        layout: "main",
        title: "Permissions",
        saved,
        columnHeaders,
        resourceGroups,
        matrixRows,
      });
    } catch (err) {
      next(err);
    }
  }

  // POST /admin/permissions
  // Form sends checkboxes named: perm[{roleId}][{resource}:{action}]
  // Unchecked boxes are absent — we collect present ones per role.
  async saveMatrix(req: Request, res: Response, next: NextFunction) {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // body.perm is an object: { [roleId]: { [permKey]: "on" } }
      const permBody = (body.perm ?? {}) as Record<string, Record<string, string>>;

      const allRoles = await permissionsService.getMatrix();

      // For each known role, collect checked permissions and persist.
      await Promise.all(
        allRoles.map(async (role) => {
          const checkedPerms = permBody[role.roleId] ?? {};
          // A checkbox sends "on" when checked; absent = unchecked.
          const permissions = Object.keys(checkedPerms).filter(
            (k) => checkedPerms[k] === "on"
          );
          await permissionsService.setPermissions(role.roleId, permissions, req.user?.id);
        })
      );

      res.redirect("/admin/permissions?saved=1");
    } catch (err) {
      next(err);
    }
  }
}

export const permissionAdminController = new PermissionAdminController();
