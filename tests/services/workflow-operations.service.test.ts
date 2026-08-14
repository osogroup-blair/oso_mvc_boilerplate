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
  let service: WorkflowOperationsService;

  beforeEach(() => {
    organizations = makeOrgContext();
    permissions = makePermissions();
    temporal = makeTemporal();
    executions = makeExecutions();
    schedules = makeSchedules();
    executionService = makeExecutionService();
    audit = makeAudit();

    service = new WorkflowOperationsService(
      organizations as never,
      permissions as never,
      temporal as never,
      executions as never,
      schedules as never,
      executionService as never,
      audit as never
    );

    organizations.resolveForUser.mockResolvedValue(orgContext);
    permissions.can.mockResolvedValue(true);
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
