import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { sessionService } from "../../services/session.service.js";
import { listQuerySchema, toListParams, buildMeta } from "../../lib/query.js";

export class SessionAdminController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listQuerySchema.parse(req.query);
      const params = toListParams(query);

      const [records, total] = await Promise.all([
        sessionService.listActive(params),
        sessionService.countActive(params.search),
      ]);

      res.render("admin/sessions/list", {
        layout: "main",
        title: "Active Sessions",
        records,
        meta: buildMeta(query, total),
        query: req.query,
        revoked: req.query.revoked === "1",
      });
    } catch (err) {
      next(err);
    }
  }

  async logout(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = req.params;
      const actorId = req.user?.id;
      await sessionService.revoke(id, actorId, z.string().uuid().optional().parse(req.body._operationId));

      res.redirect("/admin/sessions?revoked=1");
    } catch (err) {
      next(err);
    }
  }
}

export const sessionAdminController = new SessionAdminController();
