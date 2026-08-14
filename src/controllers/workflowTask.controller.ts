import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { listQuerySchema, toListParams, buildMeta } from "../lib/query.js";
import { AppError } from "../lib/AppError.js";
import { workflowHumanTaskService } from "../services/workflow-human-task.service.js";

const orgQuerySchema = z.object({
  orgId: z.string().min(1).optional(),
});

const actionBodyBaseSchema = z.object({
  orgId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).max(120),
  _csrf: z.string().min(1),
});

export class WorkflowTaskController {
  async inbox(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const orgQuery = orgQuerySchema.parse(req.query);
      const listQuery = listQuerySchema.parse(req.query);
      const params = toListParams(listQuery, "openedAt");
      const payload = await workflowHumanTaskService.listInbox(
        { userId: req.user.id, roleId: req.user.roleId },
        orgQuery.orgId,
        params
      );

      res.render("workflow-tasks/inbox", {
        layout: "public",
        title: "Workflow Tasks",
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        meta: buildMeta(listQuery, payload.total),
        query: listQuery,
      });
    } catch (err) {
      next(err);
    }
  }

  async detail(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.query);
      const payload = await workflowHumanTaskService.getAuthenticatedTask(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );

      res.render("workflow-tasks/detail", {
        layout: "public",
        title: payload.task.title,
        ...payload,
        idempotencyKey: randomUUID(),
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async submitAuthenticated(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const base = actionBodyBaseSchema.parse(req.body);
      const payload = await workflowHumanTaskService.getAuthenticatedTask(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        base.orgId
      );
      const { orgId: _orgId, idempotencyKey: _idempotencyKey, _csrf, ...rawInput } = req.body as Record<string, unknown>;
      const input = payload.action.validateInput(rawInput);

      const result = await workflowHumanTaskService.submitAuthenticated(
        { userId: req.user.id, roleId: req.user.roleId },
        {
          taskId: req.params.id,
          actionKey: req.params.actionKey,
          input,
          idempotencyKey: base.idempotencyKey,
        }
      );

      res.redirect(`/workflow-tasks/${result.task.id}?orgId=${encodeURIComponent(result.task.orgId)}&submitted=1`);
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof AppError) {
        const message = err instanceof z.ZodError ? err.errors[0].message : err.message;
        const orgId = typeof req.body?.orgId === "string" ? `?orgId=${encodeURIComponent(req.body.orgId)}&` : "?";
        return res.redirect(`/workflow-tasks/${req.params.id}${orgId}error=${encodeURIComponent(message)}`);
      }
      next(err);
    }
  }

  async tokenDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const payload = await workflowHumanTaskService.getTokenTask(req.params.token);
      res.render("workflow-tasks/token-detail", {
        layout: "public",
        title: payload.task.title,
        ...payload,
        rawToken: req.params.token,
        idempotencyKey: randomUUID(),
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async submitToken(req: Request, res: Response, next: NextFunction) {
    try {
      const base = actionBodyBaseSchema.parse(req.body);
      const payload = await workflowHumanTaskService.getTokenTask(req.params.token);
      const { idempotencyKey: _idempotencyKey, _csrf, orgId: _orgId, ...rawInput } = req.body as Record<string, unknown>;
      const input = payload.action.validateInput(rawInput);

      await workflowHumanTaskService.submitWithToken(
        req.params.token,
        req.params.actionKey,
        input,
        base.idempotencyKey
      );

      res.render("workflow-tasks/token-complete", {
        layout: "public",
        title: "Workflow Task Submitted",
        task: payload.task,
      });
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof AppError) {
        const message = err instanceof z.ZodError ? err.errors[0].message : err.message;
        return res.redirect(`/workflow-task-tokens/${encodeURIComponent(req.params.token)}?error=${encodeURIComponent(message)}`);
      }
      next(err);
    }
  }
}

export const workflowTaskController = new WorkflowTaskController();
