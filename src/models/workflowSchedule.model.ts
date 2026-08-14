import type { Prisma } from "@prisma/client";
import { WorkflowScheduleStatus } from "@prisma/client";
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";

export class WorkflowScheduleModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  listForOrg(orgId: string, params: ListParams) {
    const where: Prisma.WorkflowScheduleWhereInput = {
      orgId,
      ...this.notDeleted,
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" } },
              { scheduleId: { contains: params.search, mode: "insensitive" } },
              { cronExpression: { contains: params.search, mode: "insensitive" } },
              { workflowDefinition: { name: { contains: params.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    return this.db.workflowSchedule.findMany({
      where,
      include: {
        workflowDefinition: true,
        createdBy: { select: { id: true, name: true, email: true } },
        org: true,
      },
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
    });
  }

  countForOrg(orgId: string, search?: string) {
    return this.db.workflowSchedule.count({
      where: {
        orgId,
        ...this.notDeleted,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { scheduleId: { contains: search, mode: "insensitive" } },
                { cronExpression: { contains: search, mode: "insensitive" } },
                { workflowDefinition: { name: { contains: search, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
    });
  }

  countByStatusForOrg(orgId: string) {
    return this.db.workflowSchedule.groupBy({
      by: ["status"],
      where: { orgId, ...this.notDeleted },
      _count: { _all: true },
    });
  }

  findByIdInOrg(id: string, orgId: string) {
    return this.db.workflowSchedule.findFirst({
      where: { id, orgId, ...this.notDeleted },
      include: {
        workflowDefinition: {
          include: {
            roles: { where: { deletedAt: null }, include: { role: true } },
            integrationRequirements: { where: { deletedAt: null }, orderBy: { key: "asc" } },
          },
        },
        createdBy: { select: { id: true, name: true, email: true } },
        org: true,
      },
    });
  }

  findByNameInOrg(name: string, orgId: string) {
    return this.db.workflowSchedule.findFirst({
      where: { name, orgId, ...this.notDeleted },
    });
  }

  findByScheduleId(scheduleId: string) {
    return this.db.workflowSchedule.findFirst({
      where: { scheduleId, ...this.notDeleted },
      include: {
        workflowDefinition: true,
        createdBy: { select: { id: true, name: true, email: true } },
        org: true,
      },
    });
  }

  create(data: Prisma.WorkflowScheduleUncheckedCreateInput) {
    return this.db.workflowSchedule.create({
      data,
      include: {
        workflowDefinition: true,
        createdBy: { select: { id: true, name: true, email: true } },
        org: true,
      },
    });
  }

  update(id: string, data: Prisma.WorkflowScheduleUpdateInput) {
    return this.db.workflowSchedule.update({
      where: { id },
      data,
      include: {
        workflowDefinition: true,
        createdBy: { select: { id: true, name: true, email: true } },
        org: true,
      },
    });
  }

  markDeleted(id: string) {
    return this.update(id, {
      status: WorkflowScheduleStatus.DELETED,
      deletedAt: new Date(),
    });
  }
}

export const workflowScheduleModel = new WorkflowScheduleModel();
