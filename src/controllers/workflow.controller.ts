import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { workflowCatalogService } from "../services/workflow-catalog.service.js";
import {
  getStartRegistrationBySlug,
  workflowExecutionService,
} from "../services/workflow-execution.service.js";
import { AppError } from "../lib/AppError.js";
import { listQuerySchema, toListParams, buildMeta } from "../lib/query.js";
import { ok } from "../lib/response.js";

const catalogQuerySchema = z.object({
  orgId: z.string().min(1).optional(),
});

const startBodyBaseSchema = z.object({
  orgId: z.string().min(1).optional(),
});

export class WorkflowController {
  async catalog(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");

      const query = catalogQuerySchema.parse(req.query);
      const catalog = await workflowCatalogService.getCatalogForUser(req.user.id, req.user.roleId, query.orgId);

      res.render("workflows/catalog", {
        layout: "public",
        title: "Workflows",
        ...catalog,
        selectedOrgId: catalog.activeOrg?.id ?? query.orgId ?? "",
      });
    } catch (err) {
      next(err);
    }
  }

  async startForm(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = catalogQuerySchema.parse(req.query);
      const payload = await workflowExecutionService.getStartPage(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.slug,
        query.orgId
      );

      res.render("workflows/start", {
        layout: "public",
        title: payload.definition.name,
        ...payload,
        operationId: z.string().uuid().safeParse(req.query.operationId).success ? req.query.operationId : payload.operationId,
        selectedOrgId: payload.activeOrg.id,
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async start(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");

      const registration = getStartRegistrationBySlug(req.params.slug);
      if (!registration) throw AppError.notFound("Workflow registration");

      const base = startBodyBaseSchema.parse(req.body);
      const { orgId: _orgId, ...rawInput } = req.body as Record<string, unknown>;
      const input = registration.validateStart(rawInput);
      const execution = await workflowExecutionService.start(
        { userId: req.user.id, roleId: req.user.roleId },
        { slug: req.params.slug, orgId: base.orgId, operationId: z.string().uuid().parse(req.body.operationId), input }
      );

      res.redirect(`/workflows/executions/${execution.id}?orgId=${encodeURIComponent(execution.orgId)}&started=1`);
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof AppError) {
        const message = err instanceof z.ZodError ? err.errors[0].message : err.message;
        const orgId = typeof req.body?.orgId === "string" ? `?orgId=${encodeURIComponent(req.body.orgId)}&` : "?";
        return res.redirect(`/workflows/${req.params.slug}${orgId}error=${encodeURIComponent(message)}${typeof req.body.operationId === "string" ? "&operationId="+encodeURIComponent(req.body.operationId):""}`);
      }
      next(err);
    }
  }

  async executions(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const orgQuery = catalogQuerySchema.parse(req.query);
      const listQuery = listQuerySchema.parse(req.query);
      const params = toListParams(listQuery, "startedAt");
      const payload = await workflowExecutionService.listForUser(
        { userId: req.user.id, roleId: req.user.roleId },
        orgQuery.orgId,
        params
      );

      res.render("workflows/executions", {
        layout: "public",
        title: "Workflow Executions",
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        meta: buildMeta(listQuery, payload.total),
        query: listQuery,
      });
    } catch (err) {
      next(err);
    }
  }

  async executionDetail(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = catalogQuerySchema.parse(req.query);
      const payload = await workflowExecutionService.getDetail(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );

      res.render("workflows/execution-detail", {
        layout: "public",
        title: payload.execution.workflowDefinition.name,
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        inputSummaryJson: JSON.stringify(payload.execution.inputSummary ?? {}, null, 2),
        stateSummaryJson: JSON.stringify(payload.execution.stateSummary ?? {}, null, 2),
        errorJson: payload.execution.error ? JSON.stringify(payload.execution.error, null, 2) : "",
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async refresh(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = catalogQuerySchema.parse(req.query);
      const execution = await workflowExecutionService.refresh(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );
      res.json(ok(execution));
    } catch (err) {
      next(err);
    }
  }

  async cancel(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = catalogQuerySchema.parse(req.body);
      const execution = await workflowExecutionService.cancel(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );
      res.redirect(`/workflows/executions/${execution.id}?orgId=${encodeURIComponent(execution.orgId)}&cancelled=1`);
    } catch (err) {
      next(err);
    }
  }
}

export const workflowController = new WorkflowController();
