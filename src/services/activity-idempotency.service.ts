import { ActivityIdempotencyStatus, type Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import {
  ActivityIdempotencyModel,
  activityIdempotencyModel,
} from "../models/activityIdempotency.model.js";
import { settingService } from "./setting.service.js";

const DEFAULT_STALE_CLAIM_MINUTES = 15;
const MIN_STALE_CLAIM_MINUTES = 1;
const MAX_STALE_CLAIM_MINUTES = 1440;

export class ActivityIdempotencyService extends BaseService {
  constructor(
    private readonly model: ActivityIdempotencyModel = activityIdempotencyModel,
    private readonly settings: typeof settingService = settingService
  ) {
    super("ActivityIdempotencyService");
  }

  async run<T>(
    orgId: string,
    scope: string,
    idempotencyKey: string,
    request: unknown,
    operation: () => Promise<T>
  ): Promise<{ value: T; replayed: boolean }> {
    const requestHash = this.hashJson(request);
    const existing = await this.model.find(orgId, scope, idempotencyKey);

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw AppError.conflict("Activity idempotency key was reused with a different request");
      }
      if (existing.status === ActivityIdempotencyStatus.SUCCEEDED) {
        return { value: existing.response as T, replayed: true };
      }
      if (existing.status === ActivityIdempotencyStatus.RUNNING) {
        const staleBefore = await this.staleRunningBefore();
        const reserved = await this.model.takeOverStaleRunning(existing.id, requestHash, staleBefore);
        if (!reserved) throw AppError.conflict("Activity idempotency key is already running");
        return this.executeReserved(reserved.id, operation);
      }
      throw AppError.conflict("Activity idempotency key already has a failed attempt; use a new key");
    }

    const reserved = await this.model.createRunning({
      orgId,
      scope,
      idempotencyKey,
      requestHash,
    });

    return this.executeReserved(reserved.id, operation);
  }

  private async executeReserved<T>(
    reservationId: string,
    operation: () => Promise<T>
  ): Promise<{ value: T; replayed: boolean }> {
    try {
      const value = await operation();
      await this.model.complete(reservationId, value as Prisma.InputJsonValue);
      return { value, replayed: false };
    } catch (err) {
      await this.model.fail(reservationId, {
        message: err instanceof Error ? err.message : "Activity operation failed",
      });
      throw err;
    }
  }

  private async staleRunningBefore() {
    const rawMinutes = await this.settings.get(
      "ACTIVITY_IDEMPOTENCY_STALE_CLAIM_MINUTES",
      String(DEFAULT_STALE_CLAIM_MINUTES)
    );
    const minutes = this.parseStaleClaimMinutes(rawMinutes);
    return new Date(Date.now() - minutes * 60_000);
  }

  private parseStaleClaimMinutes(rawMinutes: string | undefined) {
    const parsed = Number.parseInt(rawMinutes ?? "", 10);
    if (!Number.isFinite(parsed)) return DEFAULT_STALE_CLAIM_MINUTES;
    return Math.min(MAX_STALE_CLAIM_MINUTES, Math.max(MIN_STALE_CLAIM_MINUTES, parsed));
  }

  private hashJson(value: unknown) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
  }
}

export const activityIdempotencyService = new ActivityIdempotencyService();
