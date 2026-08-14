import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { WorkflowCapability } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import {
  workflowCatalogService,
  WORKFLOW_CAPABILITIES,
} from "../../services/workflow-catalog.service.js";
import { listQuerySchema, toListParams, buildMeta } from "../../lib/query.js";
import { AppError } from "../../lib/AppError.js";

const updateMetadataSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional().or(z.literal("")),
  category: z.string().max(80).optional().or(z.literal("")),
  icon: z.string().max(80).optional().or(z.literal("")),
  isEnabled: z.enum(["on"]).optional(),
  presentation: z
    .string()
    .default("{}")
    .transform((value, ctx) => {
      try {
        return JSON.parse(value || "{}") as Record<string, unknown>;
      } catch (_err) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Presentation must be valid JSON" });
        return z.NEVER;
      }
    }),
});

const policySchema = z.object({
  policy: z.record(z.record(z.union([z.literal("on"), z.array(z.literal("on"))]))).default({}),
});

export class WorkflowAdminController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listQuerySchema.parse(req.query);
      const params = toListParams(query, "name");
      const [definitions, total] = await Promise.all([
        workflowCatalogService.list(params),
        workflowCatalogService.count(params.search),
      ]);

      res.render("admin/workflows/list", {
        layout: "main",
        title: "Workflows",
        definitions,
        meta: buildMeta(query, total),
        query,
      });
    } catch (err) {
      next(err);
    }
  }

  async detail(req: Request, res: Response, next: NextFunction) {
    try {
      const [definition, roles] = await Promise.all([
        workflowCatalogService.getById(req.params.id),
        workflowCatalogService.listRoles(),
      ]);
      const roleRows = roles.map((role) => {
        const granted = new Set(
          definition.roles
            .filter((entry) => entry.roleId === role.id)
            .map((entry) => entry.capability)
        );

        return {
          role,
          capabilities: WORKFLOW_CAPABILITIES.map((capability) => ({
            value: capability,
            checked: granted.has(capability),
          })),
        };
      });

      res.render("admin/workflows/detail", {
        layout: "main",
        title: definition.name,
        definition,
        presentationJson: JSON.stringify(definition.presentation ?? {}, null, 2),
        capabilities: WORKFLOW_CAPABILITIES,
        roleRows,
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async updateMetadata(req: Request, res: Response, next: NextFunction) {
    try {
      const data = updateMetadataSchema.parse(req.body);
      await workflowCatalogService.updateAdminMetadata(
        req.params.id,
        {
          name: data.name,
          description: data.description || null,
          category: data.category || null,
          icon: data.icon || null,
          isEnabled: data.isEnabled === "on",
          presentation: data.presentation as Prisma.InputJsonObject,
        },
        req.user?.id
      );
      res.redirect(`/admin/workflows/${req.params.id}?updated=1`);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.redirect(`/admin/workflows/${req.params.id}?error=${encodeURIComponent(err.errors[0].message)}`);
      }
      next(err);
    }
  }

  async updatePolicy(req: Request, res: Response, next: NextFunction) {
    try {
      const parsed = policySchema.parse(req.body);
      const entries = Object.entries(parsed.policy).flatMap(([roleId, capabilities]) =>
        Object.keys(capabilities).map((capability) => {
          if (!Object.values(WorkflowCapability).includes(capability as WorkflowCapability)) {
            throw AppError.badRequest(`Unknown workflow capability: ${capability}`);
          }
          return { roleId, capability: capability as WorkflowCapability };
        })
      );

      await workflowCatalogService.replaceRolePolicy(req.params.id, entries, req.user?.id);
      res.redirect(`/admin/workflows/${req.params.id}?policyUpdated=1`);
    } catch (err) {
      if (err instanceof z.ZodError || err instanceof AppError) {
        const message = err instanceof z.ZodError ? err.errors[0].message : err.message;
        return res.redirect(`/admin/workflows/${req.params.id}?error=${encodeURIComponent(message)}`);
      }
      next(err);
    }
  }
}

export const workflowAdminController = new WorkflowAdminController();
