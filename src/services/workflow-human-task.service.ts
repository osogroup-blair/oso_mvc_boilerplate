import {
  WorkflowActionChannel,
  WorkflowActionReceiptStatus,
  WorkflowHumanTaskStatus,
  type Prisma,
} from "@prisma/client";
import { workflowTaskPolicies, WorkflowTaskPolicies } from "./workflow-task-policy.service.js";
import { stableHash } from "../lib/stable-hash.js";
import { createHash, randomBytes } from "node:crypto";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import {
  WorkflowHumanTaskModel,
  workflowHumanTaskModel,
} from "../models/workflowHumanTask.model.js";
import {
  OrganizationContextService,
  organizationContextService,
} from "./organizationContext.service.js";
import { permissionsService, PermissionsService } from "./permissions.service.js";
import { auditService, AuditService } from "./audit.service.js";
import { emailService, EmailService } from "./email.service.js";
import { settingService } from "./setting.service.js";
import {
  TemporalClientGateway,
  temporalClientGateway,
} from "../lib/temporalClient.js";
import {
  getWorkflowRegistration,
  type WorkflowActionRegistration,
} from "../temporal/workflow-registry.js";
import type {
  CloseHumanTaskInput,
  CreateHumanTaskInput,
  WorkflowHumanActionInput,
} from "../temporal/contracts.js";
import type { ListParams } from "../lib/query.js";

export interface WorkflowTaskActor {
  userId: string;
  roleId: string;
}

export interface SubmitTaskActionInput {
  taskId: string;
  actionKey: string;
  input: Record<string, unknown>;
  idempotencyKey: string;
}

export class WorkflowHumanTaskService extends BaseService {
  private isUniqueConstraintError(error:unknown) { return (error as {code?:string})?.code === "P2002"; }
  constructor(
    private readonly tasks: WorkflowHumanTaskModel = workflowHumanTaskModel,
    private readonly orgContext: OrganizationContextService = organizationContextService,
    private readonly permissions: PermissionsService = permissionsService,
    private readonly temporal: TemporalClientGateway = temporalClientGateway,
    private readonly audit: AuditService = auditService,
    private readonly email: EmailService = emailService,
    private readonly settings: typeof settingService = settingService,
    private readonly policies: WorkflowTaskPolicies = workflowTaskPolicies
  ) {
    super("WorkflowHumanTaskService");
  }

