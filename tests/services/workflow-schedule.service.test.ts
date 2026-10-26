import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkflowScheduleOverlapPolicy,
  WorkflowScheduleStatus,
} from "@prisma/client";
import { WorkflowScheduleService } from "../../src/services/workflow-schedule.service.js";

const makeSchedules = () => ({
  listForOrg: vi.fn(),
  countForOrg: vi.fn(),
  countByStatusForOrg: vi.fn(),
  findByIdInOrg: vi.fn(),
  findByNameInOrg: vi.fn(),
  findByScheduleId: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  markDeleted: vi.fn(),
});

const makeCatalog = () => ({
  list: vi.fn(),
  getById: vi.fn(),
});

const makeOrgContext = () => ({
  resolveForUser: vi.fn(),
});

const makePermissions = () => ({
  can: vi.fn(),
});

const makeTemporal = () => ({
  createSchedule: vi.fn(),
  describeSchedule: vi.fn(),
  pauseSchedule: vi.fn(),
  unpauseSchedule: vi.fn(),
  triggerSchedule: vi.fn(),
  deleteSchedule: vi.fn(),
});

const makeAudit = () => ({
  record: vi.fn().mockResolvedValue(undefined),
});

const makeIntegrations = () => ({
  getRequirementStatuses: vi.fn(),
  assertRequiredBindingsAvailable: vi.fn(),
});

const orgContext = {
  activeOrg: { id: "org-1", name: "Acme", slug: "acme" },
  memberships: [],
  needsSelection: false,
};

const heartbeatDefinition = {
  id: "def-1",
  key: "platform.heartbeat",
  slug: "platform-heartbeat",
  workflowType: "temporalPlatformHeartbeatWorkflow",
  defaultTaskQueue: "oso-workflows",
  name: "Platform Heartbeat",
  isEnabled: true,
  integrationRequirements: [],
};

const temporalDescription = {
  scheduleId: "schedule.org-1.platform.heartbeat.daily-heartbeat",
  paused: false,
  note: null,
  nextActionTimes: [new Date("2026-08-14T13:00:00.000Z")],
  recentActions: [],
  runningActions: [],
  numActionsTaken: 0,
  numActionsMissedCatchupWindow: 0,
  numActionsSkippedOverlap: 0,
  overlapPolicy: "SKIP",
  catchupWindowMs: 60_000,
  pauseOnFailure: true,
};

