import { WorkflowCapability, WorkflowExecutionStatus, type Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import {
  TemporalClientGateway,
  temporalClientGateway,
  type TemporalDescribeResult,
} from "../lib/temporalClient.js";
import {
  WorkflowExecutionModel,
  workflowExecutionModel,
} from "../models/workflowExecution.model.js";
import {
  workflowCatalogService,
  WorkflowCatalogService,
} from "./workflow-catalog.service.js";
import {
  OrganizationContextService,
  organizationContextService,
} from "./organizationContext.service.js";
import { permissionsService, PermissionsService } from "./permissions.service.js";
import { auditService, AuditService } from "./audit.service.js";
import {
  integrationService,
  IntegrationService,
} from "./integration.service.js";
import {
  getWorkflowRegistration,
  getWorkflowRegistrationBySlug,
  type WorkflowTypeRegistration,
} from "../temporal/workflow-registry.js";
import type { ListParams } from "../lib/query.js";

const TERMINAL_STATUSES = new Set<WorkflowExecutionStatus>([
  WorkflowExecutionStatus.COMPLETED,
  WorkflowExecutionStatus.FAILED,
  WorkflowExecutionStatus.CANCELED,
  WorkflowExecutionStatus.TERMINATED,
  WorkflowExecutionStatus.TIMED_OUT,
]);

export interface WorkflowActor {
  userId: string;
  roleId: string;
}

export interface StartWorkflowInput {
  slug: string;
  orgId?: string;
  input: unknown;
}

export interface EnsureWorkflowExecutionProjectionInput {
  orgId: string;
  workflowDefinitionKey: string;
  startedById: string;
  workflowId: string;
  runId?: string;
  scheduleId?: string;
  input: unknown;
}

export class WorkflowExecutionService extends BaseService {
  constructor(
    private readonly executions: WorkflowExecutionModel = workflowExecutionModel,
    private readonly catalog: WorkflowCatalogService = workflowCatalogService,
    private readonly orgContext: OrganizationContextService = organizationContextService,
    private readonly permissions: PermissionsService = permissionsService,
    private readonly temporal: TemporalClientGateway = temporalClientGateway,
    private readonly audit: AuditService = auditService,
    private readonly integrations: IntegrationService = integrationService
  ) {
    super("WorkflowExecutionService");
  }

  async getStartPage(actor: WorkflowActor, slug: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertGlobalPermission(actor.roleId, "read");

    const definition = await this.catalog.getBySlug(slug);
    if (!definition.isEnabled) throw AppError.forbidden("Workflow is not enabled");
    const registration = this.getRegistration(definition.key);
    this.assertDefinitionCapability(definition, actor.roleId, [WorkflowCapability.VIEW, WorkflowCapability.START]);
    const integrationStatuses = await this.integrations.getRequirementStatuses(context.activeOrg.id, definition);
    const allRequiredIntegrationsAvailable = integrationStatuses.every(
      (item) => !item.requirement.isRequired || item.available
    );

    return {
      ...context,
      definition,
      registration,
      integrationStatuses,
      allRequiredIntegrationsAvailable,
      canStart:
        this.hasDefinitionCapability(definition, actor.roleId, WorkflowCapability.START) &&
        allRequiredIntegrationsAvailable,
    };
  }

  async listForUser(actor: WorkflowActor, orgId: string | undefined, params: ListParams) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertGlobalPermission(actor.roleId, "read");

    const [executions, total] = await Promise.all([
      this.executions.listForOrgAndRole(context.activeOrg.id, actor.roleId, params),
      this.executions.countForOrgAndRole(context.activeOrg.id, actor.roleId, params.search),
    ]);

    return { ...context, executions, total };
  }

  async start(actor: WorkflowActor, input: StartWorkflowInput) {
    const context = await this.requireActiveOrg(actor.userId, input.orgId);
    await this.assertGlobalPermission(actor.roleId, "start");

    const definition = await this.catalog.getBySlug(input.slug);
    if (!definition.isEnabled) throw AppError.forbidden("Workflow is not enabled");
    this.assertDefinitionCapability(definition, actor.roleId, [WorkflowCapability.START]);

    const registration = this.getRegistration(definition.key);
    const validatedInput = registration.validateStart(input.input);
    const integrationStatuses = await this.integrations.getRequirementStatuses(context.activeOrg.id, definition);
    this.integrations.assertRequiredBindingsAvailable(integrationStatuses);
    const businessKey = this.extractBusinessKey(validatedInput);
    const workflowId = this.buildWorkflowId(context.activeOrg.id, definition.key, businessKey);

    const existing = await this.executions.findByWorkflowIdInOrg(workflowId, context.activeOrg.id);
    if (existing && !TERMINAL_STATUSES.has(existing.status)) {
      throw AppError.conflict("A workflow execution already exists for this business key");
    }
    if (existing) {
      throw AppError.conflict("Workflow execution IDs are not reused by the application projection");
    }

    const started = await this.temporal.startWorkflow({
      workflowType: definition.workflowType,
      taskQueue: definition.defaultTaskQueue,
      workflowId,
      args: [
        validatedInput,
        {
          orgId: context.activeOrg.id,
          startedById: actor.userId,
          workflowDefinitionKey: definition.key,
        },
      ],
    });

    const created = await this.executions.create({
      orgId: context.activeOrg.id,
      workflowDefinitionId: definition.id,
      startedById: actor.userId,
      workflowId: started.workflowId,
      runId: started.runId,
      businessKey,
      status: WorkflowExecutionStatus.RUNNING,
      inputSummary: this.summarizeInput(registration, validatedInput),
      stateSummary: {},
      startedAt: new Date(),
    });

    await this.audit.record({
      actorId: actor.userId,
      action: "workflowExecution.start",
      entityType: "WorkflowExecution",
      entityId: created.id,
      changes: {
        after: {
          orgId: context.activeOrg.id,
          workflowDefinitionId: definition.id,
          workflowId: started.workflowId,
          runId: started.runId,
          businessKey,
        },
      },
    });

    return created;
  }

  async ensureStartedProjection(input: EnsureWorkflowExecutionProjectionInput) {
    const existing = await this.executions.findByWorkflowIdInOrg(input.workflowId, input.orgId);
    if (existing) return { execution: existing, created: false };

    const definition = await this.catalog.getByKey(input.workflowDefinitionKey);
    const registration = this.getRegistration(definition.key);
    const validatedInput = registration.validateStart(input.input);
    const businessKey = this.extractBusinessKey(validatedInput);

    try {
      const created = await this.executions.create({
        orgId: input.orgId,
        workflowDefinitionId: definition.id,
        startedById: input.startedById,
        workflowId: input.workflowId,
        runId: input.runId,
        businessKey,
        status: WorkflowExecutionStatus.RUNNING,
        inputSummary: this.summarizeProjectionInput(registration, validatedInput, input.scheduleId),
        stateSummary: {},
        startedAt: new Date(),
        lastSyncedAt: new Date(),
      });

      await this.audit.record({
        actorId: input.startedById,
        action: input.scheduleId ? "workflowExecution.ingestScheduledStart" : "workflowExecution.ingestStart",
        entityType: "WorkflowExecution",
        entityId: created.id,
        changes: {
          after: {
            orgId: input.orgId,
            workflowDefinitionId: definition.id,
            workflowId: input.workflowId,
            runId: input.runId,
            businessKey,
            scheduleId: input.scheduleId ?? null,
          },
        },
      });

      return { execution: created, created: true };
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        const raced = await this.executions.findByWorkflowIdInOrg(input.workflowId, input.orgId);
        if (raced) return { execution: raced, created: false };
      }
      throw err;
    }
  }

  async getDetail(actor: WorkflowActor, id: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertGlobalPermission(actor.roleId, "read");

    const execution = await this.getAuthorizedExecution(id, context.activeOrg.id, actor.roleId, [
      WorkflowCapability.VIEW,
      WorkflowCapability.START,
    ]);

    const refreshed = await this.refreshProjection(execution.id, context.activeOrg.id, actor.roleId);

    return { ...context, execution: refreshed };
  }

  async refresh(actor: WorkflowActor, id: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertGlobalPermission(actor.roleId, "read");
    return this.refreshProjection(id, context.activeOrg.id, actor.roleId);
  }

  async cancel(actor: WorkflowActor, id: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertGlobalPermission(actor.roleId, "cancel");

    const execution = await this.getAuthorizedExecution(id, context.activeOrg.id, actor.roleId, [
      WorkflowCapability.CANCEL,
    ]);

    if (TERMINAL_STATUSES.has(execution.status)) {
      throw AppError.conflict("Workflow execution is already closed");
    }

    await this.temporal.cancelWorkflow(execution.workflowId, execution.runId ?? undefined);
    const updated = await this.executions.updateStatus(execution.id, WorkflowExecutionStatus.CANCELED);

    await this.audit.record({
      actorId: actor.userId,
      action: "workflowExecution.cancel",
      entityType: "WorkflowExecution",
      entityId: execution.id,
      changes: {
        before: { status: execution.status },
        after: { status: WorkflowExecutionStatus.CANCELED },
      },
    });

    return updated;
  }

  async refreshProjection(id: string, orgId: string, roleId: string) {
    const execution = await this.getAuthorizedExecution(id, orgId, roleId, [
      WorkflowCapability.VIEW,
      WorkflowCapability.START,
    ]);
    const registration = this.getRegistration(execution.workflowDefinition.key);

    const describe = await this.temporal.describeWorkflow(execution.workflowId, execution.runId ?? undefined);
    const status = this.mapTemporalStatus(describe);
    let stateSummary: Prisma.InputJsonValue = execution.stateSummary as Prisma.InputJsonValue;

    if (registration.stateQuery) {
      try {
        const state = await this.temporal.queryWorkflow(
          execution.workflowId,
          registration.stateQuery,
          execution.runId ?? undefined
        );
        stateSummary = registration.summarizeState(state) as Prisma.InputJsonObject;
      } catch (err) {
        this.log.warn({ err, workflowId: execution.workflowId }, "Workflow state query failed during refresh");
      }
    }

    return this.executions.updateStatus(execution.id, status, {
      stateSummary,
      completedAt: TERMINAL_STATUSES.has(status) ? describe.closeTime ?? new Date() : null,
    });
  }

  private async requireActiveOrg(userId: string, orgId?: string) {
    const context = await this.orgContext.resolveForUser(userId, orgId);
    if (!context.activeOrg) {
      throw AppError.badRequest("Select an organization before using workflows");
    }
    return {
      ...context,
      activeOrg: context.activeOrg,
    };
  }

  private async assertGlobalPermission(roleId: string, action: string) {
    const allowed = await this.permissions.can(roleId, "workflow", action);
    if (!allowed) throw AppError.forbidden(`Missing permission: workflow:${action}`);
  }

  private async getAuthorizedExecution(
    id: string,
    orgId: string,
    roleId: string,
    capabilities: WorkflowCapability[]
  ) {
    const execution = await this.executions.findByIdInOrg(id, orgId);
    if (!execution) throw AppError.notFound("Workflow execution");

    this.assertDefinitionCapability(execution.workflowDefinition, roleId, capabilities);
    return execution;
  }

  private getRegistration(key: string): WorkflowTypeRegistration {
    const registration = getWorkflowRegistration(key);
    if (!registration) throw AppError.notFound("Workflow registration");
    return registration;
  }

  private assertDefinitionCapability(
    definition: { roles: Array<{ roleId: string; capability: WorkflowCapability }> },
    roleId: string,
    capabilities: WorkflowCapability[]
  ) {
    if (!capabilities.some((capability) => this.hasDefinitionCapability(definition, roleId, capability))) {
      throw AppError.forbidden("Role is not allowed to use this workflow");
    }
  }

  private hasDefinitionCapability(
    definition: { roles: Array<{ roleId: string; capability: WorkflowCapability }> },
    roleId: string,
    capability: WorkflowCapability
  ) {
    return definition.roles.some((entry) => entry.roleId === roleId && entry.capability === capability);
  }

  private extractBusinessKey(input: unknown) {
    if (input && typeof input === "object" && "businessKey" in input) {
      const value = (input as { businessKey?: unknown }).businessKey;
      return typeof value === "string" && value.trim() ? value.trim() : undefined;
    }
    return undefined;
  }

  private buildWorkflowId(orgId: string, workflowKey: string, businessKey?: string) {
    const suffix = businessKey ? this.slugPart(businessKey) : randomUUID();
    return `org-${this.slugPart(orgId)}.${this.slugPart(workflowKey)}.${suffix}`;
  }

  private slugPart(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9-_.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
  }

  private summarizeInput(registration: WorkflowTypeRegistration, input: unknown): Prisma.InputJsonValue {
    if (registration.summarizeInput) return registration.summarizeInput(input) as Prisma.InputJsonObject;
    if (input && typeof input === "object") return input as Prisma.InputJsonObject;
    return {};
  }

  private summarizeProjectionInput(
    registration: WorkflowTypeRegistration,
    input: unknown,
    scheduleId?: string
  ): Prisma.InputJsonObject {
    const summary = this.summarizeInput(registration, input);
    const base =
      summary && typeof summary === "object" && !Array.isArray(summary)
        ? summary as Prisma.InputJsonObject
        : { value: summary };
    return { ...base, scheduleId: scheduleId ?? null };
  }

  private mapTemporalStatus(describe: TemporalDescribeResult): WorkflowExecutionStatus {
    switch (describe.statusName) {
      case "RUNNING":
      case "CONTINUED_AS_NEW":
      case "PAUSED":
        return WorkflowExecutionStatus.RUNNING;
      case "COMPLETED":
        return WorkflowExecutionStatus.COMPLETED;
      case "FAILED":
        return WorkflowExecutionStatus.FAILED;
      case "CANCELLED":
        return WorkflowExecutionStatus.CANCELED;
      case "TERMINATED":
        return WorkflowExecutionStatus.TERMINATED;
      case "TIMED_OUT":
        return WorkflowExecutionStatus.TIMED_OUT;
      default:
        return WorkflowExecutionStatus.UNKNOWN;
    }
  }

  private isUniqueConstraintError(err: unknown) {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "P2002"
    );
  }
}

export const workflowExecutionService = new WorkflowExecutionService();

export function getStartRegistrationBySlug(slug: string) {
  return getWorkflowRegistrationBySlug(slug);
}
