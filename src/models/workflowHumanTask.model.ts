import {
  Prisma,
  WorkflowActionReceiptStatus,
  WorkflowHumanTaskStatus,
  type WorkflowActionChannel,
} from "@prisma/client";
import { AppError } from "../lib/AppError.js";
import { safeAuditEntry } from "../lib/audit-policy.js";
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";

export class WorkflowHumanTaskModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  listOpenForUser(orgId: string, userId: string, roleId: string, params: ListParams) {
    const where = this.visibleForUserWhere(orgId, userId, roleId, params.search);
    return this.db.workflowHumanTask.findMany({
      where,
      include: this.detailInclude(),
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
    });
  }

  countOpenForUser(orgId: string, userId: string, roleId: string, search?: string) {
    return this.db.workflowHumanTask.count({
      where: this.visibleForUserWhere(orgId, userId, roleId, search),
    });
  }

  findVisibleForUser(id: string, orgId: string, userId: string, roleId: string) {
    return this.db.workflowHumanTask.findFirst({
      where: {
        id,
        orgId,
        ...this.notDeleted,
        OR: [
          { assignedUserId: userId },
          { roles: { some: { roleId, deletedAt: null } } },
        ],
      },
      include: this.detailInclude(),
    });
  }

  findById(id: string) {
    return this.db.workflowHumanTask.findFirst({
      where: { id, ...this.notDeleted },
      include: this.detailInclude(),
    });
  }

  findOpenById(id: string) {
    return this.db.workflowHumanTask.findFirst({
      where: { id, status: WorkflowHumanTaskStatus.OPEN, ...this.notDeleted },
      include: this.detailInclude(),
    });
  }

  findByWorkflowKey(workflowExecutionId: string, taskKey: string) {
    return this.db.workflowHumanTask.findFirst({
      where: { workflowExecutionId, taskKey, ...this.notDeleted },
      include: this.detailInclude(),
    });
  }

  findExecutionByWorkflowId(workflowId: string) {
    return this.db.workflowExecution.findFirst({
      where: { workflowId, deletedAt: null },
      include: {
        workflowDefinition: true,
        org: true,
      },
    });
  }

  findRoleByName(name: string) {
    return this.db.role.findFirst({ where: { name, deletedAt: null } });
  }

  findUserByEmail(email: string) {
    return this.db.user.findFirst({
      where: { email, isActive: true, deletedAt: null },
      select: { id: true, name: true, email: true },
    });
  }

  createWithRoles(data: Prisma.WorkflowHumanTaskUncheckedCreateInput, roleIds: string[]) {
    return this.mutate("workflowHumanTask.create", "WorkflowHumanTask", undefined, async tx => {
      const task = await tx.workflowHumanTask.create({ data });
      for (const roleId of roleIds) {
        await tx.workflowHumanTaskRole.upsert({
          where: { taskId_roleId: { taskId: task.id, roleId } },
          update: { deletedAt: null },
          create: { taskId: task.id, roleId },
        });
      }
      return tx.workflowHumanTask.findFirstOrThrow({
        where: { id: task.id },
        include: this.detailInclude(),
      });
    });
  }

  update(id: string, data: Prisma.WorkflowHumanTaskUpdateInput, actorId?: string) {
    return this.mutate("workflowHumanTask.update", "WorkflowHumanTask", actorId, tx => tx.workflowHumanTask.update({
      where: { id },
      data,
      include: this.detailInclude(),
    }), id);
  }

  createToken(data: Prisma.WorkflowTaskTokenUncheckedCreateInput, actorId?: string) {
    return this.mutate("workflowTaskToken.createToken", "WorkflowTaskToken", actorId, tx => tx.workflowTaskToken.create({ data }));
  }

  findTokenByHash(tokenHash: string) {
    return this.db.workflowTaskToken.findFirst({
      where: { tokenHash, deletedAt: null },
      include: {
        task: {
          include: this.detailInclude(),
        },
      },
    });
  }

  consumeToken(id: string, actorId?: string) {
    return this.mutate("workflowTaskToken.consumeToken", "WorkflowTaskToken", actorId, tx => tx.workflowTaskToken.update({
      where: { id },
      data: { consumedAt: new Date() },
    }), id);
  }

  findReceiptByIdempotencyKey(taskId: string, idempotencyKey: string) {
    return this.db.workflowActionReceipt.findFirst({
      where: { taskId, idempotencyKey, deletedAt: null },
    });
  }

  createReceipt(data: {
    orgId: string;
    taskId: string;
    workflowExecutionId: string;
    actionKey: string;
    idempotencyKey: string;
    channel: WorkflowActionChannel;
    actorUserId?: string;
    tokenId?: string;
    requestHash: string;
    result?: Prisma.InputJsonValue;
  }) {
    return this.mutate("workflowHumanTask.reserve_action", "WorkflowHumanTask", data.actorUserId, async tx => {
      const receipt = await tx.workflowActionReceipt.create({ data: { ...data, status: WorkflowActionReceiptStatus.RECEIVED } });
      // One logical action owns the task across different browser idempotency keys.
      const claimed = await tx.workflowHumanTask.updateMany({
        where: { id: data.taskId, orgId: data.orgId, status: WorkflowHumanTaskStatus.OPEN, deliveryReceiptId: null, deletedAt: null },
        data: { deliveryReceiptId: receipt.id },
      });
      if (!claimed.count) throw AppError.conflict("Workflow task already has a pending response");
      return receipt;
    });
  }

  rejectDelivery(taskId: string, receiptId: string) {
    return this.db.$transaction(async tx => {
      await tx.workflowActionReceipt.update({ where: { id: receiptId, taskId, status: WorkflowActionReceiptStatus.RECEIVED },
        data: { status: WorkflowActionReceiptStatus.FAILED, error: { code: "WORKFLOW_ACTION_REJECTED" } } });
      await tx.workflowHumanTask.updateMany({ where: { id: taskId, deliveryReceiptId: receiptId, status: WorkflowHumanTaskStatus.OPEN, deletedAt: null },
        data: { deliveryReceiptId: null } });
      await tx.auditLog.create({ data: { action: "workflowHumanTask.deliveryRejected", entityType: "WorkflowHumanTask", entityId: taskId,
        changes: { after: { operationId: receiptId, code: "WORKFLOW_ACTION_REJECTED" } } } });
    });
  }

  commitDelivery(input: { taskId: string; receiptId: string; result: Prisma.InputJsonObject;
    tokenId?: string; audit: Prisma.AuditLogUncheckedCreateInput }) {
    return this.db.$transaction(async (tx) => {
      const existing = await tx.workflowActionReceipt.findFirstOrThrow({ where: { id: input.receiptId, taskId: input.taskId, deletedAt: null } });
      if (existing.status === WorkflowActionReceiptStatus.SUCCEEDED) {
        const task = await tx.workflowHumanTask.findFirstOrThrow({ where: { id: input.taskId, deletedAt: null }, include: this.detailInclude() });
        return { task, receipt: existing };
      }
      await tx.workflowHumanTask.updateMany({
        where: { id: input.taskId, deliveryReceiptId: input.receiptId, status: WorkflowHumanTaskStatus.OPEN, deletedAt: null },
        data: { deliveryStatus: "QUEUED" },
      });
      const task = await tx.workflowHumanTask.findFirstOrThrow({
        where: { id: input.taskId, deliveryReceiptId: input.receiptId, deletedAt: null }, include: this.detailInclude(),
      });
      const receipt = await tx.workflowActionReceipt.update({
        where: { id: input.receiptId, taskId: input.taskId, deletedAt: null },
        data: { status: WorkflowActionReceiptStatus.SUCCEEDED, result: input.result },
      });
      if (input.tokenId) await tx.workflowTaskToken.update({
        where: { id: input.tokenId, taskId: input.taskId, revokedAt: null, expiresAt: {gt: new Date()}, deletedAt: null }, data: { consumedAt: new Date() },
      });
      // Stable audit ID makes commit retries idempotent as well.
      await tx.auditLog.upsert({ where: { id: input.receiptId }, update: {}, create: { ...safeAuditEntry(input.audit as never), id: input.receiptId, changes: safeAuditEntry(input.audit as never).changes as Prisma.InputJsonObject } });
      return { task, receipt };
    });
  }

  finalizeReceipt(id: string, data: { status: WorkflowActionReceiptStatus; result?: Prisma.InputJsonValue; error?: Prisma.InputJsonValue }, actorId?: string) {
    return this.mutate("workflowActionReceipt.finalizeReceipt", "WorkflowActionReceipt", actorId, tx => tx.workflowActionReceipt.update({
      where: { id },
      data,
    }), id);
  }

  cancelOpenWorkflowTasks(input: {orgId:string;workflowId:string;runId:string}, actorId?: string) {
    return this.mutate("workflowHumanTask.cancelOpenWorkflowTasks", "WorkflowHumanTask", actorId, tx => tx.workflowHumanTask.updateMany({where:{orgId:input.orgId,workflowId:input.workflowId,runId:input.runId,status:WorkflowHumanTaskStatus.OPEN,deletedAt:null},
      data:{status:WorkflowHumanTaskStatus.CANCELED,closedAt:new Date()}}));
  }
  isActiveMember(userId:string,orgId:string) { return this.db.orgMember.findFirst({where:{userId,orgId,deletedAt:null,user:{isActive:true,deletedAt:null},org:{deletedAt:null}}}); }

  private visibleForUserWhere(orgId: string, userId: string, roleId: string, search?: string): Prisma.WorkflowHumanTaskWhereInput {
    return {
      orgId,
      status: WorkflowHumanTaskStatus.OPEN,
      ...this.notDeleted,
      OR: [
        { assignedUserId: userId },
        { roles: { some: { roleId, deletedAt: null } } },
      ],
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { title: { contains: search, mode: "insensitive" } },
                  { description: { contains: search, mode: "insensitive" } },
                  { workflowExecution: { workflowDefinition: { name: { contains: search, mode: "insensitive" } } } },
                ],
              },
            ],
          }
        : {}),
    };
  }

  private detailInclude() {
    return {
      org: true,
      workflowExecution: {
        include: {
          workflowDefinition: {
            include: {
              roles: { where: { deletedAt: null }, include: { role: true } },
            },
          },
        },
      },
      assignedUser: { select: { id: true, name: true, email: true } },
      roles: { where: { deletedAt: null }, include: { role: true } },
    } satisfies Prisma.WorkflowHumanTaskInclude;
  }
}

export const workflowHumanTaskModel = new WorkflowHumanTaskModel();
