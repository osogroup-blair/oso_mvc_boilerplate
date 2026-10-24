import { BaseService } from "./BaseService.js";
import { WorkflowScheduleStatus } from "@prisma/client";
import { AppError } from "../lib/AppError.js";
import {
  OrganizationContextService,
  organizationContextService,
} from "./organizationContext.service.js";
import { permissionsService, PermissionsService } from "./permissions.service.js";
import {
  TemporalClientGateway,
  temporalClientGateway,
} from "../lib/temporalClient.js";
import {
  WorkflowExecutionModel,
  workflowExecutionModel,
} from "../models/workflowExecution.model.js";
import {
  WorkflowScheduleModel,
  workflowScheduleModel,
} from "../models/workflowSchedule.model.js";
import {
  WorkflowExecutionService,
  workflowExecutionService,
} from "./workflow-execution.service.js";
import { auditService, AuditService } from "./audit.service.js";
import {
  integrationService,
  type IntegrationService,
  type RequirementStatus,
} from "./integration.service.js";
import { config } from "../config/index.js";

export interface WorkflowOperationsActor {
  userId: string;
  roleId: string;
}

export class WorkflowOperationsService extends BaseService {
  constructor(
    private readonly orgContext: OrganizationContextService = organizationContextService,
    private readonly permissions: PermissionsService = permissionsService,
    private readonly temporal: TemporalClientGateway = temporalClientGateway,
    private readonly executions: WorkflowExecutionModel = workflowExecutionModel,
    private readonly schedules: WorkflowScheduleModel = workflowScheduleModel,
    private readonly executionService: WorkflowExecutionService = workflowExecutionService,
    private readonly audit: AuditService = auditService,
    private readonly integrations: Pick<IntegrationService, "getRequirementStatuses"> = integrationService
  ) {
    super("WorkflowOperationsService");
  }

  async dashboard(actor: WorkflowOperationsActor, orgId?: string, staleMinutes = 15) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const olderThan = new Date(Date.now() - staleMinutes * 60_000);
    const [temporal, taskQueue, staleExecutions, staleTotal, scheduleCounts, scheduleIntegrationIssues] = await Promise.all([
      this.temporal.getDiagnostics(),
      this.temporal.getTaskQueueDiagnostics(config.TEMPORAL_TASK_QUEUE),
      this.executions.listStaleRunningForOrg(context.activeOrg.id, olderThan, 25),
      this.executions.countStaleRunningForOrg(context.activeOrg.id, olderThan),
      this.schedules.countByStatusForOrg(context.activeOrg.id),
      this.scheduleIntegrationIssues(context.activeOrg.id),
    ]);

