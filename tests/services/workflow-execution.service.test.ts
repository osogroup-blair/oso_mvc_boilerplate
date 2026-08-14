import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowCapability, WorkflowExecutionStatus } from "@prisma/client";
import { WorkflowExecutionService } from "../../src/services/workflow-execution.service.js";

const makeExecutionModel = () => ({
  listForOrgAndRole: vi.fn(),
  countForOrgAndRole: vi.fn(),
  findByIdInOrg: vi.fn(),
  findByWorkflowIdInOrg: vi.fn(),
  create: vi.fn(),
  updateStatus: vi.fn(),
});

const makeCatalog = () => ({
  getBySlug: vi.fn(),
  getByKey: vi.fn(),
});

const makeOrgContext = () => ({
  resolveForUser: vi.fn(),
});

const makePermissions = () => ({
  can: vi.fn(),
});

const makeTemporal = () => ({
  startWorkflow: vi.fn(),
  describeWorkflow: vi.fn(),
  queryWorkflow: vi.fn(),
  cancelWorkflow: vi.fn(),
});

const makeAudit = () => ({
  record: vi.fn().mockResolvedValue(undefined),
});

const orgContext = {
  activeOrg: { id: "org-1", name: "Acme", slug: "acme" },
  memberships: [],
  needsSelection: false,
};

const platformTestDefinition = {
  id: "def-1",
  key: "platform.test",
  slug: "platform-test",
  workflowType: "platformTestWorkflow",
  defaultTaskQueue: "oso-workflows",
  isEnabled: true,
  roles: [
    { roleId: "role-1", capability: WorkflowCapability.VIEW },
    { roleId: "role-1", capability: WorkflowCapability.START },
    { roleId: "role-1", capability: WorkflowCapability.CANCEL },
  ],
};

const execution = {
  id: "exec-1",
  orgId: "org-1",
  workflowDefinitionId: "def-1",
  startedById: "user-1",
  workflowId: "org-org-1.platform.test.demo",
  runId: "run-1",
  businessKey: "demo",
  status: WorkflowExecutionStatus.RUNNING,
  inputSummary: { message: "hello" },
  stateSummary: {},
  error: null,
  workflowDefinition: platformTestDefinition,
};

