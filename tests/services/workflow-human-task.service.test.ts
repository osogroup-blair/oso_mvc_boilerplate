import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  WorkflowActionChannel,
  WorkflowActionReceiptStatus,
  WorkflowHumanTaskStatus,
} from "@prisma/client";
import { WorkflowHumanTaskService } from "../../src/services/workflow-human-task.service.js";
import { emptyForm } from "../../src/temporal/forms.js";

const makeModel = () => ({
  listOpenForUser: vi.fn(),
  countOpenForUser: vi.fn(),
  findVisibleForUser: vi.fn(),
  findById: vi.fn(),
  findOpenById: vi.fn(),
  findByWorkflowKey: vi.fn(),
  findExecutionByWorkflowId: vi.fn(),
  findRoleByName: vi.fn(),
  findUserByEmail: vi.fn(),
  createWithRoles: vi.fn(),
  update: vi.fn(),
  createToken: vi.fn(),
  findTokenByHash: vi.fn(),
  consumeToken: vi.fn(),
  findReceiptByIdempotencyKey: vi.fn(),
  createReceipt: vi.fn(),
  finalizeReceipt: vi.fn(),
});

const makeOrgContext = () => ({
  resolveForUser: vi.fn(),
});

const makePermissions = () => ({
  can: vi.fn(),
});

const makeTemporal = () => ({
  signalWorkflow: vi.fn(),
});

const makeAudit = () => ({
  record: vi.fn().mockResolvedValue(undefined),
});

const makeEmail = () => ({
  send: vi.fn().mockResolvedValue({ mock: true }),
});

const makeSettings = () => ({
  get: vi.fn().mockResolvedValue("https://app.example.com"),
});

const orgContext = {
  activeOrg: { id: "org-1", name: "Acme", slug: "acme" },
  memberships: [],
  needsSelection: false,
};

const workflowExecution = {
  id: "exec-1",
  orgId: "org-1",
  workflowId: "workflow-1",
  workflowDefinition: { key: "platform.approval", name: "Approval" },
  org: { id: "org-1", name: "Acme", slug: "acme" },
};

const task = {
  id: "task-1",
  orgId: "org-1",
  workflowExecutionId: "exec-1",
  workflowId: "workflow-1",
  runId: "run-1",
  taskKey: "approval",
  taskType: "approval",
  title: "Approve this",
  description: "Please approve",
  status: WorkflowHumanTaskStatus.OPEN,
  assignedUserId: "user-1",
  actionForm: { actionKey: "complete", fields: [] },
  context: {},
  result: null,
  workflowExecution: {
    id: "exec-1",
    workflowDefinition: {
      key: "platform.approval",
      name: "Approval",
      roles: [],
    },
  },
  assignedUser: { id: "user-1", name: "Alice", email: "alice@example.com" },
  roles: [],
};

