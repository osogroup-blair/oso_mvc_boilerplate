import { recordId } from "../../lib/identifiers.js";
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { organizationService } from "../../services/organization.service.js";
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
      const orgs = await organizationService.getAll(req.user?.id);
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
      const { org, availableUsers, ...capabilities } = await organizationService.getDetailWithAvailableUsers(recordId.parse(req.params.id), req.user?.id);

      res.render("admin/organizations/detail", {
        layout: "main",
        title: org.name,
        org,
        availableUsers,
        ...capabilities,
        orgRoles: capabilities.assignableRoles,
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
        req.user!.id, z.string().uuid().optional().parse(req.body._operationId)
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
      await organizationService.update(recordId.parse(req.params.id), { name: data.name, logoUrl: data.logoUrl || undefined }, req.user?.id, z.string().uuid().optional().parse(req.body._operationId));
      res.redirect(`/admin/organizations/${recordId.parse(req.params.id)}?updated=1`);
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction) {
    try {
      await organizationService.delete(recordId.parse(req.params.id), req.user?.id, z.string().uuid().optional().parse(req.body._operationId));
      res.redirect("/admin/organizations?deleted=1");
    } catch (err) {
      next(err);
    }
  }

  async addMember(req: Request, res: Response, next: NextFunction) {
    try {
      const data = addMemberSchema.parse(req.body);
      await organizationService.addMember(recordId.parse(req.params.id), data.userId, data.role, req.user?.id, z.string().uuid().optional().parse(req.body._operationId));
      res.redirect(`/admin/organizations/${recordId.parse(req.params.id)}?memberAdded=1`);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.redirect(
          `/admin/organizations/${recordId.parse(req.params.id)}?error=${encodeURIComponent(err.errors[0].message)}`
        );
      }
      next(err);
    }
  }

  async changeRole(req: Request, res: Response, next: NextFunction) {
    try {
      const { orgId, memberId } = z.object({ orgId: recordId, memberId: recordId }).parse(req.params);
      const role = z.enum(ORG_ROLES).parse(req.body.role);
      await organizationService.changeRole(orgId, memberId, role, req.user?.id, z.string().uuid().optional().parse(req.body._operationId));
      res.redirect(`/admin/organizations/${orgId}?roleChanged=1`);
    } catch (err) {
      next(err);
    }
  }

  async removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { orgId, memberId } = z.object({ orgId: recordId, memberId: recordId }).parse(req.params);
      await organizationService.removeMember(orgId, memberId, req.user?.id, z.string().uuid().optional().parse(req.body._operationId));
      res.redirect(`/admin/organizations/${orgId}?memberRemoved=1`);
    } catch (err) {
      next(err);
    }
  }
}

export const orgAdminController = new OrganizationAdminController();


