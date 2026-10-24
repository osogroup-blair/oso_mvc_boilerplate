import { ActivityIdempotencyStatus, type Prisma } from "@prisma/client";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import {
  ActivityIdempotencyModel,
  activityIdempotencyModel,
} from "../models/activityIdempotency.model.js";
import { stableHash } from "../lib/stable-hash.js";
import { settingService } from "./setting.service.js";

const DEFAULT_STALE_CLAIM_MINUTES = 15;
const MIN_STALE_CLAIM_MINUTES = 1;
const MAX_STALE_CLAIM_MINUTES = 1440;

/** Only opt in when repeating the same provider operation key cannot duplicate effects. */
export interface ActivityOperationPolicy<T> {
  retrySafe?: boolean;
  classifyError?: (error: unknown) => "retryable" | "terminal" | "uncertain";
  reconcile?: (operationKey: string) => Promise<{ found: true; value: T } | { found: false }>;
  providerReceiptId?: (value: T) => string | undefined;
}

export class ActivityIdempotencyService extends BaseService {
  constructor(
    private readonly model: ActivityIdempotencyModel = activityIdempotencyModel,
    private readonly settings: typeof settingService = settingService
  ) {
    super("ActivityIdempotencyService");
  }

  async run<T>(
    orgId: string, scope: string, idempotencyKey: string, request: unknown,
    operation: (operationKey: string) => Promise<T>, policy: ActivityOperationPolicy<T> = {}
  ): Promise<{ value: T; replayed: boolean }> {
    const requestHash = this.hashJson(request);
    // Provider keys are scoped by tenant and operation, not Temporal attempt.
    const operationKey = this.hashJson({ orgId, scope, idempotencyKey });
    let existing = await this.model.find(orgId, scope, idempotencyKey);
    if (!existing) {
      try {
        const reserved = await this.model.createRunning({ orgId, scope, idempotencyKey, requestHash });
        return this.executeReserved(reserved.id, reserved.attempt, operationKey, operation, policy);
      } catch (error) {
        if ((error as { code?: string })?.code !== "P2002") throw error;
        existing = await this.model.find(orgId, scope, idempotencyKey);
        if (!existing) throw error;
      }
    }
    if (existing.requestHash !== requestHash) throw AppError.conflict("Activity idempotency key was reused with a different request");
    if (existing.status === ActivityIdempotencyStatus.SUCCEEDED) return { value: existing.response as T, replayed: true };
    if (existing.status === ActivityIdempotencyStatus.FAILED) throw AppError.conflict("Activity operation failed terminally; operator review required");
    if (!policy.retrySafe && !policy.reconcile) throw AppError.conflict("Activity outcome requires provider reconciliation before retry");
    const reserved = await this.model.claim(existing.id, requestHash, existing.attempt, await this.staleRunningBefore());
    if (!reserved) throw AppError.conflict("Activity idempotency key is already running");
    return this.executeReserved(reserved.id, reserved.attempt, operationKey, operation, policy, true);
  }

  /**
   * Read-only replay lookup: returns a stored success for this exact request
   * without reserving or claiming anything. Callers that fail before `run`
   * (e.g. integration resolution) use it so an already-completed side effect is
   * replayed instead of being reported as a configuration failure.
   */
  async findSucceeded<T>(orgId: string, scope: string, idempotencyKey: string, request: unknown): Promise<{ value: T } | null> {
    const existing = await this.model.find(orgId, scope, idempotencyKey);
    if (!existing || existing.status !== ActivityIdempotencyStatus.SUCCEEDED) return null;
    if (existing.requestHash !== this.hashJson(request)) return null;
    return { value: existing.response as T };
  }

  private async executeReserved<T>(
    id: string, attempt: number, operationKey: string, operation: (key: string) => Promise<T>,
    policy: ActivityOperationPolicy<T>, recovering = false
  ): Promise<{ value: T; replayed: boolean }> {
    let value: T;
    try {
      const recovered = recovering && policy.reconcile ? await policy.reconcile(operationKey) : undefined;
      if (recovered?.found) value = recovered.value;
      else {
        if (recovering && !policy.retrySafe) throw AppError.conflict("Provider reconciliation has no definitive result; operator review required");
        value = await operation(operationKey);
      }
    } catch (error) {
      const classification = policy.classifyError?.(error) ?? (policy.retrySafe ? "retryable" : "uncertain");
      const status = classification === "terminal" ? ActivityIdempotencyStatus.FAILED
        : classification === "retryable" && policy.retrySafe ? ActivityIdempotencyStatus.RETRYABLE : ActivityIdempotencyStatus.UNCERTAIN;
      await this.model.fail(id, attempt, status, { code: `OPERATION_${classification.toUpperCase()}` });
      throw error;
    }
    // A provider success followed by a DB error is ambiguous. Never mark it as a
    // definite operation failure; leave RUNNING for fenced recovery/reconciliation.
    const completed = await this.model.complete(id, attempt, value as Prisma.InputJsonValue, policy.providerReceiptId?.(value));
    if (!completed.count) throw AppError.conflict("Activity lease was superseded before result persistence");
    return { value, replayed: false };
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
    return stableHash(value);
  }
}

export const activityIdempotencyService = new ActivityIdempotencyService();
