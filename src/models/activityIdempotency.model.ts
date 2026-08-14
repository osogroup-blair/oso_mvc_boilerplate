import { ActivityIdempotencyStatus, type Prisma } from "@prisma/client";
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
  }) {
    return this.db.activityIdempotency.create({
      data: {
        ...data,
        status: ActivityIdempotencyStatus.RUNNING,
        lockedAt: new Date(),
      },
    });
  }

  async takeOverStaleRunning(id: string, requestHash: string, staleBefore: Date) {
    const result = await this.db.activityIdempotency.updateMany({
      where: {
        id,
        requestHash,
        status: ActivityIdempotencyStatus.RUNNING,
        lockedAt: { lte: staleBefore },
        ...this.notDeleted,
      },
      data: {
        lockedAt: new Date(),
        completedAt: null,
        response: undefined,
        error: undefined,
      },
    });

    if (result.count === 0) return null;
    return this.db.activityIdempotency.findFirst({
      where: { id, ...this.notDeleted },
    });
  }

  complete(id: string, response: Prisma.InputJsonValue) {
    return this.db.activityIdempotency.update({
      where: { id },
      data: {
        status: ActivityIdempotencyStatus.SUCCEEDED,
        response,
        error: undefined,
        completedAt: new Date(),
      },
    });
  }

  fail(id: string, error: Prisma.InputJsonValue) {
    return this.db.activityIdempotency.update({
      where: { id },
      data: {
        status: ActivityIdempotencyStatus.FAILED,
        error,
        completedAt: new Date(),
      },
    });
  }
}

export const activityIdempotencyModel = new ActivityIdempotencyModel();
