import { WorkflowCapability, type Prisma } from "@prisma/client";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { WorkflowDefinitionModel, workflowDefinitionModel } from "../models/workflowDefinition.model.js";
import { RoleModel, roleModel } from "../models/role.model.js";
import { auditService, AuditService } from "./audit.service.js";
import { permissionsService, PermissionsService } from "./permissions.service.js";
import {
  validateWorkflowRegistry,
  workflowRegistrations,
  type WorkflowTypeRegistration,
} from "../temporal/workflow-registry.js";
import type { ListParams } from "../lib/query.js";
import {
  OrganizationContextService,
  organizationContextService,
} from "./organizationContext.service.js";

export const WORKFLOW_CAPABILITIES = [
  WorkflowCapability.START,
  WorkflowCapability.VIEW,
  WorkflowCapability.ACT,
  WorkflowCapability.CANCEL,
  WorkflowCapability.ADMIN,
] as const;

export type WorkflowCapabilityValue = (typeof WORKFLOW_CAPABILITIES)[number];

export class WorkflowCatalogService extends BaseService {
  constructor(
    private readonly model: WorkflowDefinitionModel = workflowDefinitionModel,
    private readonly roles: RoleModel = roleModel,
    private readonly audit: AuditService = auditService,
    private readonly permissions: PermissionsService = permissionsService,
    private readonly orgContext: OrganizationContextService = organizationContextService
  ) {
    super("WorkflowCatalogService");
  }

  async syncCodeRegistrations(registrations: WorkflowTypeRegistration[] = workflowRegistrations) {
    const validRegistrations = validateWorkflowRegistry(registrations);
    const synced = [];

    for (const registration of validRegistrations) {
      const definition = await this.model.upsertCodeFacts({
        key: registration.key,
        slug: registration.slug,
        workflowType: registration.workflowType,
        contractVersion: registration.contractVersion,
        defaultTaskQueue: registration.taskQueue,
        name: registration.name,
        description: registration.description,
        category: registration.category,
        icon: registration.icon,
      });

      await this.model.syncIntegrationRequirements(
        definition.id,
        registration.integrationRequirements.map((requirement) => ({
          workflowDefinitionId: definition.id,
          key: requirement.key,
          providerKey: requirement.providerKey,
          capabilityKey: requirement.capabilityKey,
          label: requirement.label,
          description: requirement.description,
          isRequired: requirement.isRequired ?? true,
        }))
      );

      synced.push(definition);
    }

    return synced;
  }

  list(params: ListParams) {
    return this.model.list(params);
  }

  count(search?: string) {
    return this.model.count(search);
  }

  listRoles() {
    return this.roles.listAll();
  }

  async getById(id: string) {
    const definition = await this.model.findById(id);
    if (!definition) throw AppError.notFound("Workflow definition");
    return definition;
  }

  async getBySlug(slug: string) {
    const definition = await this.model.findBySlug(slug);
    if (!definition) throw AppError.notFound("Workflow definition");
    return definition;
  }

  async getByKey(key: string) {
    const definition = await this.model.findByKey(key);
    if (!definition) throw AppError.notFound("Workflow definition");
    return definition;
  }

  async updateAdminMetadata(
    id: string,
    data: {
      name: string;
      description?: string | null;
      category?: string | null;
      icon?: string | null;
      isEnabled: boolean;
      presentation: Prisma.InputJsonValue;
    },
    actorId?: string
  ) {
    const before = await this.getById(id);
    const updated = await this.model.update(id, data);

    await this.audit.record({
      actorId,
      action: "workflowDefinition.update",
      entityType: "WorkflowDefinition",
      entityId: id,
      changes: {
        before: {
          name: before.name,
          description: before.description,
          category: before.category,
          icon: before.icon,
          isEnabled: before.isEnabled,
          presentation: before.presentation,
        },
        after: data,
      },
    });

    return updated;
  }

  async replaceRolePolicy(
    id: string,
    entries: Array<{ roleId: string; capability: WorkflowCapabilityValue }>,
    actorId?: string
  ) {
    const before = await this.getById(id);
    const validRoleIds = new Set((await this.roles.listAll()).map((role) => role.id));
    const validCapabilities = new Set<WorkflowCapabilityValue>(WORKFLOW_CAPABILITIES);
    const cleaned = entries.filter(
      (entry) => validRoleIds.has(entry.roleId) && validCapabilities.has(entry.capability)
    );

    await this.model.replaceRolePolicy(id, cleaned);
    const after = await this.getById(id);

    await this.audit.record({
      actorId,
      action: "workflowDefinition.roles.update",
      entityType: "WorkflowDefinition",
      entityId: id,
      changes: {
        before: before.roles.map((role) => ({ roleId: role.roleId, capability: role.capability })),
        after: after.roles.map((role) => ({ roleId: role.roleId, capability: role.capability })),
      },
    });

    return after;
  }

  async getCatalogForUser(userId: string, roleId: string, requestedOrgId?: string) {
    const org = await this.orgContext.resolveForUser(userId, requestedOrgId);

    if (!org.activeOrg) {
      return { ...org, workflows: [] };
    }

    const canRead = await this.permissions.can(roleId, "workflow", "read");
    if (!canRead) {
      throw AppError.forbidden("Missing permission: workflow:read");
    }

    const workflows = await this.model.listEnabledForRole(roleId, [
      WorkflowCapability.VIEW,
      WorkflowCapability.START,
    ]);

    return { ...org, workflows };
  }
}

export const workflowCatalogService = new WorkflowCatalogService();