describe("WorkflowScheduleService", () => {
  let schedules: ReturnType<typeof makeSchedules>;
  let catalog: ReturnType<typeof makeCatalog>;
  let organizations: ReturnType<typeof makeOrgContext>;
  let permissions: ReturnType<typeof makePermissions>;
  let temporal: ReturnType<typeof makeTemporal>;
  let audit: ReturnType<typeof makeAudit>;
  let integrations: ReturnType<typeof makeIntegrations>;
  let service: WorkflowScheduleService;

  beforeEach(() => {
    schedules = makeSchedules();
    catalog = makeCatalog();
    organizations = makeOrgContext();
    permissions = makePermissions();
    temporal = makeTemporal();
    audit = makeAudit();
    integrations = makeIntegrations();

    service = new WorkflowScheduleService(
      schedules as never,
      catalog as never,
      organizations as never,
      permissions as never,
      temporal as never,
      audit as never,
      integrations as never
    );

    organizations.resolveForUser.mockResolvedValue(orgContext);
    permissions.can.mockResolvedValue(true);
    catalog.getById.mockResolvedValue(heartbeatDefinition);
    schedules.findByNameInOrg.mockResolvedValue(null);
    integrations.getRequirementStatuses.mockResolvedValue([]);
    temporal.createSchedule.mockResolvedValue(temporalDescription);
  });

  it("creates a Temporal schedule, stores the app projection, and audits it", async () => {
    schedules.create.mockImplementation(async (data) => ({
      id: "sched-1",
      ...data,
    }));

    const created = await service.create(
      { userId: "user-1", roleId: "role-1" },
      {
        orgId: "org-1",
        workflowDefinitionId: "def-1",
        name: "Daily Heartbeat",
        description: "System heartbeat",
        cronExpression: "0 * * * *",
        timezone: "UTC",
        input: {},
        overlapPolicy: WorkflowScheduleOverlapPolicy.SKIP,
        catchupWindowSeconds: 60,
        pauseOnFailure: true,
        paused: false,
      }
    );

    expect(temporal.createSchedule).toHaveBeenCalledWith(expect.objectContaining({
      scheduleId: "schedule.org-1.platform.heartbeat.daily-heartbeat",
      workflowType: "temporalPlatformHeartbeatWorkflow",
      taskQueue: "oso-workflows",
      cronExpression: "0 * * * *",
      args: [
        {},
        expect.objectContaining({
          orgId: "org-1",
          startedById: "user-1",
          workflowDefinitionKey: "platform.heartbeat",
          scheduleId: "schedule.org-1.platform.heartbeat.daily-heartbeat",
        }),
      ],
    }));
    expect(schedules.create).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      workflowDefinitionId: "def-1",
      status: WorkflowScheduleStatus.ACTIVE,
      inputSummary: {},
      lastTemporalStatus: expect.objectContaining({
        paused: false,
        nextActionTimes: ["2026-08-14T13:00:00.000Z"],
      }),
    }), "user-1");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "workflowSchedule.create",
      entityType: "WorkflowSchedule",
    }));
    expect(created.status).toBe(WorkflowScheduleStatus.ACTIVE);
  });

  it("blocks duplicate schedule names before calling Temporal", async () => {
    schedules.findByNameInOrg.mockResolvedValue({ id: "sched-existing" });

    await expect(
      service.create(
        { userId: "user-1", roleId: "role-1" },
        {
          orgId: "org-1",
          workflowDefinitionId: "def-1",
          name: "Daily Heartbeat",
          cronExpression: "0 * * * *",
          timezone: "UTC",
          input: {},
          overlapPolicy: WorkflowScheduleOverlapPolicy.SKIP,
          catchupWindowSeconds: 60,
          pauseOnFailure: true,
          paused: false,
        }
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(temporal.createSchedule).not.toHaveBeenCalled();
    expect(schedules.create).not.toHaveBeenCalled();
  });

  it("pauses and unpauses schedules through Temporal and updates projection status", async () => {
    const existing = {
      id: "sched-1",
      orgId: "org-1",
      scheduleId: "schedule.org-1.platform.heartbeat.daily-heartbeat",
      status: WorkflowScheduleStatus.ACTIVE,
    };
    schedules.findByIdInOrg.mockResolvedValue(existing);
    temporal.pauseSchedule.mockResolvedValue({ ...temporalDescription, paused: true });
    schedules.update.mockResolvedValueOnce({
      ...existing,
      status: WorkflowScheduleStatus.PAUSED,
    });

    const paused = await service.pause({ userId: "user-1", roleId: "role-1" }, "sched-1", "org-1");

    expect(temporal.pauseSchedule).toHaveBeenCalledWith(existing.scheduleId, "Paused from application admin");
    expect(schedules.update).toHaveBeenCalledWith("sched-1", expect.objectContaining({
      status: WorkflowScheduleStatus.PAUSED,
      pausedAt: expect.any(Date),
    }));
    expect(paused.status).toBe(WorkflowScheduleStatus.PAUSED);

    schedules.findByIdInOrg.mockResolvedValue({ ...existing, status: WorkflowScheduleStatus.PAUSED });
    temporal.unpauseSchedule.mockResolvedValue({ ...temporalDescription, paused: false });
    schedules.update.mockResolvedValueOnce({
      ...existing,
      status: WorkflowScheduleStatus.ACTIVE,
    });

    const unpaused = await service.unpause({ userId: "user-1", roleId: "role-1" }, "sched-1", "org-1");

    expect(temporal.unpauseSchedule).toHaveBeenCalledWith(existing.scheduleId, "Unpaused from application admin");
    expect(schedules.update).toHaveBeenLastCalledWith("sched-1", expect.objectContaining({
      status: WorkflowScheduleStatus.ACTIVE,
      pausedAt: null,
    }));
    expect(unpaused.status).toBe(WorkflowScheduleStatus.ACTIVE);
  });
});
