import { ActivityIdempotencyStatus, Prisma } from "@prisma/client";
import { BaseModel } from "./BaseModel.js";

export class ActivityIdempotencyModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  find(orgId: string, scope: string, idempotencyKey: string) {
    return this.db.activityIdempotency.findFirst({
      where: { orgId, scope, idempotencyKey, ...this.notDeleted },
    });
  }

  createRunning(data: {
    orgId: string;
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    expiresAt?: Date;
  }, actorId?: string) {
    return this.mutate("activityIdempotency.createRunning", "ActivityIdempotency", actorId, tx => tx.activityIdempotency.create({
      data: {
        ...data,
        status: ActivityIdempotencyStatus.RUNNING,
        lockedAt: new Date(),
      },
    }));
  }

  async claim(id: string, requestHash: string, attempt: number, staleBefore: Date) {
    const result = await this.mutate("activityIdempotency.claim", "ActivityIdempotency", undefined, tx => tx.activityIdempotency.updateMany({
      where: { id, requestHash, attempt, ...this.notDeleted, OR: [
        { status: ActivityIdempotencyStatus.RETRYABLE },
        { status: ActivityIdempotencyStatus.UNCERTAIN },
        { status: ActivityIdempotencyStatus.RUNNING, lockedAt: { lte: staleBefore } },
      ] },
      data: { status: ActivityIdempotencyStatus.RUNNING, attempt: { increment: 1 }, lockedAt: new Date(),
        completedAt: null, response: Prisma.DbNull, error: Prisma.DbNull },
    }), id);
    return result.count ? { id, attempt: attempt + 1 } : null;
  }

  complete(id: string, attempt: number, response: Prisma.InputJsonValue, providerReceiptId?: string, actorId?: string) {
    return this.mutate("activityIdempotency.complete", "ActivityIdempotency", actorId, tx => tx.activityIdempotency.updateMany({
      where: { id, attempt, status: ActivityIdempotencyStatus.RUNNING, ...this.notDeleted },
      data: { status: ActivityIdempotencyStatus.SUCCEEDED, response, providerReceiptId,
        error: Prisma.DbNull, completedAt: new Date() },
    }), id);
  }

  fail(id: string, attempt: number, status: ActivityIdempotencyStatus, error: Prisma.InputJsonValue, actorId?: string) {
    return this.mutate("activityIdempotency.fail", "ActivityIdempotency", actorId, tx => tx.activityIdempotency.updateMany({
      where: { id, attempt, status: ActivityIdempotencyStatus.RUNNING, ...this.notDeleted },
      data: { status, error, completedAt: new Date() },
    }), id);
  }
}

export const activityIdempotencyModel = new ActivityIdempotencyModel();
