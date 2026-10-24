import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkflowExecutionStatus,
  WorkflowScheduleStatus,
} from "@prisma/client";
import { WorkflowOperationsService } from "../../src/services/workflow-operations.service.js";

const makeOrgContext = () => ({
  resolveForUser: vi.fn(),
});

const makePermissions = () => ({
  can: vi.fn(),
});

const makeTemporal = () => ({
  getDiagnostics: vi.fn(),
  getTaskQueueDiagnostics: vi.fn(),
});

const makeExecutions = () => ({
  listStaleRunningForOrg: vi.fn(),
  countStaleRunningForOrg: vi.fn(),
});

const makeSchedules = () => ({
  countByStatusForOrg: vi.fn(),
  listActiveWithRequirementsForOrg: vi.fn().mockResolvedValue([]),
});

const makeIntegrations = () => ({
  getRequirementStatuses: vi.fn().mockResolvedValue([]),
});

const makeExecutionService = () => ({
  refreshProjection: vi.fn(),
});

const makeAudit = () => ({
  record: vi.fn().mockResolvedValue(undefined),
});

const orgContext = {
  activeOrg: { id: "org-1", name: "Acme", slug: "acme" },
  memberships: [],
  needsSelection: false,
};

describe("WorkflowOperationsService", () => {
  let organizations: ReturnType<typeof makeOrgContext>;
  let permissions: ReturnType<typeof makePermissions>;
  let temporal: ReturnType<typeof makeTemporal>;
  let executions: ReturnType<typeof makeExecutions>;
  let schedules: ReturnType<typeof makeSchedules>;
  let executionService: ReturnType<typeof makeExecutionService>;
  let audit: ReturnType<typeof makeAudit>;
  let integrations: ReturnType<typeof makeIntegrations>;
  let service: WorkflowOperationsService;

  beforeEach(() => {
    organizations = makeOrgContext();
    permissions = makePermissions();
    temporal = makeTemporal();
    executions = makeExecutions();
    schedules = makeSchedules();
    executionService = makeExecutionService();
    audit = makeAudit();
    integrations = makeIntegrations();

    service = new WorkflowOperationsService(
      organizations as never,
      permissions as never,
      temporal as never,
      executions as never,
      schedules as never,
      executionService as never,
      audit as never,
      integrations as never
    );

    organizations.resolveForUser.mockResolvedValue(orgContext);
    permissions.can.mockResolvedValue(true);
  });

  it("flags active schedules whose required integration bindings are no longer available", async () => {
    temporal.getDiagnostics.mockResolvedValue({ status: "ok" });
    temporal.getTaskQueueDiagnostics.mockResolvedValue({ status: "ok", workflowPollerCount: 1, activityPollerCount: 1, pollers: [] });
    executions.listStaleRunningForOrg.mockResolvedValue([]);
    executions.countStaleRunningForOrg.mockResolvedValue(0);
    schedules.countByStatusForOrg.mockResolvedValue([]);
    const requirement = { key: "syntheticEcho", label: "Synthetic Echo", providerKey: "synthetic.echo", capabilityKey: "echo", description: null, isRequired: true };
    const definition = { id: "def-1", name: "Data Sync", integrationRequirements: [requirement] };
    schedules.listActiveWithRequirementsForOrg.mockResolvedValue([
      { id: "sch-1", name: "Nightly", scheduleId: "temporal-sch-1", workflowDefinition: definition },
      { id: "sch-2", name: "Hourly", scheduleId: "temporal-sch-2", workflowDefinition: definition },
      { id: "sch-3", name: "No integrations", scheduleId: "temporal-sch-3", workflowDefinition: { id: "def-2", name: "Heartbeat", integrationRequirements: [] } },
    ]);
    integrations.getRequirementStatuses.mockResolvedValue([
      { requirement, binding: null, status: "CONNECTION_UNAVAILABLE", reason: "Integration connection is unavailable", available: false },
    ]);

    const dashboard = await service.dashboard({ userId: "user-1", roleId: "role-1" }, "org-1");

    expect(integrations.getRequirementStatuses).toHaveBeenCalledTimes(1);
    expect(integrations.getRequirementStatuses).toHaveBeenCalledWith("org-1", definition);
    expect(dashboard.scheduleIntegrationIssues).toEqual([
      expect.objectContaining({ schedule: { id: "sch-1", name: "Nightly", scheduleId: "temporal-sch-1" }, unavailable: [expect.objectContaining({ key: "syntheticEcho", status: "CONNECTION_UNAVAILABLE" })] }),
      expect.objectContaining({ schedule: { id: "sch-2", name: "Hourly", scheduleId: "temporal-sch-2" } }),
    ]);
  });

  it("builds a dashboard from Temporal diagnostics, worker pollers, stale projections, and schedules", async () => {
    temporal.getDiagnostics.mockResolvedValue({
      status: "ok",
      address: "localhost:7233",
      namespace: "default",
      latencyMs: 5,
    });
    temporal.getTaskQueueDiagnostics.mockResolvedValue({
      status: "ok",
      taskQueue: "oso-workflows",
      workflowPollerCount: 1,
      activityPollerCount: 1,
      pollers: [{ identity: "worker-1", taskQueueType: "workflow", lastAccessTime: new Date("2026-08-14T12:00:00.000Z") }],
    });
    executions.listStaleRunningForOrg.mockResolvedValue([{ id: "exec-1" }]);
    executions.countStaleRunningForOrg.mockResolvedValue(1);
    schedules.countByStatusForOrg.mockResolvedValue([
      { status: WorkflowScheduleStatus.ACTIVE, _count: { _all: 2 } },
    ]);

    const dashboard = await service.dashboard({ userId: "user-1", roleId: "role-1" }, "org-1", 30);

    expect(permissions.can).toHaveBeenCalledWith("role-1", "workflow", "admin");
    expect(executions.listStaleRunningForOrg).toHaveBeenCalledWith("org-1", expect.any(Date), 25);
    expect(dashboard.worker.reachable).toBe(true);
    expect(dashboard.staleTotal).toBe(1);
    expect(dashboard.scheduleCounts).toMatchObject({
      ACTIVE: 2,
      PAUSED: 0,
      ERROR: 0,
      DELETED: 0,
    });
  });

  it("reconciles stale projections and audits success/failure counts", async () => {
    const stale = [
      { id: "exec-1", workflowId: "workflow-1", status: WorkflowExecutionStatus.RUNNING },
      { id: "exec-2", workflowId: "workflow-2", status: WorkflowExecutionStatus.RUNNING },
    ];
    executions.listStaleRunningForOrg.mockResolvedValue(stale);
    executionService.refreshProjection
      .mockResolvedValueOnce({ id: "exec-1", status: WorkflowExecutionStatus.COMPLETED })
      .mockRejectedValueOnce(new Error("Temporal unavailable"));

    const result = await service.reconcileStale({ userId: "user-1", roleId: "role-1" }, "org-1", 15, 10);

    expect(executionService.refreshProjection).toHaveBeenCalledWith("exec-1", "org-1", "role-1");
    expect(executionService.refreshProjection).toHaveBeenCalledWith("exec-2", "org-1", "role-1");
    expect(result.results).toHaveLength(2);
    expect(result.results[0]).toMatchObject({ ok: true, after: WorkflowExecutionStatus.COMPLETED });
    expect(result.results[1]).toMatchObject({ ok: false, error: "Temporal unavailable" });
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "workflowOperations.reconcileStale",
      changes: { after: expect.objectContaining({ attempted: 2, succeeded: 1, failed: 1 }) },
    }));
  });
});
