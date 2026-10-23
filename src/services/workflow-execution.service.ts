import { WorkflowCapability, WorkflowExecutionStatus, type Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { stableHash } from "../lib/stable-hash.js";
import { sealIntent, openIntent } from "../lib/temporalPayload.js";
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
  operationId?: string;
}

export interface EnsureWorkflowExecutionProjectionInput {
  orgId: string;
  workflowDefinitionKey: string;
  startedById: string;
  workflowId: string;
  runId?: string;
  scheduleId?: string;
  actionProtocol?: string;
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
      operationId: randomUUID(),
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
    const workflowId = this.buildWorkflowId(context.activeOrg.id, definition.key, businessKey ?? input.operationId);
    const requestHash = stableHash({input:validatedInput,actor:actor.userId,definition:definition.id});
    if(Buffer.byteLength(JSON.stringify(validatedInput))>131072)throw AppError.badRequest("Workflow input exceeds 128 KiB");
    const args=[validatedInput,{orgId:context.activeOrg.id,startedById:actor.userId,workflowDefinitionKey:definition.key,actionProtocol:"update-v1"}];
    const intent=await this.executions.reserveStart({workflowId,orgId:context.activeOrg.id,workflowDefinitionId:definition.id,startedById:actor.userId,requestHash,
      envelope:await sealIntent({workflowType:definition.workflowType,taskQueue:definition.defaultTaskQueue,args,businessKey,inputSummary:this.summarizeInput(registration,validatedInput)})});
    if(intent.deletedAt || intent.orgId!==context.activeOrg.id || intent.startedById!==actor.userId || intent.workflowDefinitionId!==definition.id || intent.requestHash!==requestHash)throw AppError.conflict("Workflow start identity belongs to different input or actor");
    return this.recoverIntent(intent);
  }

  private async recoverIntent(intent: Awaited<ReturnType<WorkflowExecutionModel["reserveStart"]>>) {
    const stored=await openIntent(intent.envelope);
    const started=await this.temporal.startWorkflow({workflowType:stored.workflowType,taskQueue:stored.taskQueue,workflowId:intent.workflowId,requestHash:intent.requestHash,args:stored.args});
    const {execution}=await this.executions.createOrFind({orgId:intent.orgId,workflowDefinitionId:intent.workflowDefinitionId,startedById:intent.startedById,
      workflowId:started.workflowId,runId:started.runId,businessKey:stored.businessKey,status:WorkflowExecutionStatus.RUNNING,inputSummary:stored.inputSummary,
      actionProtocol:"update-v1",stateSummary:{},startedAt:new Date(),lastSyncedAt:new Date()});
    return execution;
  }

  async recoverPendingStarts(actor: WorkflowActor, orgId?:string) {
    const context=await this.requireActiveOrg(actor.userId,orgId);await this.assertGlobalPermission(actor.roleId,"start");
    const pending=await this.executions.listPendingIntents(context.activeOrg.id);
    const results=[];
    for(const intent of pending) {
      if(intent.startedById!==actor.userId)continue;
      const stored=await openIntent(intent.envelope);
      const definition=await this.catalog.getByKey(stored.args[1].workflowDefinitionKey);
      if(!definition.isEnabled)continue;
      this.assertDefinitionCapability(definition,actor.roleId,[WorkflowCapability.START]);
      results.push(await this.recoverIntent(intent));
    }
    return results;
  }

  async ensureStartedProjection(input: EnsureWorkflowExecutionProjectionInput) {
    const definition=await this.catalog.getByKey(input.workflowDefinitionKey); const registration=this.getRegistration(definition.key);
    const validated=registration.validateStart(input.input);
    return this.executions.createOrFind({orgId:input.orgId,workflowDefinitionId:definition.id,startedById:input.startedById,workflowId:input.workflowId,
      runId:input.runId,businessKey:this.extractBusinessKey(validated),status:WorkflowExecutionStatus.RUNNING,inputSummary:this.summarizeProjectionInput(registration,validated,input.scheduleId),
      actionProtocol:input.actionProtocol ?? "signal-v1",stateSummary:{},startedAt:new Date(),lastSyncedAt:new Date()});
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
    const updated = await this.executions.update(execution.id, { stateSummary: { cancelRequested: true } });

    await this.audit.record({
      actorId: actor.userId,
      action: "workflowExecution.cancel",
      entityType: "WorkflowExecution",
      entityId: execution.id,
      changes: {
        before: { status: execution.status },
        after: { status: execution.status, code:"CANCELLATION_REQUESTED" },
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
    let businessOutcome="UNKNOWN";
    let syncErrorCode:string|null=null;
    if(status===WorkflowExecutionStatus.COMPLETED) {
      const result=await this.temporal.workflowResult(execution.workflowId,execution.runId ?? undefined) as {businessOutcome?:string}|null;
      if(result && ["SUCCEEDED","REJECTED","CANCELLED","UNKNOWN"].includes(result.businessOutcome ?? ""))businessOutcome=result.businessOutcome!;
    } else if(status===WorkflowExecutionStatus.CANCELED)businessOutcome="CANCELLED";
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
        syncErrorCode="STATE_QUERY_UNAVAILABLE";
        this.log.warn({ err, workflowId: execution.workflowId }, "Workflow state query failed during refresh");
      }
    }

    return this.executions.updateStatus(execution.id, status, {
      stateSummary, businessOutcome, syncErrorCode,
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


}

export const workflowExecutionService = new WorkflowExecutionService();

export function getStartRegistrationBySlug(slug: string) {
  return getWorkflowRegistrationBySlug(slug);
}
