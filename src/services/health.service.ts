import { BaseService } from "./BaseService.js";
import { SystemModel, systemModel } from "../models/system.model.js";
import {
  TemporalClientGateway,
  TemporalDiagnostics,
  temporalClientGateway,
} from "../lib/temporalClient.js";

export interface HealthStatus {
  status: "up" | "degraded" | "down";
  db: "up" | "down";
  temporal: TemporalDiagnostics;
}

export class HealthService extends BaseService {
  constructor(
    private readonly system: SystemModel = systemModel,
    private readonly temporal: TemporalClientGateway = temporalClientGateway
  ) {
    super("HealthService");
  }

  async getHealth(): Promise<HealthStatus> {
    let db: "up" | "down" = "up";

    try {
      await this.system.pingDatabase();
    } catch (_err) {
      db = "down";
    }

    const temporal = await this.temporal.getDiagnostics();

    return {
      status: db === "up" && temporal.status === "ok" ? "up" : db === "down" ? "down" : "degraded",
      db,
      temporal,
    };
  }
}

export const healthService = new HealthService();
