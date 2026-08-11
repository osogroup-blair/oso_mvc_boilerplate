import type { Request, Response, NextFunction } from "express";
import { logService, type LogFilters } from "../services/log.service.js";
import { logRingBuffer, logBus } from "../lib/logger.js";
import { listQuerySchema, toListParams, buildMeta } from "../lib/query.js";
import { AppError } from "../lib/AppError.js";

export class LogController {
  async auditList(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listQuerySchema.parse(req.query);
      const params = toListParams(query);
      
      const filters: LogFilters = {};
      if (req.query.action && typeof req.query.action === "string") filters.action = req.query.action;
      if (req.query.entityType && typeof req.query.entityType === "string") filters.entityType = req.query.entityType;
      if (req.query.actorId && typeof req.query.actorId === "string") filters.actorId = req.query.actorId;
      
      const [records, total] = await Promise.all([
        logService.list(params, filters),
        logService.count(filters),
      ]);

      res.render("admin/logs/audit-list", {
        layout: "main",
        title: "Audit Log",
        records,
        meta: buildMeta(query, total),
        query: req.query,
      });
    } catch (err) {
      next(err);
    }
  }

  async auditDetail(req: Request, res: Response, next: NextFunction) {
    try {
      const record = await logService.getById(req.params.id);
      if (!record) throw AppError.notFound("AuditLog");
      
      let changesJson = "{}";
      if (record.changes) {
        changesJson = JSON.stringify(record.changes, null, 2);
      }

      res.render("admin/logs/audit-detail", {
        layout: "main",
        title: "Audit Detail",
        record,
        changesJson,
      });
    } catch (err) {
      next(err);
    }
  }

  async diagnostics(_req: Request, res: Response, next: NextFunction) {
    try {
      const health = await logService.getSystemHealth();
      res.render("admin/logs/diagnostics", {
        layout: "main",
        title: "Diagnostics",
        health,
      });
    } catch (err) {
      next(err);
    }
  }

  liveStream(req: Request, res: Response) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Flush existing buffer
    const allLines = logRingBuffer.getAll();
    allLines.forEach((line) => res.write(`data: ${line}\n\n`));

    const onLine = (line: string) => {
      res.write(`data: ${line}\n\n`);
    };

    logBus.on("line", onLine);
    req.on("close", () => {
      logBus.off("line", onLine);
    });
  }
}

export const logController = new LogController();
