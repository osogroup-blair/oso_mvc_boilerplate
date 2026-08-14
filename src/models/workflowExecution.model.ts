import { WorkflowCapability, WorkflowExecutionStatus, type Prisma } from "@prisma/client";
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";

export class WorkflowExecutionModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  listForOrgAndRole(orgId: string, roleId: string, params: ListParams) {
    const where: Prisma.WorkflowExecutionWhereInput = {
      orgId,
      ...this.notDeleted,
      workflowDefinition: {
        deletedAt: null,
        roles: {
          some: {
            roleId,
            capability: { in: [WorkflowCapability.VIEW, WorkflowCapability.START] },
            deletedAt: null,
          },
        },
      },
      ...(params.search
        ? {
            OR: [
              { workflowId: { contains: params.search, mode: "insensitive" } },
              { businessKey: { contains: params.search, mode: "insensitive" } },
              { workflowDefinition: { name: { contains: params.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    return this.db.workflowExecution.findMany({
      where,
      include: {
        workflowDefinition: true,
        startedBy: { select: { id: true, name: true, email: true } },
      },
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
    });
  }

  countForOrgAndRole(orgId: string, roleId: string, search?: string) {
    return this.db.workflowExecution.count({
      where: {
        orgId,
        ...this.notDeleted,
        workflowDefinition: {
          deletedAt: null,
          roles: {
            some: {
              roleId,
              capability: { in: [WorkflowCapability.VIEW, WorkflowCapability.START] },
              deletedAt: null,
            },
          },
        },
        ...(search
          ? {
              OR: [
                { workflowId: { contains: search, mode: "insensitive" } },
                { businessKey: { contains: search, mode: "insensitive" } },
                { workflowDefinition: { name: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
    });
  }

  listStaleRunningForOrg(orgId: string, olderThan: Date, take = 25) {
    return this.db.workflowExecution.findMany({
      where: {
        orgId,
        ...this.notDeleted,
        status: { in: [WorkflowExecutionStatus.PENDING, WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.UNKNOWN] },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: olderThan } }],
      },
      include: {
        workflowDefinition: {
          include: {
            roles: { where: { deletedAt: null }, include: { role: true } },
          },
        },
        startedBy: { select: { id: true, name: true, email: true } },
        org: true,
      },
      take,
      orderBy: [{ lastSyncedAt: "asc" }, { startedAt: "asc" }],
    });
  }

  countStaleRunningForOrg(orgId: string, olderThan: Date) {
    return this.db.workflowExecution.count({
      where: {
        orgId,
        ...this.notDeleted,
        status: { in: [WorkflowExecutionStatus.PENDING, WorkflowExecutionStatus.RUNNING, WorkflowExecutionStatus.UNKNOWN] },
        OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: olderThan } }],
      },
    });
  }

  findByIdInOrg(id: string, orgId: string) {
    return this.db.workflowExecution.findFirst({
      where: { id, orgId, ...this.notDeleted },
      include: {
        workflowDefinition: {
          include: {
            roles: { where: { deletedAt: null }, include: { role: true } },
            integrationRequirements: { where: { deletedAt: null }, orderBy: { key: "asc" } },
          },
        },
        startedBy: { select: { id: true, name: true, email: true } },
        org: true,
      },
    });
  }

  findByWorkflowIdInOrg(workflowId: string, orgId: string) {
    return this.db.workflowExecution.findFirst({
      where: { workflowId, orgId, ...this.notDeleted },
      include: { workflowDefinition: true },
    });
  }

  create(data: Prisma.WorkflowExecutionUncheckedCreateInput) {
    return this.db.workflowExecution.create({ data });
  }

  update(id: string, data: Prisma.WorkflowExecutionUpdateInput) {
    return this.db.workflowExecution.update({
      where: { id },
      data,
      include: {
        workflowDefinition: true,
        startedBy: { select: { id: true, name: true, email: true } },
        org: true,
      },
    });
  }

  updateStatus(id: string, status: WorkflowExecutionStatus, data: Prisma.WorkflowExecutionUpdateInput = {}) {
    return this.update(id, { ...data, status, lastSyncedAt: new Date() });
  }

  softDelete(id: string) {
    return this.db.workflowExecution.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export const workflowExecutionModel = new WorkflowExecutionModel();
