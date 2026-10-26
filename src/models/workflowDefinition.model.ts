import { WorkflowCapability, type Prisma } from "@prisma/client";
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";

export class WorkflowDefinitionModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.WorkflowDefinitionWhereInput = {
      ...this.notDeleted,
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" } },
              { key: { contains: params.search, mode: "insensitive" } },
              { description: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    return this.db.workflowDefinition.findMany({
      where,
      include: {
        roles: { where: this.notDeleted, include: { role: true } },
        integrationRequirements: { where: this.notDeleted, orderBy: { key: "asc" } },
      },
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
    });
  }

  count(search?: string) {
    return this.db.workflowDefinition.count({
      where: {
        ...this.notDeleted,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { key: { contains: search, mode: "insensitive" } },
                { description: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    });
  }

  listEnabledForRole(roleId: string, capabilities: WorkflowCapability[]) {
    return this.db.workflowDefinition.findMany({
      where: {
        ...this.notDeleted,
        isEnabled: true,
        roles: {
          some: {
            roleId,
            capability: { in: capabilities },
            deletedAt: null,
          },
        },
      },
      include: {
        roles: { where: { deletedAt: null, roleId }, include: { role: true } },
        integrationRequirements: { where: this.notDeleted, orderBy: { key: "asc" } },
      },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  findById(id: string) {
    return this.db.workflowDefinition.findFirst({
      where: { id, ...this.notDeleted },
      include: {
        roles: { where: this.notDeleted, include: { role: true }, orderBy: [{ role: { name: "asc" } }, { capability: "asc" }] },
        integrationRequirements: { where: this.notDeleted, orderBy: { key: "asc" } },
      },
    });
  }

  findBySlug(slug: string) {
    return this.db.workflowDefinition.findFirst({
      where: { slug, ...this.notDeleted },
      include: {
        roles: { where: this.notDeleted, include: { role: true } },
        integrationRequirements: { where: this.notDeleted, orderBy: { key: "asc" } },
      },
    });
  }

  findByKey(key: string) {
    return this.db.workflowDefinition.findFirst({
      where: { key, ...this.notDeleted },
      include: {
        roles: { where: this.notDeleted, include: { role: true } },
        integrationRequirements: { where: this.notDeleted, orderBy: { key: "asc" } },
      },
    });
  }

  upsertCodeFacts(data: Prisma.WorkflowDefinitionUncheckedCreateInput, actorId?: string) {
    return this.mutate("workflowDefinition.upsertCodeFacts", "WorkflowDefinition", actorId, tx => tx.workflowDefinition.upsert({
      where: { key: data.key },
      update: {
        slug: data.slug,
        workflowType: data.workflowType,
        contractVersion: data.contractVersion,
        defaultTaskQueue: data.defaultTaskQueue,
        name: data.name,
        description: data.description,
        category: data.category,
        icon: data.icon,
        deletedAt: null,
      },
      create: data,
    }));
  }

  update(id: string, data: Prisma.WorkflowDefinitionUpdateInput, actorId?: string) {
    return this.mutate("workflowDefinition.update", "WorkflowDefinition", actorId, tx => tx.workflowDefinition.update({ where: { id }, data }), id);
  }

  softDelete(id: string, actorId?: string) {
    return this.mutate("workflowDefinition.softDelete", "WorkflowDefinition", actorId, tx => tx.workflowDefinition.update({
      where: { id },
      data: { deletedAt: new Date() },
    }), id);
  }

  async syncIntegrationRequirements(
    workflowDefinitionId: string,
    requirements: Prisma.WorkflowIntegrationRequirementUncheckedCreateInput[]
  ) {
    await this.mutate("workflowDefinition.requirements", "WorkflowDefinition", undefined, async tx => {
    const keys = requirements.map((requirement) => requirement.key);

    await tx.workflowIntegrationRequirement.updateMany({
      where: {
        workflowDefinitionId,
        key: { notIn: keys.length ? keys : [""] },
        deletedAt: null,
      },
      data: { deletedAt: new Date() },
    });

    for (const requirement of requirements) {
      await tx.workflowIntegrationRequirement.upsert({
        where: {
          workflowDefinitionId_key: {
            workflowDefinitionId,
            key: requirement.key,
          },
        },
        update: {
          providerKey: requirement.providerKey,
          capabilityKey: requirement.capabilityKey,
          label: requirement.label,
          description: requirement.description,
          isRequired: requirement.isRequired,
          deletedAt: null,
        },
        create: requirement,
      });
    }
      return { id: workflowDefinitionId };
    }, workflowDefinitionId);
  }

  async replaceRolePolicy(
    workflowDefinitionId: string,
    entries: Array<{ roleId: string; capability: WorkflowCapability }>, actorId?: string
  ) {
    await this.mutate("workflowDefinition.role_policy", "WorkflowDefinition", actorId, async tx => {
      await tx.workflowDefinitionRole.updateMany({
        where: { workflowDefinitionId, deletedAt: null },
        data: { deletedAt: new Date() },
      });

      for (const entry of entries) {
        await tx.workflowDefinitionRole.upsert({
          where: {
            workflowDefinitionId_roleId_capability: {
              workflowDefinitionId,
              roleId: entry.roleId,
              capability: entry.capability,
            },
          },
          update: { deletedAt: null },
          create: { workflowDefinitionId, roleId: entry.roleId, capability: entry.capability },
        });
      }
      return { id: workflowDefinitionId };
    }, workflowDefinitionId);
  }
}

export const workflowDefinitionModel = new WorkflowDefinitionModel();
