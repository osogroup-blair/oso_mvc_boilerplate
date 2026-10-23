import {
  WorkflowScheduleOverlapPolicy,
  WorkflowScheduleStatus,
  type Prisma,
} from "@prisma/client";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import {
  WorkflowScheduleModel,
  workflowScheduleModel,
} from "../models/workflowSchedule.model.js";
import {
  WorkflowCatalogService,
  workflowCatalogService,
} from "./workflow-catalog.service.js";
import {
  OrganizationContextService,
  organizationContextService,
} from "./organizationContext.service.js";
import { permissionsService, PermissionsService } from "./permissions.service.js";
import { auditService, AuditService } from "./audit.service.js";
import {
  TemporalClientGateway,
  temporalClientGateway,
  type TemporalScheduleDescription,
} from "../lib/temporalClient.js";
import {
  integrationService,
  IntegrationService,
} from "./integration.service.js";
import {
  getWorkflowRegistration,
  type WorkflowTypeRegistration,
} from "../temporal/workflow-registry.js";
import type { ListParams } from "../lib/query.js";

export interface WorkflowScheduleActor {
  userId: string;
  roleId: string;
}

export interface CreateWorkflowScheduleInput {
  orgId?: string;
  workflowDefinitionId: string;
  name: string;
  description?: string | null;
  cronExpression: string;
  timezone: string;
  input: Record<string, unknown>;
  overlapPolicy: WorkflowScheduleOverlapPolicy;
  catchupWindowSeconds: number;
  pauseOnFailure: boolean;
  paused: boolean;
}

export class WorkflowScheduleService extends BaseService {
  constructor(
    private readonly schedules: WorkflowScheduleModel = workflowScheduleModel,
    private readonly catalog: WorkflowCatalogService = workflowCatalogService,
    private readonly orgContext: OrganizationContextService = organizationContextService,
    private readonly permissions: PermissionsService = permissionsService,
    private readonly temporal: TemporalClientGateway = temporalClientGateway,
    private readonly audit: AuditService = auditService,
    private readonly integrations: IntegrationService = integrationService
  ) {
    super("WorkflowScheduleService");
  }

  async list(actor: WorkflowScheduleActor, orgId: string | undefined, params: ListParams) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const [schedules, total, counts] = await Promise.all([
      this.schedules.listForOrg(context.activeOrg.id, params),
      this.schedules.countForOrg(context.activeOrg.id, params.search),
      this.schedules.countByStatusForOrg(context.activeOrg.id),
    ]);

