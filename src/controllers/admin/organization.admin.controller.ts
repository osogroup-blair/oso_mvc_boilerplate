import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { organizationService } from "../../services/organization.service.js";
import { AppError } from "../../lib/AppError.js";
import { ORG_ROLES } from "../../lib/orgRoles.js";

const createOrgSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  logoUrl: z.string().url().optional().or(z.literal("")),
});

const addMemberSchema = z.object({
  userId: z.string().uuid("Invalid user ID"),
  role: z.enum(ORG_ROLES).default("MEMBER"),
});

export class OrganizationAdminController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const orgs = await organizationService.getAll();
      res.render("admin/organizations/list", {
        layout: "main",
        title: "Organizations",
        orgs,
        user: req.user,
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async detail(req: Request, res: Response, next: NextFunction) {
    try {
      const { org, availableUsers } = await organizationService.getDetailWithAvailableUsers(req.params.id);

      res.render("admin/organizations/detail", {
        layout: "main",
        title: org.name,
        org,
        availableUsers,
        orgRoles: ORG_ROLES,
        user: req.user,
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createOrgSchema.parse(req.body);
      const org = await organizationService.create(
        { name: data.name, logoUrl: data.logoUrl || undefined },
        req.user!.id
      );
      res.redirect(`/admin/organizations/${org.id}?created=1`);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.redirect(`/admin/organizations?error=${encodeURIComponent(err.errors[0].message)}`);
      }
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createOrgSchema.parse(req.body);
      await organizationService.update(req.params.id, { name: data.name, logoUrl: data.logoUrl || undefined });
      res.redirect(`/admin/organizations/${req.params.id}?updated=1`);
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await organizationService.delete(req.params.id);
      res.redirect("/admin/organizations?deleted=1");
    } catch (err) {
      next(err);
    }
  }

  async addMember(req: Request, res: Response, next: NextFunction) {
    try {
      const data = addMemberSchema.parse(req.body);
      await organizationService.addMember(req.params.id, data.userId, data.role);
      res.redirect(`/admin/organizations/${req.params.id}?memberAdded=1`);
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof AppError) {
        return res.redirect(
          `/admin/organizations/${req.params.id}?error=${encodeURIComponent(err instanceof z.ZodError ? err.errors[0].message : err.message)}`
        );
      }
      next(err);
    }
  }

  async changeRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { orgId, memberId } = req.params;
      const role = z.enum(ORG_ROLES).parse(req.body.role);
      await organizationService.changeRole(orgId, memberId, role);
      res.redirect(`/admin/organizations/${orgId}?roleChanged=1`);
    } catch (err) {
      next(err);
    }
  }

  async removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { orgId, memberId } = req.params;
      await organizationService.removeMember(orgId, memberId);
      res.redirect(`/admin/organizations/${orgId}?memberRemoved=1`);
    } catch (err) {
      next(err);
    }
  }
}

export const orgAdminController = new OrganizationAdminController();