describe("WorkflowHumanTaskService", () => {
  let model: ReturnType<typeof makeModel>;
  let orgs: ReturnType<typeof makeOrgContext>;
  let permissions: ReturnType<typeof makePermissions>;
  let temporal: ReturnType<typeof makeTemporal>;
  let audit: ReturnType<typeof makeAudit>;
  let email: ReturnType<typeof makeEmail>;
  let settings: ReturnType<typeof makeSettings>;
  let service: WorkflowHumanTaskService;

  beforeEach(() => {
    model = makeModel();
    orgs = makeOrgContext();
    permissions = makePermissions();
    temporal = makeTemporal();
    audit = makeAudit();
    email = makeEmail();
    settings = makeSettings();
    service = new WorkflowHumanTaskService(
      model as never,
      orgs as never,
      permissions as never,
      temporal as never,
      audit as never,
      email as never,
      settings as never
    );

    orgs.resolveForUser.mockResolvedValue(orgContext);
    permissions.can.mockResolvedValue(true);
  });

  it("creates a durable human task idempotently from an activity", async () => {
    model.findExecutionByWorkflowId.mockResolvedValue(workflowExecution);
    model.findByWorkflowKey.mockResolvedValue(null);
    model.findRoleByName.mockResolvedValue({ id: "role-admin", name: "ADMIN" });
    model.findUserByEmail.mockResolvedValue({ id: "user-1", name: "Alice", email: "alice@example.com" });
    model.createWithRoles.mockResolvedValue(task);
    model.createToken.mockResolvedValue({ id: "token-1" });

    const result = await service.createHumanTask({
      orgId: "org-1",
      workflowId: "workflow-1",
      runId: "run-1",
      taskKey: "approval",
      taskType: "approval",
      title: "Approve this",
      description: "Please approve",
      assignedUserEmail: "alice@example.com",
      roleRequirements: [{ roleName: "ADMIN" }],
      actionKey: "complete",
      actionForm: emptyForm,
      tokenTtlHours: 72,
    });

    expect(model.createWithRoles).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowExecutionId: "exec-1",
        assignedUserId: "user-1",
        title: "Approve this",
        actionForm: expect.objectContaining({ actionKey: "complete" }),
      }),
      ["role-admin"]
    );
    expect(model.createToken).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      recipientEmail: "alice@example.com",
    }));
    expect(email.send).toHaveBeenCalledWith(expect.objectContaining({
      to: "alice@example.com",
      templateName: "workflow-task",
      context: expect.objectContaining({
        taskUrl: expect.stringMatching(/^https:\/\/app\.example\.com\/workflow-task-tokens\//),
      }),
    }));
    expect(result).toEqual({ taskId: "task-1", status: WorkflowHumanTaskStatus.OPEN });
  });

  it("returns the existing task when activity creation is replayed", async () => {
    model.findExecutionByWorkflowId.mockResolvedValue(workflowExecution);
    model.findByWorkflowKey.mockResolvedValue(task);

    await expect(
      service.createHumanTask({
        orgId: "org-1",
        workflowId: "workflow-1",
        taskKey: "approval",
        taskType: "approval",
        title: "Approve this",
        actionKey: "complete",
        actionForm: emptyForm,
      })
    ).resolves.toEqual({ taskId: "task-1", status: WorkflowHumanTaskStatus.OPEN });

    expect(model.createWithRoles).not.toHaveBeenCalled();
  });

  it("submits an authenticated action by signaling Temporal and closing the task", async () => {
    model.findById.mockResolvedValue(task);
    model.findVisibleForUser.mockResolvedValue(task);
    model.findReceiptByIdempotencyKey.mockResolvedValue(null);
    model.createReceipt.mockResolvedValue({ id: "receipt-1" });
    model.update.mockResolvedValue({ ...task, status: WorkflowHumanTaskStatus.COMPLETED });
    model.finalizeReceipt.mockResolvedValue({ id: "receipt-1", status: WorkflowActionReceiptStatus.SUCCEEDED });

    const result = await service.submitAuthenticated(
      { userId: "user-1", roleId: "role-1" },
      {
        taskId: "task-1",
        actionKey: "complete",
        input: { decision: "approved", comment: "Looks good" },
        idempotencyKey: "idem-1",
      }
    );

    expect(temporal.signalWorkflow).toHaveBeenCalledWith(
      "workflow-1",
      "platformApprovalAction",
      [expect.objectContaining({
        decision: "approved",
        channel: WorkflowActionChannel.AUTHENTICATED,
        payload: { decision: "approved", comment: "Looks good" },
      })],
      "run-1"
    );
    expect(model.update).toHaveBeenCalledWith("task-1", expect.objectContaining({
      status: WorkflowHumanTaskStatus.COMPLETED,
    }));
    expect(result.alreadySubmitted).toBe(false);
  });

  it("rejects authenticated submissions without workflow act permission", async () => {
    permissions.can.mockResolvedValue(false);

    await expect(
      service.submitAuthenticated(
        { userId: "user-1", roleId: "role-1" },
        { taskId: "task-1", actionKey: "complete", input: {}, idempotencyKey: "idem-1" }
      )
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(temporal.signalWorkflow).not.toHaveBeenCalled();
  });
});