  async listInbox(actor: WorkflowTaskActor, orgId: string | undefined, params: ListParams) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAct(actor.roleId);
    const [tasks, total] = await Promise.all([
      this.tasks.listOpenForUser(context.activeOrg.id, actor.userId, actor.roleId, params),
      this.tasks.countOpenForUser(context.activeOrg.id, actor.userId, actor.roleId, params.search),
    ]);
    return { ...context, tasks, total };
  }

  async getAuthenticatedTask(actor: WorkflowTaskActor, taskId: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAct(actor.roleId);
    const task = await this.tasks.findVisibleForUser(taskId, context.activeOrg.id, actor.userId, actor.roleId);
    if (!task) throw AppError.notFound("Workflow task");
    await this.policies.assert(task.taskType, { task, actorUserId: actor.userId, channel: "AUTHENTICATED" });
    return {
      ...context,
      task,
      action: this.getActionForTask(task, this.getActionKey(task)),
    };
  }

  async getTokenTask(rawToken: string) {
    const token = await this.findValidToken(rawToken);
    const task = token.task;
    await this.policies.assert(task.taskType, { task, tokenId: token.id, channel: "TOKEN" });
    if (task.status !== WorkflowHumanTaskStatus.OPEN) {
      throw AppError.conflict("Workflow task is no longer open");
    }
    return {
      tokenId: token.id,
      task,
      action: this.getActionForTask(task, this.getActionKey(task)),
    };
  }

  async submitAuthenticated(actor: WorkflowTaskActor, input: SubmitTaskActionInput) {
    await this.assertCanAct(actor.roleId);
    const task = await this.tasks.findById(input.taskId);
    if (!task) throw AppError.notFound("Workflow task");
    const context = await this.requireActiveOrg(actor.userId, task.orgId);
    const visible = await this.tasks.findVisibleForUser(task.id, context.activeOrg.id, actor.userId, actor.roleId);
    if (!visible) throw AppError.forbidden("You cannot act on this workflow task");
    await this.policies.assert(visible.taskType, {task:visible,actorUserId:actor.userId,channel:"AUTHENTICATED"});
    const action = this.getActionForTask(visible, input.actionKey);

    return this.submitAction(visible, action, input.input, {
      idempotencyKey: input.idempotencyKey,
      channel: WorkflowActionChannel.AUTHENTICATED,
      actorUserId: actor.userId,
      submittedBy: actor.userId,
    });
  }

  async submitWithToken(rawToken: string, actionKey: string, actionInput: Record<string, unknown>, idempotencyKey: string) {
    const token = await this.findValidToken(rawToken, true);
    const task = token.task;
    const prior = await this.tasks.findReceiptByIdempotencyKey(task.id,idempotencyKey);
    if(token.consumedAt && (!prior || prior.tokenId!==token.id || prior.status!==WorkflowActionReceiptStatus.SUCCEEDED))throw AppError.conflict("Workflow task token has already been used");
    await this.policies.assert(task.taskType,{task,tokenId:token.id,channel:"TOKEN"});
    const action = this.getActionForTask(task, actionKey);
    const result = await this.submitAction(task, action, actionInput, {
      idempotencyKey,
      channel: WorkflowActionChannel.TOKEN,
      tokenId: token.id,
      submittedBy: token.recipientEmail ?? "email-token",
    });
    return result;
  }

  async createHumanTask(input: CreateHumanTaskInput) {
    const execution = await this.tasks.findExecutionByWorkflowId(input.workflowId);
    if (!execution) throw AppError.notFound("Workflow execution");
    if(input.runId && execution.runId && input.runId!==execution.runId)throw AppError.conflict("Workflow run mismatch");
    if (execution.orgId !== input.orgId) throw AppError.forbidden("Workflow execution organization mismatch");

    const existing = await this.tasks.findByWorkflowKey(execution.id, input.taskKey);
    if (existing) {
      return {
        taskId: existing.id,
        status: existing.status,
      };
    }

    const assignedUser = input.assignedUserEmail
      ? await this.tasks.findUserByEmail(input.assignedUserEmail)
      : null;
    if(assignedUser && !await this.tasks.isActiveMember(assignedUser.id,execution.orgId))throw AppError.forbidden("Assigned user is not an active organization member");
    const roleIds = await this.resolveRoleIds(input.roleRequirements ?? []);

    const created = await this.tasks.createWithRoles(
      {
        orgId: execution.orgId,
        workflowExecutionId: execution.id,
        workflowId: input.workflowId,
        runId: input.runId,
        taskKey: input.taskKey,
        taskType: input.taskType,
        title: input.title,
        description: input.description,
        assignedUserId: assignedUser?.id,
        actionForm: {
          ...(input.actionForm ?? {}),
          actionKey: input.actionKey,
        } as Prisma.InputJsonObject,
        context: (input.context ?? {}) as Prisma.InputJsonObject,
        dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      },
      roleIds
    );

    if (input.assignedUserEmail) {
      await this.issueEmailToken(created.id, input.assignedUserEmail, input.tokenTtlHours ?? 72);
    }

    await this.audit.record({
      actorId: null,
      action: "workflowHumanTask.create",
      entityType: "WorkflowHumanTask",
      entityId: created.id,
      changes: {
        after: {
          orgId: created.orgId,
          workflowExecutionId: created.workflowExecutionId,
          taskKey: created.taskKey,
          assignedUserId: created.assignedUserId,
          roleIds,
        },
      },
    });

    return {
      taskId: created.id,
      status: created.status,
    };
  }

  async closeHumanTask(input: CloseHumanTaskInput) {
    const task = await this.tasks.findById(input.taskId);
    if (!task) throw AppError.notFound("Workflow task");
    if (task.status !== WorkflowHumanTaskStatus.OPEN) return;

    await this.tasks.update(task.id, {
      status: WorkflowHumanTaskStatus.COMPLETED,
      result: input.result as Prisma.InputJsonObject,
      closedAt: new Date(),
    });

    await this.audit.record({
      actorId: null,
      action: "workflowHumanTask.close",
      entityType: "WorkflowHumanTask",
      entityId: task.id,
      changes: { after: { status: WorkflowHumanTaskStatus.COMPLETED } },
    });
  }

  async cancelOpenWorkflowTasks(input:{orgId:string;workflowId:string;runId:string}) { await this.tasks.cancelOpenWorkflowTasks(input); }

  private async submitAction(
    task: Awaited<ReturnType<WorkflowHumanTaskModel["findById"]>>,
    action: WorkflowActionRegistration,
    input: Record<string, unknown>,
    receiptInput: {
      idempotencyKey: string;
      channel: WorkflowActionChannel;
      actorUserId?: string;
      tokenId?: string;
      submittedBy: string;
    }
  ) {
    if (!task) throw AppError.notFound("Workflow task");
    input = action.validateInput(input);
    const requestHash = this.hashJson({ actionKey: action.key, input });
    const existingReceipt = await this.tasks.findReceiptByIdempotencyKey(task.id, receiptInput.idempotencyKey);
    if (existingReceipt && existingReceipt.requestHash !== requestHash) {
      throw AppError.conflict("Workflow action idempotency key was already used for different input");
    }
    if (existingReceipt && (existingReceipt.actorUserId !== (receiptInput.actorUserId ?? null) || existingReceipt.tokenId !== (receiptInput.tokenId ?? null)))
      throw AppError.conflict("Workflow action belongs to a different actor");
    if (existingReceipt?.status === WorkflowActionReceiptStatus.SUCCEEDED) {
      return { task, receipt: existingReceipt, alreadySubmitted: true };
    }
    if (existingReceipt?.status === WorkflowActionReceiptStatus.FAILED) throw AppError.conflict("Workflow action requires operator reconciliation");
    if (task.status !== WorkflowHumanTaskStatus.OPEN && !existingReceipt) throw AppError.conflict("Workflow task is no longer open");

    let receipt: Awaited<ReturnType<WorkflowHumanTaskModel["createReceipt"]>>;
    try {
      receipt = existingReceipt ?? await this.tasks.createReceipt({
        orgId: task.orgId,
        taskId: task.id,
        workflowExecutionId: task.workflowExecutionId,
        actionKey: action.key,
        idempotencyKey: receiptInput.idempotencyKey,
        channel: receiptInput.channel,
        actorUserId: receiptInput.actorUserId,
        tokenId: receiptInput.tokenId,
        requestHash,
        result: input as Prisma.InputJsonObject,
      });
    } catch (error) {
      if ((error as { code?: string })?.code === "TASK_DELIVERY_CONFLICT") throw AppError.conflict("Workflow task already has a pending response");
      if (!this.isUniqueConstraintError(error)) throw error;
      const raced = await this.tasks.findReceiptByIdempotencyKey(task.id, receiptInput.idempotencyKey);
      if (!raced) throw error;
      if (raced.requestHash !== requestHash || raced.actorUserId !== (receiptInput.actorUserId ?? null) || raced.tokenId !== (receiptInput.tokenId ?? null)) {
        throw AppError.conflict("Workflow action idempotency key was already used for different input");
      }
      if (raced.status === WorkflowActionReceiptStatus.SUCCEEDED) {
        return { task, receipt: raced, alreadySubmitted: true };
      }
      receipt = raced;
    }

    const signalInput: WorkflowHumanActionInput & { operationId: string } = {
      operationId: receipt.id,
      taskId: task.id,
      actionKey: action.key,
      decision: String(input.decision ?? ""),
      comment: typeof input.comment === "string" && input.comment.trim() ? input.comment.trim() : undefined,
      payload: input,
      submittedAt: new Date().toISOString(),
      submittedBy: receiptInput.submittedBy,
      channel: receiptInput.channel,
      tokenId: receiptInput.tokenId,
    };

    // Temporal persists the Update result under receipt.id, so a lost response or
    // failed local commit can retrieve the same acknowledgement on retry.
    try {
      if(task.workflowExecution.actionProtocol === "update-v1") {
        const acknowledged = await this.temporal.submitHumanAction(task.workflowId,action.signalName,signalInput,task.runId ?? undefined);
        if(!acknowledged.accepted || acknowledged.operationId!==receipt.id)throw AppError.conflict("Workflow did not acknowledge this action");
      } else {
        await this.temporal.signalWorkflow(task.workflowId,action.signalName,[signalInput],task.runId ?? undefined);
      }
    } catch (error) {
      // Only a definitive Workflow rejection releases ownership. Transport errors
      // keep the operation pending for recovery under the same Update ID.
      if (error instanceof AppError && error.code === "WORKFLOW_ACTION_REJECTED") await this.tasks.rejectDelivery(task.id, receipt.id);
      throw error;
    }
    const committed = await this.tasks.commitDelivery({
      taskId: task.id, receiptId: receipt.id, tokenId: receiptInput.tokenId,
      result: {acknowledgement:task.workflowExecution.actionProtocol === "update-v1" ? "QUEUED" : "DELIVERED",businessOutcome:"PENDING",operationId:receipt.id},
      audit: { actorId: receiptInput.actorUserId ?? null, action: "workflowHumanTask.deliver",
        entityType: "WorkflowHumanTask", entityId: task.id,
        changes: { after: { actionKey: action.key, channel: receiptInput.channel, operationId: receipt.id, acknowledgement: "QUEUED" } } },
    });
    return { ...committed, alreadySubmitted: false };
  }

  private async issueEmailToken(taskId: string, recipientEmail: string, ttlHours: number) {
    const rawToken = randomBytes(32).toString("base64url");
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
    await this.tasks.createToken({
      taskId,
      tokenHash,
      recipientEmail,
      label: "Initial task email",
      expiresAt,
    });

    const publicAppUrl = await this.settings.get("PUBLIC_APP_URL", "http://localhost:3000");
    const taskUrl = this.absoluteTaskUrl(publicAppUrl ?? "http://localhost:3000", rawToken);

    await this.email.send({
      to: recipientEmail,
      subject: "Workflow task awaiting your response",
      templateName: "workflow-task",
      context: {
        taskUrl,
        expiresAt: expiresAt.toISOString(),
      },
    });
  }

  private absoluteTaskUrl(publicAppUrl: string, rawToken: string) {
    const normalizedBase = publicAppUrl.replace(/\/+$/, "");
    return `${normalizedBase}/workflow-task-tokens/${rawToken}`;
  }

  private async findValidToken(rawToken: string, allowConsumed = false) {
    const token = await this.tasks.findTokenByHash(this.hashToken(rawToken));
    if (!token) throw AppError.notFound("Workflow task token");
    if (token.deletedAt || token.revokedAt) throw AppError.forbidden("Workflow task token has been revoked");
    if (token.consumedAt && !allowConsumed) throw AppError.conflict("Workflow task token has already been used");
    if (token.expiresAt.getTime() <= Date.now()) throw AppError.forbidden("Workflow task token has expired");
    return token;
  }

  private getActionKey(task: { actionForm: Prisma.JsonValue }) {
    const form = task.actionForm;
    if (form && typeof form === "object" && !Array.isArray(form) && "actionKey" in form) {
      const value = (form as { actionKey?: unknown }).actionKey;
      if (typeof value === "string" && value) return value;
    }
    return "complete";
  }

  private getActionForTask(
    task: { workflowExecution: { workflowDefinition: { key: string } } },
    actionKey: string
  ) {
    const registration = getWorkflowRegistration(task.workflowExecution.workflowDefinition.key);
    const action = registration?.actions[actionKey];
    if (!registration || !action) throw AppError.notFound("Workflow action");
    return action;
  }

  private async resolveRoleIds(requirements: Array<{ roleId?: string; roleName?: string }>) {
    const roleIds = new Set<string>();
    for (const requirement of requirements) {
      if (requirement.roleId) roleIds.add(requirement.roleId);
      if (requirement.roleName) {
        const role = await this.tasks.findRoleByName(requirement.roleName);
        if (role) roleIds.add(role.id);
      }
    }
    return [...roleIds];
  }

  private async requireActiveOrg(userId: string, orgId?: string) {
    const context = await this.orgContext.resolveForUser(userId, orgId);
    if (!context.activeOrg) {
      throw AppError.badRequest("Select an organization before using workflow tasks");
    }
    return {
      ...context,
      activeOrg: context.activeOrg,
    };
  }

  private async assertCanAct(roleId: string) {
    const allowed = await this.permissions.can(roleId, "workflow", "act");
    if (!allowed) throw AppError.forbidden("Missing permission: workflow:act");
  }

  private hashToken(rawToken: string) {
    return createHash("sha256").update(rawToken).digest("hex");
  }

  private hashJson(value: unknown) {
    return stableHash(value);
  }
}

export const workflowHumanTaskService = new WorkflowHumanTaskService();
