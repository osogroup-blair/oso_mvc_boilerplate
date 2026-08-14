import type { Prisma } from "@prisma/client";
import { BaseModel } from "./BaseModel.js";

const safeBindingInclude = {
  connection: {
    select: {
      id: true,
      orgId: true,
      name: true,
      providerKey: true,
      status: true,
      credentialFingerprint: true,
      lastTestedAt: true,
      lastTestStatus: true,
      lastTestMessage: true,
      disabledAt: true,
    },
  },
} satisfies Prisma.WorkflowIntegrationBindingInclude;

export class WorkflowIntegrationBindingModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  listForWorkflow(orgId: string, workflowDefinitionId: string) {
    return this.db.workflowIntegrationBinding.findMany({
      where: { orgId, workflowDefinitionId, ...this.notDeleted },
      include: safeBindingInclude,
      orderBy: { requirementKey: "asc" },
    });
  }

  findByIdInOrg(id: string, orgId: string) {
    return this.db.workflowIntegrationBinding.findFirst({
      where: { id, orgId, ...this.notDeleted },
      include: safeBindingInclude,
    });
  }

  findForRequirement(orgId: string, workflowDefinitionKey: string, requirementKey: string) {
    return this.db.workflowIntegrationBinding.findFirst({
      where: {
        orgId,
        requirementKey,
        deletedAt: null,
        workflowDefinition: { key: workflowDefinitionKey, deletedAt: null },
      },
      include: {
        connection: true,
        workflowDefinition: {
          include: {
            integrationRequirements: {
              where: { key: requirementKey, deletedAt: null },
            },
          },
        },
      },
    });
  }

  upsert(data: {
    orgId: string;
    workflowDefinitionId: string;
    requirementKey: string;
    connectionId: string;
    isEnabled: boolean;
  }) {
    return this.db.workflowIntegrationBinding.upsert({
      where: {
        orgId_workflowDefinitionId_requirementKey: {
          orgId: data.orgId,
          workflowDefinitionId: data.workflowDefinitionId,
          requirementKey: data.requirementKey,
        },
      },
      update: {
        connectionId: data.connectionId,
        isEnabled: data.isEnabled,
        deletedAt: null,
      },
      create: data,
      include: safeBindingInclude,
    });
  }

  update(id: string, data: Prisma.WorkflowIntegrationBindingUpdateInput) {
    return this.db.workflowIntegrationBinding.update({
      where: { id },
      data,
      include: safeBindingInclude,
    });
  }

  softDelete(id: string) {
    return this.db.workflowIntegrationBinding.update({
      where: { id },
      data: { deletedAt: new Date(), isEnabled: false },
      include: safeBindingInclude,
    });
  }
}

export const workflowIntegrationBindingModel = new WorkflowIntegrationBindingModel();
