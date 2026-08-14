import {
  Prisma,
  WorkflowActionReceiptStatus,
  WorkflowHumanTaskStatus,
  type WorkflowActionChannel,
} from "@prisma/client";
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
    return this.db.$transaction(async (tx) => {
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

  update(id: string, data: Prisma.WorkflowHumanTaskUpdateInput) {
    return this.db.workflowHumanTask.update({
      where: { id },
      data,
      include: this.detailInclude(),
    });
  }

  createToken(data: Prisma.WorkflowTaskTokenUncheckedCreateInput) {
    return this.db.workflowTaskToken.create({ data });
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

  consumeToken(id: string) {
    return this.db.workflowTaskToken.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
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
  }) {
    return this.db.workflowActionReceipt.create({
      data: {
        ...data,
        status: WorkflowActionReceiptStatus.RECEIVED,
      },
    });
  }

  finalizeReceipt(id: string, data: { status: WorkflowActionReceiptStatus; result?: Prisma.InputJsonValue; error?: Prisma.InputJsonValue }) {
    return this.db.workflowActionReceipt.update({
      where: { id },
      data,
    });
  }

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
