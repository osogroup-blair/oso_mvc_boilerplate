import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  WorkflowScheduleOverlapPolicy,
} from "@prisma/client";
import { workflowOperationsService } from "../../services/workflow-operations.service.js";
import { workflowScheduleService } from "../../services/workflow-schedule.service.js";
import { listQuerySchema, toListParams, buildMeta } from "../../lib/query.js";
import { AppError } from "../../lib/AppError.js";

const orgQuerySchema = z.object({
  orgId: z.string().min(1).optional(),
  staleMinutes: z.coerce.number().int().min(1).max(1440).default(15),
});

const createScheduleSchema = z.object({
  orgId: z.string().min(1).optional(),
  workflowDefinitionId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  cronExpression: z.string().trim().min(1).max(160),
  timezone: z.string().trim().min(1).max(80).default("UTC"),
  inputJson: z
    .string()
    .default("{}")
    .transform((value, ctx) => {
      try {
        const parsed = JSON.parse(value || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Input JSON must be an object" });
          return z.NEVER;
        }
        return parsed as Record<string, unknown>;
      } catch (_err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Input JSON must be valid JSON" });
        return z.NEVER;
      }
    }),
  overlapPolicy: z.nativeEnum(WorkflowScheduleOverlapPolicy).default(WorkflowScheduleOverlapPolicy.SKIP),
  catchupWindowSeconds: z.coerce.number().int().min(1).max(86_400).default(60),
  pauseOnFailure: z.enum(["on"]).optional(),
  paused: z.enum(["on"]).optional(),
});

export class WorkflowOperationsAdminController {
  async dashboard(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.query);
      const payload = await workflowOperationsService.dashboard(
        { userId: req.user.id, roleId: req.user.roleId },
        query.orgId,
        query.staleMinutes
      );

      res.render("admin/workflow-operations/dashboard", {
        layout: "main",
        title: "Workflow Operations",
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        query: { ...req.query, staleMinutes: query.staleMinutes },
      });
    } catch (err) {
      next(err);
    }
  }

  async reconcile(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.body);
      const result = await workflowOperationsService.reconcileStale(
        { userId: req.user.id, roleId: req.user.roleId },
        query.orgId,
        query.staleMinutes
      );
      res.redirect(`/admin/workflow-operations?orgId=${encodeURIComponent(result.activeOrg.id)}&reconciled=${result.results.length}`);
    } catch (err) {
      next(err);
    }
  }

  async schedules(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const orgQuery = orgQuerySchema.parse(req.query);
      const listQuery = listQuerySchema.parse(req.query);
      const params = toListParams(listQuery, "name");
      const payload = await workflowScheduleService.list(
        { userId: req.user.id, roleId: req.user.roleId },
        orgQuery.orgId,
        params
      );

      res.render("admin/workflow-operations/schedules", {
        layout: "main",
        title: "Workflow Schedules",
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        meta: buildMeta(listQuery, payload.total),
        query: { ...req.query, ...listQuery },
      });
    } catch (err) {
      next(err);
    }
  }

  async newSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.query);
      const payload = await workflowScheduleService.getCreatePage(
        { userId: req.user.id, roleId: req.user.roleId },
        query.orgId
      );

      res.render("admin/workflow-operations/new-schedule", {
        layout: "main",
        title: "New Workflow Schedule",
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async createSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const data = createScheduleSchema.parse(req.body);
      const created = await workflowScheduleService.create(
        { userId: req.user.id, roleId: req.user.roleId },
        {
          orgId: data.orgId,
          workflowDefinitionId: data.workflowDefinitionId,
          name: data.name,
          description: data.description || null,
          cronExpression: data.cronExpression,
          timezone: data.timezone,
          input: data.inputJson,
          overlapPolicy: data.overlapPolicy,
          catchupWindowSeconds: data.catchupWindowSeconds,
          pauseOnFailure: data.pauseOnFailure === "on",
          paused: data.paused === "on",
        }
      );
      res.redirect(`/admin/workflow-operations/schedules/${created.id}?orgId=${encodeURIComponent(created.orgId)}&created=1`);
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof AppError) {
        const message = err instanceof z.ZodError ? err.errors[0].message : err.message;
        return res.redirect(`/admin/workflow-operations/schedules/new?error=${encodeURIComponent(message)}`);
      }
      next(err);
    }
  }

  async scheduleDetail(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.query);
      const payload = await workflowScheduleService.getDetail(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );

      res.render("admin/workflow-operations/schedule-detail", {
        layout: "main",
        title: payload.schedule.name,
        ...payload,
        selectedOrgId: payload.activeOrg.id,
        inputJson: JSON.stringify(payload.schedule.input ?? {}, null, 2),
        inputSummaryJson: JSON.stringify(payload.schedule.inputSummary ?? {}, null, 2),
        temporalStatusJson: JSON.stringify(payload.schedule.lastTemporalStatus ?? {}, null, 2),
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async pauseSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.body);
      const updated = await workflowScheduleService.pause(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );
      res.redirect(`/admin/workflow-operations/schedules/${req.params.id}?orgId=${encodeURIComponent(updated.orgId)}&paused=1`);
    } catch (err) {
      next(err);
    }
  }

  async unpauseSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.body);
      const updated = await workflowScheduleService.unpause(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );
      res.redirect(`/admin/workflow-operations/schedules/${req.params.id}?orgId=${encodeURIComponent(updated.orgId)}&unpaused=1`);
    } catch (err) {
      next(err);
    }
  }

  async triggerSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.body);
      await workflowScheduleService.trigger(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );
      res.redirect(`/admin/workflow-operations/schedules/${req.params.id}?orgId=${encodeURIComponent(query.orgId ?? "")}&triggered=1`);
    } catch (err) {
      next(err);
    }
  }

  async deleteSchedule(req: Request, res: Response, next: NextFunction) {
    try {
      if (!req.user?.roleId) throw AppError.unauthorized("Authentication required");
      const query = orgQuerySchema.parse(req.body);
      const deleted = await workflowScheduleService.remove(
        { userId: req.user.id, roleId: req.user.roleId },
        req.params.id,
        query.orgId
      );
      res.redirect(`/admin/workflow-operations/schedules?orgId=${encodeURIComponent(deleted.orgId)}&deleted=1`);
    } catch (err) {
      next(err);
    }
  }
}

export const workflowOperationsAdminController = new WorkflowOperationsAdminController();
