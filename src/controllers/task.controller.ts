// REST JSON controller for Tasks.
// Demonstrates: Zod validation + ok()/fail() envelope, requireAuth on writes.
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { taskService } from "../services/task.service.js";
import { listQuerySchema, toListParams, buildMeta } from "../lib/query.js";
import { ok } from "../lib/response.js";

// ─── Input schemas ───────────────────────────────────────────────────────────
const taskCreateSchema = z.object({
  title:       z.string().min(1, "Title is required").max(200),
  description: z.string().optional(),
  status:      z.enum(["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]).default("TODO"),
  priority:    z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).default("MEDIUM"),
  dueDate:     z.string().datetime().optional().nullable(),
  meta:        z.object({
    estimatedHours: z.number().optional(),
    storyPoints:    z.number().optional(),
  }).optional(),
});

const taskUpdateSchema = taskCreateSchema.partial();

export class TaskController {

  // GET /api/projects/:projectId/tasks
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query     = listQuerySchema.parse(req.query);
      const params    = toListParams(query);
      const projectId = req.params.projectId;

      const [rows, total] = await Promise.all([
        taskService.list({ ...params, projectId }),
        taskService.count(params.search, projectId),
      ]);

      res.json(ok(rows, buildMeta(query, total)));
    } catch (err) { next(err); }
  }

  // POST /api/projects/:projectId/tasks
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data      = taskCreateSchema.parse(req.body);
      const projectId = req.params.projectId;
      const actorId   = req.user?.id;

      const created = await taskService.create(
        {
          title:       data.title,
          description: data.description,
          status:      data.status,
          priority:    data.priority,
          dueDate:     data.dueDate ? new Date(data.dueDate) : undefined,
          meta:        data.meta ?? undefined,
          project:     { connect: { id: projectId } },
        },
        actorId
      );

      res.status(201).json(ok(created));
    } catch (err) { next(err); }
  }

  // PATCH /api/projects/:projectId/tasks/:id
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const data    = taskUpdateSchema.parse(req.body);
      const actorId = req.user?.id;

      const updated = await taskService.update(
        req.params.id,
        {
          ...data,
          dueDate: data.dueDate ? new Date(data.dueDate) : data.dueDate,
        },
        actorId
      );

      res.json(ok(updated));
    } catch (err) { next(err); }
  }

  // DELETE /api/projects/:projectId/tasks/:id
  async destroy(req: Request, res: Response, next: NextFunction) {
    try {
      const removed = await taskService.remove(req.params.id, req.user?.id);
      res.json(ok(removed));
    } catch (err) { next(err); }
  }

  // POST /api/tasks/:id/tags/:tagId  — M2M: add a tag
  async addTag(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await taskService.addTag(req.params.id, req.params.tagId, req.user?.id);
      res.status(201).json(ok(result));
    } catch (err) { next(err); }
  }

  // DELETE /api/tasks/:id/tags/:tagId  — M2M: remove a tag
  async removeTag(req: Request, res: Response, next: NextFunction) {
    try {
      const result = await taskService.removeTag(req.params.id, req.params.tagId, req.user?.id);
      res.json(ok(result));
    } catch (err) { next(err); }
  }
}

export const taskController = new TaskController();
