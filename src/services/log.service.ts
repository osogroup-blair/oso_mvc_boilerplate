import { BaseService } from "./BaseService.js";
import { AuditLogModel } from "../models/auditLog.model.js";
import { SystemModel, systemModel } from "../models/system.model.js";
import type { ListParams } from "../lib/query.js";
import { config } from "../config/index.js";

export interface LogFilters {
  actorId?: string;
  entityType?: string;
  action?: string;
  from?: Date;
  to?: Date;
}

export interface SystemHealth {
  db: { status: "ok" | "error"; latencyMs: number };
  uptime: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  nodeVersion: string;
  env: string;
}

export class LogService extends BaseService {
  constructor(
    private readonly model = new AuditLogModel(),
    private readonly system: SystemModel = systemModel
  ) {
    super("LogService");
  }

  list(params: ListParams, filters: LogFilters = {}) {
    return this.model.list(params, filters);
  }

  count(filters: LogFilters = {}) {
    return this.model.count(filters);
  }

  getById(id: string) {
    return this.model.findById(id);
  }

  async getSystemHealth(): Promise<SystemHealth> {
    const start = Date.now();
    let dbStatus: "ok" | "error" = "ok";
    try {
      await this.system.pingDatabase();
    } catch (_err) {
      dbStatus = "error";
    }
    const latencyMs = Date.now() - start;

    const mem = process.memoryUsage();

    return {
      db: { status: dbStatus, latencyMs },
      uptime: process.uptime(),
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      nodeVersion: process.version,
      env: config.NODE_ENV,
    };
  }
}

export const logService = new LogService();