    return {
      ...context,
      schedules,
      total,
      counts: this.normalizeStatusCounts(counts),
    };
  }

  async getCreatePage(actor: WorkflowScheduleActor, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const definitions = await this.catalog.list({
      skip: 0,
      take: 500,
      search: undefined,
      orderBy: { name: "asc" },
    });

    return {
      ...context,
      definitions: definitions.filter((definition) => definition.isEnabled),
      overlapPolicies: Object.values(WorkflowScheduleOverlapPolicy),
    };
  }

  async getDetail(actor: WorkflowScheduleActor, id: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const schedule = await this.requireSchedule(id, context.activeOrg.id);
    const temporalDescription = await this.safeDescribeAndUpdate(schedule.id, schedule.scheduleId);

    return {
      ...context,
      schedule: temporalDescription.schedule,
      temporalDescription: temporalDescription.description,
      overlapPolicies: Object.values(WorkflowScheduleOverlapPolicy),
    };
  }

  async create(actor: WorkflowScheduleActor, input: CreateWorkflowScheduleInput) {
    const context = await this.requireActiveOrg(actor.userId, input.orgId);
    await this.assertCanAdmin(actor.roleId);
    this.assertCron(input.cronExpression);

    const existing = await this.schedules.findByNameInOrg(input.name.trim(), context.activeOrg.id);
    if (existing) throw AppError.conflict("Workflow schedule name already exists for this organization");

    const definition = await this.catalog.getById(input.workflowDefinitionId);
    if (!definition.isEnabled) throw AppError.conflict("Workflow definition must be enabled before it can be scheduled");
    const registration = this.requireRegistration(definition.key);
    const validatedInput = registration.validateStart(input.input);
    const integrationStatuses = await this.integrations.getRequirementStatuses(context.activeOrg.id, definition);
    this.integrations.assertRequiredBindingsAvailable(integrationStatuses);

    const scheduleId = this.buildScheduleId(context.activeOrg.id, definition.key, input.name);
    const temporalDescription = await this.temporal.createSchedule({
      scheduleId,
      workflowType: definition.workflowType,
      taskQueue: definition.defaultTaskQueue,
      args: [
        validatedInput,
        {
          orgId: context.activeOrg.id,
          startedById: actor.userId,
          workflowDefinitionKey: definition.key,
          actionProtocol: "update-v1",
          scheduleId,
        },
      ],
      cronExpression: input.cronExpression.trim(),
      timezone: input.timezone.trim() || "UTC",
      overlapPolicy: input.overlapPolicy,
      catchupWindowSeconds: input.catchupWindowSeconds,
      pauseOnFailure: input.pauseOnFailure,
      paused: input.paused,
      memo: {
        orgId: context.activeOrg.id,
        workflowDefinitionKey: definition.key,
        scheduleName: input.name.trim(),
      },
    });

    try {
      const created = await this.schedules.create({
        orgId: context.activeOrg.id,
        workflowDefinitionId: definition.id,
        createdById: actor.userId,
        scheduleId,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        cronExpression: input.cronExpression.trim(),
        timezone: input.timezone.trim() || "UTC",
        input: validatedInput as Prisma.InputJsonObject,
        inputSummary: this.summarizeInput(registration, validatedInput),
        status: temporalDescription.paused ? WorkflowScheduleStatus.PAUSED : WorkflowScheduleStatus.ACTIVE,
        overlapPolicy: input.overlapPolicy,
        catchupWindowSeconds: input.catchupWindowSeconds,
        pauseOnFailure: input.pauseOnFailure,
        lastTemporalStatus: this.temporalStatusJson(temporalDescription),
        lastSyncedAt: new Date(),
        pausedAt: temporalDescription.paused ? new Date() : null,
      });

      await this.audit.record({
        actorId: actor.userId,
        action: "workflowSchedule.create",
        entityType: "WorkflowSchedule",
        entityId: created.id,
        changes: {
          after: {
            orgId: context.activeOrg.id,
            workflowDefinitionId: definition.id,
            scheduleId,
            name: created.name,
            cronExpression: created.cronExpression,
            timezone: created.timezone,
            status: created.status,
          },
        },
      });

      return created;
    } catch (err) {
      await this.temporal.deleteSchedule(scheduleId).catch((deleteErr) => {
        this.log.warn({ err: deleteErr, scheduleId }, "Failed to clean up Temporal schedule after DB create failure");
      });
      throw err;
    }
  }

  async pause(actor: WorkflowScheduleActor, id: string, orgId?: string) {
    const { schedule } = await this.requireScheduleContext(actor, id, orgId);
    const description = await this.temporal.pauseSchedule(schedule.scheduleId, "Paused from application admin");
    const updated = await this.updateFromTemporal(schedule.id, description, WorkflowScheduleStatus.PAUSED, {
      pausedAt: new Date(),
    });
    await this.auditScheduleStatus(actor.userId, schedule.id, "workflowSchedule.pause", schedule.status, updated.status);
    return updated;
  }

  async unpause(actor: WorkflowScheduleActor, id: string, orgId?: string) {
    const { schedule } = await this.requireScheduleContext(actor, id, orgId);
    const description = await this.temporal.unpauseSchedule(schedule.scheduleId, "Unpaused from application admin");
    const updated = await this.updateFromTemporal(schedule.id, description, WorkflowScheduleStatus.ACTIVE, {
      pausedAt: null,
    });
    await this.auditScheduleStatus(actor.userId, schedule.id, "workflowSchedule.unpause", schedule.status, updated.status);
    return updated;
  }

  async trigger(actor: WorkflowScheduleActor, id: string, orgId?: string) {
    const { schedule } = await this.requireScheduleContext(actor, id, orgId);
    await this.temporal.triggerSchedule(schedule.scheduleId);
    await this.audit.record({
      actorId: actor.userId,
      action: "workflowSchedule.trigger",
      entityType: "WorkflowSchedule",
      entityId: schedule.id,
      changes: { after: { scheduleId: schedule.scheduleId } },
    });
  }

  async remove(actor: WorkflowScheduleActor, id: string, orgId?: string) {
    const { schedule } = await this.requireScheduleContext(actor, id, orgId);
    await this.temporal.deleteSchedule(schedule.scheduleId);
    const removed = await this.schedules.markDeleted(schedule.id);
    await this.auditScheduleStatus(actor.userId, schedule.id, "workflowSchedule.delete", schedule.status, removed.status);
    return removed;
  }

  private async requireScheduleContext(actor: WorkflowScheduleActor, id: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const schedule = await this.requireSchedule(id, context.activeOrg.id);
    return { ...context, schedule };
  }

  private async safeDescribeAndUpdate(id: string, scheduleId: string) {
    try {
      const description = await this.temporal.describeSchedule(scheduleId);
      const schedule = await this.updateFromTemporal(
        id,
        description,
        description.paused ? WorkflowScheduleStatus.PAUSED : WorkflowScheduleStatus.ACTIVE,
        { pausedAt: description.paused ? new Date() : null }
      );
      return { schedule, description };
    } catch (err) {
      const updated = await this.schedules.update(id, {
        status: WorkflowScheduleStatus.ERROR,
        lastTemporalStatus: {
          error: err instanceof Error ? err.message : "Failed to describe Temporal schedule",
        },
        lastSyncedAt: new Date(),
      });
      return { schedule: updated, description: null };
    }
  }

  private updateFromTemporal(
    id: string,
    description: TemporalScheduleDescription,
    status: WorkflowScheduleStatus,
    data: Prisma.WorkflowScheduleUpdateInput = {}
  ) {
    return this.schedules.update(id, {
      ...data,
      status,
      lastTemporalStatus: this.temporalStatusJson(description),
      lastSyncedAt: new Date(),
    });
  }

  private async requireSchedule(id: string, orgId: string) {
    const schedule = await this.schedules.findByIdInOrg(id, orgId);
    if (!schedule) throw AppError.notFound("Workflow schedule");
    return schedule;
  }

  private async requireActiveOrg(userId: string, orgId?: string) {
    const context = await this.orgContext.resolveForUser(userId, orgId);
    if (!context.activeOrg) throw AppError.badRequest("Select an organization before managing workflow schedules");
    return { ...context, activeOrg: context.activeOrg };
  }

  private async assertCanAdmin(roleId: string) {
    const allowed = await this.permissions.can(roleId, "workflow", "admin");
    if (!allowed) throw AppError.forbidden("Missing permission: workflow:admin");
  }

  private requireRegistration(key: string): WorkflowTypeRegistration {
    const registration = getWorkflowRegistration(key);
    if (!registration) throw AppError.notFound("Workflow registration");
    return registration;
  }

  private assertCron(cronExpression: string) {
    const value = cronExpression.trim();
    const parts = value.split(/\s+/);
    if (!value || (!value.startsWith("@") && parts.length < 5)) {
      throw AppError.badRequest("Cron expression must be a valid Temporal cron expression");
    }
  }

  private summarizeInput(registration: WorkflowTypeRegistration, input: unknown): Prisma.InputJsonValue {
    if (registration.summarizeInput) return registration.summarizeInput(input) as Prisma.InputJsonObject;
    if (input && typeof input === "object") return input as Prisma.InputJsonObject;
    return {};
  }

  private buildScheduleId(orgId: string, workflowKey: string, name: string) {
    return `schedule.${this.slugPart(orgId)}.${this.slugPart(workflowKey)}.${this.slugPart(name)}`.slice(0, 240);
  }

  private slugPart(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9-_.]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  }

  private temporalStatusJson(description: TemporalScheduleDescription): Prisma.InputJsonObject {
    return {
      paused: description.paused,
      note: description.note ?? null,
      nextActionTimes: description.nextActionTimes.map((date) => date.toISOString()),
      recentActions: description.recentActions.slice(-5).map((action) => ({
        scheduledAt: action.scheduledAt.toISOString(),
        takenAt: action.takenAt.toISOString(),
        workflowId: action.action.workflow.workflowId,
        runId: action.action.workflow.firstExecutionRunId,
      })),
      runningActions: description.runningActions.map((action) => ({
        workflowId: action.workflow.workflowId,
        runId: action.workflow.firstExecutionRunId,
      })),
      numActionsTaken: description.numActionsTaken,
      numActionsMissedCatchupWindow: description.numActionsMissedCatchupWindow,
      numActionsSkippedOverlap: description.numActionsSkippedOverlap,
      overlapPolicy: description.overlapPolicy,
      catchupWindowMs: description.catchupWindowMs,
      pauseOnFailure: description.pauseOnFailure,
    };
  }

  private normalizeStatusCounts(
    counts: Array<{ status: WorkflowScheduleStatus; _count: { _all: number } }>
  ) {
    const initial = Object.fromEntries(Object.values(WorkflowScheduleStatus).map((status) => [status, 0]));
    for (const count of counts) initial[count.status] = count._count._all;
    return initial;
  }

  private auditScheduleStatus(
    actorId: string,
    entityId: string,
    action: string,
    before: WorkflowScheduleStatus,
    after: WorkflowScheduleStatus
  ) {
    return this.audit.record({
      actorId,
      action,
      entityType: "WorkflowSchedule",
      entityId,
      changes: { before: { status: before }, after: { status: after } },
    });
  }
}

export const workflowScheduleService = new WorkflowScheduleService();