    return {
      ...context,
      temporal,
      taskQueue,
      worker: {
        expectedIdentity: config.TEMPORAL_WORKER_IDENTITY,
        expectedTaskQueue: config.TEMPORAL_TASK_QUEUE,
        pollerCount: taskQueue.workflowPollerCount + taskQueue.activityPollerCount,
        reachable: taskQueue.status === "ok" && taskQueue.workflowPollerCount > 0 && taskQueue.activityPollerCount > 0,
      },
      staleMinutes,
      staleExecutions,
      staleTotal,
      scheduleCounts: this.normalizeScheduleCounts(scheduleCounts),
      scheduleIntegrationIssues,
      temporalUiBaseUrl: config.TEMPORAL_UI_BASE_URL,
      operationalNotes: [
        "Temporal remains the authority for timers, retries, and workflow histories.",
        "The application database stores projections and admin configuration; stale projections can be reconciled safely.",
        "Do not use Temporal UI as an application authorization boundary.",
      ],
    };
  }

  async canary(actor: WorkflowOperationsActor, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    try { await this.temporal.applicationCanary(5000); return { activeOrg: context.activeOrg, status: "PASS" }; }
    catch { return { activeOrg: context.activeOrg, status: "FAILED" }; }
  }

  async recoverStarts(actor: WorkflowOperationsActor, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const results = await this.executionService.recoverPendingStarts(actor, context.activeOrg.id);
    await this.audit.record({ actorId: actor.userId, action: "workflowOperations.recoverStarts", entityType: "WorkflowStartIntent", entityId: context.activeOrg.id,
      changes: { after: { orgId: context.activeOrg.id, recovered: results.length } } });
    return { activeOrg: context.activeOrg, results };
  }

  async reconcileStale(actor: WorkflowOperationsActor, orgId?: string, staleMinutes = 15, limit = 25) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const olderThan = new Date(Date.now() - staleMinutes * 60_000);
    const stale = await this.executions.listStaleRunningForOrg(context.activeOrg.id, olderThan, limit);
    const results = [];

    for (const execution of stale) {
      try {
        const refreshed = await this.executionService.refreshProjection(
          execution.id,
          context.activeOrg.id,
          actor.roleId
        );
        results.push({
          id: execution.id,
          workflowId: execution.workflowId,
          before: execution.status,
          after: refreshed.status,
          ok: true,
        });
      } catch (err) {
        results.push({
          id: execution.id,
          workflowId: execution.workflowId,
          before: execution.status,
          after: execution.status,
          ok: false,
          error: err instanceof Error ? err.message : "Failed to refresh projection",
        });
      }
    }

    await this.audit.record({
      actorId: actor.userId,
      action: "workflowOperations.reconcileStale",
      entityType: "WorkflowExecution",
      entityId: context.activeOrg.id,
      changes: {
        after: {
          orgId: context.activeOrg.id,
          staleMinutes,
          attempted: results.length,
          succeeded: results.filter((result) => result.ok).length,
          failed: results.filter((result) => !result.ok).length,
        },
      },
    });

    return { ...context, results };
  }

  /**
   * Schedules are gated on integration bindings only when created. Temporal keeps
   * firing them afterwards, so report active schedules whose required bindings
   * are no longer AVAILABLE; their runs would fail with INTEGRATION_* failures.
   */
  private async scheduleIntegrationIssues(orgId: string) {
    const schedules = await this.schedules.listActiveWithRequirementsForOrg(orgId);
    const statusesByDefinition = new Map<string, Promise<RequirementStatus[]>>();
    const issues = [];
    for (const schedule of schedules) {
      const definition = schedule.workflowDefinition;
      if (!definition.integrationRequirements.length) continue;
      if (!statusesByDefinition.has(definition.id)) {
        statusesByDefinition.set(definition.id, this.integrations.getRequirementStatuses(orgId, definition));
      }
      const statuses = (await statusesByDefinition.get(definition.id)) ?? [];
      const unavailable = statuses.filter((item) => item.requirement.isRequired && !item.available);
      if (!unavailable.length) continue;
      issues.push({
        schedule: { id: schedule.id, name: schedule.name, scheduleId: schedule.scheduleId },
        workflowDefinition: { id: definition.id, name: definition.name },
        unavailable: unavailable.map((item) => ({
          key: item.requirement.key,
          label: item.requirement.label,
          status: item.status,
          reason: item.reason,
        })),
      });
    }
    return issues;
  }

  private async requireActiveOrg(userId: string, orgId?: string) {
    const context = await this.orgContext.resolveForUser(userId, orgId);
    if (!context.activeOrg) throw AppError.badRequest("Select an organization before viewing workflow operations");
    return { ...context, activeOrg: context.activeOrg };
  }

  private async assertCanAdmin(roleId: string) {
    const allowed = await this.permissions.can(roleId, "workflow", "admin");
    if (!allowed) throw AppError.forbidden("Missing permission: workflow:admin");
  }

  private normalizeScheduleCounts(
    counts: Array<{ status: string; _count: { _all: number } }>
  ) {
    const initial = Object.fromEntries(Object.values(WorkflowScheduleStatus).map((status) => [status, 0]));
    return counts.reduce<Record<string, number>>((acc, count) => {
      acc[count.status] = count._count._all;
      return acc;
    }, initial);
  }
}

export const workflowOperationsService = new WorkflowOperationsService();
