import type { Request, Response, NextFunction } from "express";
import { healthService, HealthService } from "../services/health.service.js";
import { ok } from "../lib/response.js";

export class HealthController {
  constructor(private readonly service: HealthService = healthService) {}

  async show(_req: Request, res: Response, next: NextFunction) {
    try {
      const health = await this.service.getHealth();
      const statusCode = health.status === "down" ? 503 : 200;
      res.status(statusCode).json(ok(health));
    } catch (err) {
      next(err);
    }
  }
}

export const healthController = new HealthController();
