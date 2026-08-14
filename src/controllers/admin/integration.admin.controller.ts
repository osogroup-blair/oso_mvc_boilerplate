import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { integrationService } from "../../services/integration.service.js";
import { listQuerySchema, toListParams, buildMeta } from "../../lib/query.js";
import { AppError } from "../../lib/AppError.js";

const orgQuerySchema = z.object({
  orgId: z.string().min(1).optional(),
  providerKey: z.string().min(1).optional(),
});

const createConnectionSchema = z.object({
  orgId: z.string().min(1).optional(),
  providerKey: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  config: z.record(z.unknown()).default({}),
  credentials: z.record(z.unknown()).default({}),
});

const rotateCredentialsSchema = z.object({
  orgId: z.string().min(1).optional(),
  credentials: z.record(z.unknown()).default({}),
});

const bindRequirementSchema = z.object({
  orgId: z.string().min(1).optional(),
  connectionId: z.string().min(1),
  isEnabled: z.enum(["on"]).optional(),
});

export class IntegrationAdminController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const orgQuery = orgQuerySchema.parse(req.query);
      const listQuery = listQuerySchema.parse(req.query);
      const params = toListParams(listQuery, "name");
      const payload = await integrationService.listConnections(
        { userId: req.user.id, roleId: req.user.roleId },
        orgQuery.orgId,
        params
      );

      res.render("admin/integrations/list", {
        layout: "main",
        title: "Integrations",
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        meta: buildMeta(listQuery, payload.total),
        query: { ...req.query, ...listQuery },
      });
    } catch (err) {
      next(err);
    }
  }

  async newForm(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.query);
      const payload = await integrationService.getNewConnectionPage(
        { userId: req.user.id, roleId: req.user.roleId },
        query.orgId,
        query.providerKey
      );

      res.render("admin/integrations/new", {
        layout: "main",
        title: "New Integration",
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const data = createConnectionSchema.parse(req.body);
      const payload = await integrationService.createConnection(
        { userId: req.user.id, roleId: req.user.roleId },
        data
      );
      res.redirect(`/admin/integrations/${payload.connection.id}?orgId=${encodeURIComponent(payload.activeOrg.id)}&created=1`);
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof AppError) {
        const message = err instanceof z.ZodError ? err.errors[0].message : err.message;
        return res.redirect(`/admin/integrations/new?error=${encodeURIComponent(message)}`);
      }
      next(err);
    }
  }

  async detail(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.query);
      const payload = await integrationService.getConnection(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );

      res.render("admin/integrations/detail", {
        layout: "main",
        title: payload.connection.name,
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async test(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.body);
      const result = await integrationService.testConnection(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );
      res.redirect(`/admin/integrations/${req.params.id}?orgId=${encodeURIComponent(query.orgId ?? "")}&tested=${result.ok ? "1" : "0"}&message=${encodeURIComponent(result.message)}`);
    } catch (err) {
      next(err);
    }
  }

  async rotate(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const data = rotateCredentialsSchema.parse(req.body);
      const payload = await integrationService.rotateCredentials(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        data.orgId,
        data.credentials
      );
      res.redirect(`/admin/integrations/${req.params.id}?orgId=${encodeURIComponent(payload.activeOrg.id)}&rotated=1`);
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof AppError) {
        const message = err instanceof z.ZodError ? err.errors[0].message : err.message;
        return res.redirect(`/admin/integrations/${req.params.id}?error=${encodeURIComponent(message)}`);
      }
      next(err);
    }
  }

  async disable(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.body);
      const payload = await integrationService.disableConnection(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );
      res.redirect(`/admin/integrations/${req.params.id}?orgId=${encodeURIComponent(payload.activeOrg.id)}&disabled=1`);
    } catch (err) {
      next(err);
    }
  }

  async workflowBindings(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.query);
      const payload = await integrationService.getWorkflowBindingPage(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.workflowDefinitionId,
        query.orgId
      );

      res.render("admin/integrations/workflow-bindings", {
        layout: "main",
        title: `${payload.definition.name} Integrations`,
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async bindRequirement(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const data = bindRequirementSchema.parse(req.body);
      await integrationService.bindRequirement(
        { userId: req.user.id, roleId: req.user.roleId },
        {
          orgId: data.orgId,
          workflowDefinitionId: req.params.workflowDefinitionId,
          requirementKey: req.params.requirementKey,
          connectionId: data.connectionId,
          isEnabled: data.isEnabled === "on",
        }
      );
      res.redirect(`/admin/integrations/workflow-bindings/${req.params.workflowDefinitionId}?orgId=${encodeURIComponent(data.orgId ?? "")}&bound=1`);
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof AppError) {
        const message = err instanceof z.ZodError ? err.errors[0].message : err.message;
        return res.redirect(`/admin/integrations/workflow-bindings/${req.params.workflowDefinitionId}?error=${encodeURIComponent(message)}`);
      }
      next(err);
    }
  }
}

export const integrationAdminController = new IntegrationAdminController();
