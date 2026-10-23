// Public server-rendered controller for the Project/Task demo.
// Demonstrates: thin controller — validates with Zod, calls ONE service,
// builds a JSON payload, res.render(). No business logic, no DB access.
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { projectService } from "../services/project.service.js";
import { listQuerySchema, toListParams } from "../lib/query.js";
import { randomUUID } from "node:crypto";


// ─── Input schema ────────────────────────────────────────────────────────────
// Validated at the controller boundary; services trust their inputs.
const projectSchema = z.object({
  name:        z.string().min(1, "Name is required").max(120, "Name too long"),
  description: z.string().optional(),
  status:      z.enum(["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"]).default("ACTIVE"),
});

// ─── Helper ──────────────────────────────────────────────────────────────────
function basePayload(res: Response) {
  return {
    layout:      "public" as const,
    user:        res.locals.user ?? null,
    permissions: res.locals.permissions ?? [],
    navigation:  res.locals.navigation ?? [],
  };
}

export class ProjectController {

  // GET /projects — list view
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query  = listQuerySchema.parse(req.query);
      const params = toListParams(query);
      const projects = await projectService.list(params);

      res.render("projects/index", {
        ...basePayload(res),
        title:    "Projects",
        projects,
      });
    } catch (err) { next(err); }
  }

  // GET /projects/:id — detail view (eager-loads tasks + tags)
  async show(req: Request, res: Response, next: NextFunction) {
    try {
      const project = await projectService.getById(req.params.id);
      const user    = res.locals.user;
      const canEdit = user && (user.id === project.ownerId || user.role === "ADMIN");

      res.render("projects/show", {
        ...basePayload(res),
        title:     project.name,
        project,
        tasks:     (project as any).tasks ?? [],
        taskCount: ((project as any).tasks ?? []).length,
        canEdit,
      });
    } catch (err) { next(err); }
  }

  // GET /projects/new — blank create form (requireAuth on route)
  async newForm(_req: Request, res: Response, next: NextFunction) {
    try {
      res.render("projects/form", {
        ...basePayload(res),
        title:  "New Project",
        isEdit: false,
        project: {},
        operationId: randomUUID(),
      });
    } catch (err) { next(err); }
  }

  // POST /projects — create and redirect (requireAuth on route)
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = projectSchema.parse(req.body);
      const user = req.user!;
      const operationId = z.string().uuid().parse(req.body.operationId);

      const created = await projectService.create(
        {
          name:        data.name,
          description: data.description,
          status:      data.status,
          owner:       { connect: { id: user.id } },
        },
        user.id,
        operationId
      );

      res.redirect(`/projects/${created.id}`);
    } catch (err) { next(err); }
  }

  // GET /projects/:id/edit — pre-filled edit form (requireAuth on route)
  async editForm(req: Request, res: Response, next: NextFunction) {
    try {
      const project = await projectService.getById(req.params.id);

      res.render("projects/form", {
        ...basePayload(res),
        title:  `Edit — ${project.name}`,
        isEdit: true,
        project,
      });
    } catch (err) { next(err); }
  }

  // POST /projects/:id — update and redirect (requireAuth on route)
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data = projectSchema.parse(req.body);
      const user = req.user!;
      await projectService.update(req.params.id, data, user.id);
      res.redirect(`/projects/${req.params.id}`);
    } catch (err) { next(err); }
  }

  // POST /projects/:id/delete — soft-delete and redirect (requireAuth on route)
  async destroy(req: Request, res: Response, next: NextFunction) {
    try {
      const user = req.user!;
      await projectService.remove(req.params.id, user.id);
      res.redirect("/projects");
    } catch (err) { next(err); }
  }
}

export const projectController = new ProjectController();