describe("WorkflowExecutionService", () => {
  let executions: ReturnType<typeof makeExecutionModel>;
  let catalog: ReturnType<typeof makeCatalog>;
  let organizations: ReturnType<typeof makeOrgContext>;
  let permissions: ReturnType<typeof makePermissions>;
  let temporal: ReturnType<typeof makeTemporal>;
  let audit: ReturnType<typeof makeAudit>;
  let service: WorkflowExecutionService;

  beforeEach(() => {
    executions = makeExecutionModel();
    catalog = makeCatalog();
    organizations = makeOrgContext();
    permissions = makePermissions();
    temporal = makeTemporal();
    audit = makeAudit();
    service = new WorkflowExecutionService(
      executions as never,
      catalog as never,
      organizations as never,
      permissions as never,
      temporal as never,
      audit as never
    );

    organizations.resolveForUser.mockResolvedValue(orgContext);
    permissions.can.mockResolvedValue(true);
    catalog.getBySlug.mockResolvedValue(platformTestDefinition);
    catalog.getByKey.mockResolvedValue(platformTestDefinition);
  });

  it("starts a registered workflow through Temporal and records the projection", async () => {
    executions.findByWorkflowIdInOrg.mockResolvedValue(null);
    temporal.startWorkflow.mockResolvedValue({
      workflowId: "org-org-1.platform.test.demo",
      runId: "run-1",
    });
    executions.create.mockImplementation(async (data) => ({ id: "exec-1", ...data }));

    const created = await service.start(
      { userId: "user-1", roleId: "role-1" },
      {
        slug: "platform-test",
        orgId: "org-1",
        input: { message: "hello", durationSeconds: 3, businessKey: "demo" },
      }
    );

    expect(temporal.startWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      workflowType: "platformTestWorkflow",
      taskQueue: "oso-workflows",
      workflowId: "org-org-1.platform.test.demo",
      args: [
        { message: "hello", durationSeconds: 3, businessKey: "demo" },
        { orgId: "org-1", startedById: "user-1", workflowDefinitionKey: "platform.test" },
      ],
    }));
    expect(executions.create).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      workflowDefinitionId: "def-1",
      startedById: "user-1",
      runId: "run-1",
      status: WorkflowExecutionStatus.RUNNING,
      inputSummary: { message: "hello", durationSeconds: 3, businessKey: "demo" },
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "workflowExecution.start",
    }));
    expect(created.status).toBe(WorkflowExecutionStatus.RUNNING);
  });

  it("blocks starts when an active projection already owns the business key", async () => {
    executions.findByWorkflowIdInOrg.mockResolvedValue({
      id: "exec-existing",
      status: WorkflowExecutionStatus.RUNNING,
    });

    await expect(
      service.start(
        { userId: "user-1", roleId: "role-1" },
        {
          slug: "platform-test",
          orgId: "org-1",
          input: { message: "hello", durationSeconds: 3, businessKey: "demo" },
        }
      )
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(temporal.startWorkflow).not.toHaveBeenCalled();
  });

  it("ingests a scheduled workflow start when no projection exists yet", async () => {
    executions.findByWorkflowIdInOrg.mockResolvedValue(null);
    executions.create.mockImplementation(async (data) => ({ id: "exec-scheduled", ...data }));

    const result = await service.ensureStartedProjection({
      orgId: "org-1",
      workflowDefinitionKey: "platform.test",
      startedById: "user-1",
      workflowId: "schedule-org-1-platform-test-run",
      runId: "run-scheduled",
      scheduleId: "schedule.org-1.platform.test.hourly",
      input: { message: "hello", durationSeconds: 3, businessKey: "scheduled-demo" },
    });

    expect(catalog.getByKey).toHaveBeenCalledWith("platform.test");
    expect(executions.create).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      workflowDefinitionId: "def-1",
      startedById: "user-1",
      workflowId: "schedule-org-1-platform-test-run",
      runId: "run-scheduled",
      businessKey: "scheduled-demo",
      status: WorkflowExecutionStatus.RUNNING,
      inputSummary: {
        message: "hello",
        durationSeconds: 3,
        businessKey: "scheduled-demo",
        scheduleId: "schedule.org-1.platform.test.hourly",
      },
      stateSummary: {},
      lastSyncedAt: expect.any(Date),
    }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "workflowExecution.ingestScheduledStart",
    }));
    expect(result.created).toBe(true);
    expect(result.execution.id).toBe("exec-scheduled");
  });

  it("does not duplicate an already ingested workflow projection", async () => {
    executions.findByWorkflowIdInOrg.mockResolvedValue(execution);

    const result = await service.ensureStartedProjection({
      orgId: "org-1",
      workflowDefinitionKey: "platform.test",
      startedById: "user-1",
      workflowId: execution.workflowId,
      runId: execution.runId,
      input: { message: "hello", durationSeconds: 3, businessKey: "demo" },
    });

    expect(catalog.getByKey).not.toHaveBeenCalled();
    expect(executions.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(result).toEqual({ execution, created: false });
  });

  it("refreshes execution status and state from Temporal", async () => {
    executions.findByIdInOrg.mockResolvedValue(execution);
    temporal.describeWorkflow.mockResolvedValue({ statusName: "COMPLETED", closeTime: new Date("2026-08-13T12:00:00.000Z") });
    temporal.queryWorkflow.mockResolvedValue({
      message: "hello",
      phase: "completed",
      durationSeconds: 3,
      businessKey: "demo",
    });
    executions.updateStatus.mockResolvedValue({
      ...execution,
      status: WorkflowExecutionStatus.COMPLETED,
      stateSummary: { phase: "completed", message: "hello", durationSeconds: 3, businessKey: "demo" },
    });

    const refreshed = await service.refresh(
      { userId: "user-1", roleId: "role-1" },
      "exec-1",
      "org-1"
    );

    expect(temporal.describeWorkflow).toHaveBeenCalledWith("org-org-1.platform.test.demo", "run-1");
    expect(temporal.queryWorkflow).toHaveBeenCalledWith("org-org-1.platform.test.demo", "platformTestState", "run-1");
    expect(executions.updateStatus).toHaveBeenCalledWith(
      "exec-1",
      WorkflowExecutionStatus.COMPLETED,
      expect.objectContaining({
        stateSummary: { phase: "completed", message: "hello", durationSeconds: 3, businessKey: "demo", integration: null },
        completedAt: new Date("2026-08-13T12:00:00.000Z"),
      })
    );
    expect(refreshed.status).toBe(WorkflowExecutionStatus.COMPLETED);
  });

  it("cancels a non-terminal workflow through Temporal and audits the request", async () => {
    executions.findByIdInOrg.mockResolvedValue(execution);
    executions.updateStatus.mockResolvedValue({
      ...execution,
      status: WorkflowExecutionStatus.CANCELED,
    });

    const cancelled = await service.cancel(
      { userId: "user-1", roleId: "role-1" },
      "exec-1",
      "org-1"
    );

    expect(temporal.cancelWorkflow).toHaveBeenCalledWith("org-org-1.platform.test.demo", "run-1");
    expect(executions.updateStatus).toHaveBeenCalledWith("exec-1", WorkflowExecutionStatus.CANCELED);
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "user-1",
      action: "workflowExecution.cancel",
    }));
    expect(cancelled.status).toBe(WorkflowExecutionStatus.CANCELED);
  });

  it("requires a workflow start permission before calling Temporal", async () => {
    permissions.can.mockResolvedValue(false);

    await expect(
      service.start(
        { userId: "user-1", roleId: "role-1" },
        {
          slug: "platform-test",
          orgId: "org-1",
          input: { message: "hello", durationSeconds: 3 },
        }
      )
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(temporal.startWorkflow).not.toHaveBeenCalled();
  });
});
