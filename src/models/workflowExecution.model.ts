import { WorkflowCapability, WorkflowExecutionStatus, type Prisma } from "@prisma/client";
import { AppError } from "../lib/AppError.js";
import { safeAuditEntry } from "../lib/audit-policy.js";
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

  async reserveStart(data: Prisma.WorkflowStartIntentUncheckedCreateInput) {
    try { return await this.db.workflowStartIntent.upsert({where:{workflowId:data.workflowId},update:{},create:data}); }
    catch(error) { if((error as {code?:string}).code!=="P2002")throw error;
      return this.db.workflowStartIntent.findUniqueOrThrow({where:{workflowId:data.workflowId}}); }
  }
  findIntent(workflowId: string) { return this.db.workflowStartIntent.findUnique({where:{workflowId}}); }
  listPendingIntents(orgId: string, take=25) { return this.db.workflowStartIntent.findMany({where:{orgId,state:"PENDING",deletedAt:null},take,orderBy:{createdAt:"asc"}}); }
  async createOrFind(data: Prisma.WorkflowExecutionUncheckedCreateInput) {
    const validate = (row: {orgId:string;runId:string|null;workflowDefinitionId:string;startedById:string;deletedAt:Date|null}) => {
      if(row.deletedAt || row.orgId!==data.orgId || row.workflowDefinitionId!==data.workflowDefinitionId || row.startedById!==data.startedById || row.runId!==data.runId) throw AppError.conflict("Workflow projection identity mismatch");
      return row;
    };
    try { return await this.db.$transaction(async tx => {
      const execution=await tx.workflowExecution.create({data});
      const audit=safeAuditEntry({actorId:data.startedById,action:"workflowExecution.created",entityType:"WorkflowExecution",entityId:execution.id,changes:{after:{workflowId:data.workflowId,runId:data.runId,status:data.status}}});
      await tx.auditLog.create({data:{...audit,changes:audit.changes as Prisma.InputJsonObject}});
      await tx.workflowStartIntent.updateMany({where:{workflowId:data.workflowId,orgId:data.orgId,deletedAt:null},data:{state:"STARTED",runId:data.runId}});
      return {execution,created:true};
    }); } catch(error) {
      if((error as {code?:string}).code!=="P2002")throw error;
      const execution=await this.db.workflowExecution.findUnique({where:{workflowId:data.workflowId}});
      if(!execution)throw error; validate(execution);
      await this.db.workflowStartIntent.updateMany({where:{workflowId:data.workflowId,orgId:data.orgId,deletedAt:null},data:{state:"STARTED",runId:data.runId}});
      return {execution,created:false};
    }
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
