import {
  condition,
  defineQuery,
  defineSignal,
  executeChild,
  isCancellation,
  patched,
  proxyActivities,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";
import type {
  HumanTaskActivities,
  IntegrationActivities,
  PlatformWorkflowContext,
  ProjectionActivities,
  ShowcaseActivities,
  WorkflowHumanActionInput,
} from "../contracts.js";

export interface PlatformTestWorkflowInput {
  message: string;
  durationSeconds: number;
  businessKey?: string;
}

export interface PlatformTestWorkflowState {
  message: string;
  phase: "running" | "completed" | "cancelled";
  durationSeconds: number;
  businessKey?: string;
  integration?: {
    providerKey: string;
    connectionId: string;
    replayed: boolean;
  };
}

export const platformTestStateQuery = defineQuery<PlatformTestWorkflowState>("platformTestState");
export const platformApprovalStateQuery = defineQuery<PlatformApprovalWorkflowState>("platformApprovalState");
export const platformApprovalActionSignal = defineSignal<[WorkflowHumanActionInput]>("platformApprovalAction");
export const customerOnboardingStateQuery = defineQuery<CustomerOnboardingState>("customerOnboardingState");
export const customerOnboardingActionSignal = defineSignal<[WorkflowHumanActionInput]>("customerOnboardingAction");
export const humanApprovalStateQuery = defineQuery<HumanApprovalState>("humanApprovalState");
export const humanApprovalReviewActionSignal = defineSignal<[WorkflowHumanActionInput]>("humanApprovalReviewAction");
export const humanApprovalResubmitActionSignal = defineSignal<[WorkflowHumanActionInput]>("humanApprovalResubmitAction");
export const orderFulfillmentSagaStateQuery = defineQuery<OrderFulfillmentSagaState>("orderFulfillmentSagaState");
export const dataSynchronizationStateQuery = defineQuery<DataSynchronizationState>("dataSynchronizationState");
export const employeeLifecycleStateQuery = defineQuery<EmployeeLifecycleState>("employeeLifecycleState");
export const employeeLifecycleChecklistActionSignal = defineSignal<[WorkflowHumanActionInput]>("employeeLifecycleChecklistAction");
export const clientEngagementStateQuery = defineQuery<ClientEngagementState>("clientEngagementState");
export const clientEngagementApprovalActionSignal = defineSignal<[WorkflowHumanActionInput]>("clientEngagementApprovalAction");
export const aiDocumentProcessingStateQuery = defineQuery<AiDocumentProcessingState>("aiDocumentProcessingState");
export const aiDocumentReviewActionSignal = defineSignal<[WorkflowHumanActionInput]>("aiDocumentReviewAction");
export const aiSupportAgentStateQuery = defineQuery<AiSupportAgentState>("aiSupportAgentState");
export const aiSupportAgentApprovalActionSignal = defineSignal<[WorkflowHumanActionInput]>("aiSupportAgentApprovalAction");
export const complianceReviewStateQuery = defineQuery<ComplianceReviewState>("complianceReviewState");
export const complianceReviewControlActionSignal = defineSignal<[WorkflowHumanActionInput]>("complianceReviewControlAction");
export const underwritingCapstoneStateQuery = defineQuery<UnderwritingCapstoneState>("underwritingCapstoneState");
export const underwritingCapstoneActionSignal = defineSignal<[WorkflowHumanActionInput]>("underwritingCapstoneAction");

const humanTasks = proxyActivities<HumanTaskActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    maximumAttempts: 20,
  },
});

const integrations = proxyActivities<IntegrationActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

const showcaseActivities = proxyActivities<ShowcaseActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "2 seconds",
    backoffCoefficient: 2,
    maximumInterval: "10 seconds",
    maximumAttempts: 5,
  },
});

const projections = proxyActivities<ProjectionActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    maximumInterval: "30 seconds",
    maximumAttempts: 10,
  },
});

async function ensureWorkflowExecutionProjection(input: unknown, context?: PlatformWorkflowContext) {
  if (!patched("workflow-execution-projection-ingestion-v1")) return;
  if (!context?.orgId || !context.startedById || !context.workflowDefinitionKey) return;
  const info = workflowInfo();
  await projections.ensureWorkflowExecutionProjection({
    orgId: context.orgId,
    workflowDefinitionKey: context.workflowDefinitionKey,
    startedById: context.startedById,
    workflowId: info.workflowId,
    runId: info.runId,
    scheduleId: context.scheduleId,
    input,
  });
}

export async function temporalPlatformHeartbeatWorkflow(
  input: Record<string, never> = {},
  context?: PlatformWorkflowContext
): Promise<string> {
  await ensureWorkflowExecutionProjection(input, context);
  return "ok";
}

export async function platformTestWorkflow(
  input: PlatformTestWorkflowInput,
  context: PlatformWorkflowContext
): Promise<PlatformTestWorkflowState> {
  const state: PlatformTestWorkflowState = {
    message: input.message,
    phase: "running",
    durationSeconds: input.durationSeconds,
    businessKey: input.businessKey,
  };

  setHandler(platformTestStateQuery, () => state);
  await ensureWorkflowExecutionProjection(input, context);

  try {
    const integration = await integrations.runSyntheticIntegration({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      idempotencyKey: `${workflowInfo().workflowId}:syntheticEcho`,
      payload: {
        message: input.message,
        businessKey: input.businessKey ?? null,
      },
    });
    state.integration = {
      providerKey: integration.providerKey,
      connectionId: integration.connectionId,
      replayed: integration.replayed,
    };
    await sleep(input.durationSeconds * 1000);
    state.phase = "completed";
    return state;
  } catch (err) {
    if (isCancellation(err)) {
      state.phase = "cancelled";
    }
    throw err;
  }
}

export interface PlatformApprovalWorkflowInput {
  title: string;
  instructions: string;
  assignedUserEmail?: string;
  businessKey?: string;
}

export interface PlatformApprovalWorkflowState {
  phase: "waiting" | "approved" | "rejected" | "changes_requested" | "cancelled";
  title: string;
  taskId?: string;
  decision?: string;
  comment?: string;
  submittedBy?: string;
}

export async function platformApprovalWorkflow(
  input: PlatformApprovalWorkflowInput,
  context: PlatformWorkflowContext
): Promise<PlatformApprovalWorkflowState> {
  const state: PlatformApprovalWorkflowState = {
    phase: "waiting",
    title: input.title,
  };
  let action: WorkflowHumanActionInput | undefined;

  setHandler(platformApprovalStateQuery, () => state);
  setHandler(platformApprovalActionSignal, (submitted) => {
    if (!action) action = submitted;
  });
  await ensureWorkflowExecutionProjection(input, context);

  try {
    const info = workflowInfo();
    const task = await humanTasks.createHumanTask({
      orgId: context.orgId,
      workflowId: info.workflowId,
      runId: info.runId,
      taskKey: "approval",
      taskType: "approval",
      title: input.title,
      description: input.instructions,
      assignedUserEmail: input.assignedUserEmail,
      roleRequirements: [{ roleName: "ADMIN" }],
      actionKey: "complete",
      actionForm: {
        fields: [
          {
            key: "decision",
            label: "Decision",
            type: "select",
            required: true,
            options: [
              { label: "Approve", value: "approved" },
              { label: "Reject", value: "rejected" },
              { label: "Request changes", value: "changes_requested" },
            ],
          },
          {
            key: "comment",
            label: "Comment",
            type: "textarea",
            helpText: "Optional context for the requester.",
          },
        ],
      },
      context: {
        workflowDefinitionKey: context.workflowDefinitionKey,
        businessKey: input.businessKey ?? null,
      },
      tokenTtlHours: 72,
    });

    state.taskId = task.taskId;
    await condition(() => action !== undefined);

    state.decision = action?.decision;
    state.comment = action?.comment;
    state.submittedBy = action?.submittedBy;
    state.phase =
      action?.decision === "approved"
        ? "approved"
        : action?.decision === "changes_requested"
          ? "changes_requested"
          : "rejected";

    await humanTasks.closeHumanTask({
      taskId: task.taskId,
      result: {
        decision: state.decision,
        comment: state.comment ?? null,
        submittedBy: state.submittedBy ?? null,
        channel: action?.channel ?? "AUTHENTICATED",
      },
    });

    return state;
  } catch (err) {
    if (isCancellation(err)) {
      state.phase = "cancelled";
    }
    throw err;
  }
}

export interface CustomerOnboardingWorkflowInput {
  customerId: string;
  companyName: string;
  primaryContact: {
    name: string;
    email: string;
  };
  requestedUsers: string[];
  requestedIntegrations: string[];
  planTier: "growth" | "enterprise";
  businessKey?: string;
}

export type CustomerOnboardingStatus =
  | "created"
  | "provisioning_workspace"
  | "provisioning_users"
  | "configuring_integrations"
  | "running_validation"
  | "waiting_for_customer_approval"
  | "activating_account"
  | "completed"
  | "rejected"
  | "cancelled"
  | "failed";

export interface CustomerOnboardingState {
  customerId: string;
  companyName: string;
  currentStep: string;
  status: CustomerOnboardingStatus;
  completedSteps: string[];
  pendingSteps: string[];
  customerApprovalStatus: "pending" | "approved" | "rejected";
  rejectionReason?: string;
  lastError?: string;
  workspaceUrl?: string;
  provisionedUsers: string[];
  configuredIntegrations: string[];
}

export async function customerOnboardingWorkflow(
  input: CustomerOnboardingWorkflowInput,
  context: PlatformWorkflowContext
): Promise<CustomerOnboardingState> {
  const allSteps = [
    "Create Workspace",
    "Provision Users",
    "Configure Integrations",
    "Run Validation",
    "Wait for Customer Approval",
    "Activate Account",
  ];
  const state: CustomerOnboardingState = {
    customerId: input.customerId,
    companyName: input.companyName,
    currentStep: "Initializing",
    status: "created",
    completedSteps: [],
    pendingSteps: [...allSteps],
    customerApprovalStatus: "pending",
    provisionedUsers: [],
    configuredIntegrations: [],
  };
  let action: WorkflowHumanActionInput | undefined;

  setHandler(customerOnboardingStateQuery, () => state);
  setHandler(customerOnboardingActionSignal, (submitted) => {
    if (!action && state.status === "waiting_for_customer_approval") action = submitted;
  });
  await ensureWorkflowExecutionProjection(input, context);

  const info = workflowInfo();
  const runSyntheticStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}`,
      payload,
    });

  const completeStep = (stepName: string) => {
    if (!state.completedSteps.includes(stepName)) state.completedSteps.push(stepName);
    const index = state.pendingSteps.indexOf(stepName);
    if (index >= 0) state.pendingSteps.splice(index, 1);
    state.lastError = undefined;
  };

  const runStep = async <T>(
    stepName: string,
    status: CustomerOnboardingStatus,
    fn: () => Promise<T>
  ): Promise<T> => {
    state.currentStep = stepName;
    state.status = status;
    const index = state.pendingSteps.indexOf(stepName);
    if (index >= 0) state.pendingSteps.splice(index, 1);
    try {
      const result = await fn();
      completeStep(stepName);
      return result;
    } catch (err) {
      state.status = "failed";
      state.lastError = err instanceof Error ? err.message : "Workflow step failed";
      throw err;
    }
  };

  try {
    const workspace = await runStep("Create Workspace", "provisioning_workspace", () =>
      runSyntheticStep("createWorkspace", {
        customerId: input.customerId,
        companyName: input.companyName,
        planTier: input.planTier,
      })
    );
    state.workspaceUrl = String(workspace.echoed.workspaceUrl ?? `https://${input.customerId}.workspace.example.com`);

    await runStep("Provision Users", "provisioning_users", async () => {
      for (const email of input.requestedUsers) {
        await showcaseActivities.runShowcaseSyntheticStep({
          orgId: context.orgId,
          workflowDefinitionKey: context.workflowDefinitionKey,
          requirementKey: "syntheticEcho",
          stepKey: "provisionUser",
          idempotencyKey: `${info.workflowId}:provisionUser:${email}`,
          payload: {
            customerId: input.customerId,
            email,
          },
        });
        state.provisionedUsers.push(email);
      }
    });

    if (input.requestedIntegrations.length > 0) {
      await runStep("Configure Integrations", "configuring_integrations", async () => {
        for (const integrationName of input.requestedIntegrations) {
          await showcaseActivities.runShowcaseSyntheticStep({
            orgId: context.orgId,
            workflowDefinitionKey: context.workflowDefinitionKey,
            requirementKey: "syntheticEcho",
            stepKey: "configureIntegration",
            idempotencyKey: `${info.workflowId}:configureIntegration:${integrationName}`,
            payload: {
              customerId: input.customerId,
              integrationName,
            },
          });
          state.configuredIntegrations.push(integrationName);
        }
      });
    } else {
      const index = state.pendingSteps.indexOf("Configure Integrations");
      if (index >= 0) state.pendingSteps.splice(index, 1);
    }

    await runStep("Run Validation", "running_validation", () =>
      runSyntheticStep("validateOnboarding", {
        customerId: input.customerId,
        users: input.requestedUsers.length,
        integrations: input.requestedIntegrations,
      })
    );

    state.currentStep = "Wait for Customer Approval";
    state.status = "waiting_for_customer_approval";
    const approvalIndex = state.pendingSteps.indexOf(state.currentStep);
    if (approvalIndex >= 0) state.pendingSteps.splice(approvalIndex, 1);

    const task = await humanTasks.createHumanTask({
      orgId: context.orgId,
      workflowId: info.workflowId,
      runId: info.runId,
      taskKey: "customer-approval",
      taskType: "customer_onboarding_approval",
      title: `Approve onboarding for ${input.companyName}`,
      description: `Workspace provisioning is complete for ${input.companyName}. Review the setup and approve activation or reject with a reason.`,
      assignedUserEmail: input.primaryContact.email,
      roleRequirements: [{ roleName: "ADMIN" }],
      actionKey: "customerDecision",
      actionForm: { fields: [] },
      context: {
        workflowDefinitionKey: context.workflowDefinitionKey,
        customerId: input.customerId,
        companyName: input.companyName,
        workspaceUrl: state.workspaceUrl ?? null,
      },
      tokenTtlHours: 72,
    });

    await condition(() => action !== undefined);

    if (action?.decision === "rejected") {
      state.status = "rejected";
      state.currentStep = "Onboarding Rejected";
      state.customerApprovalStatus = "rejected";
      state.rejectionReason = action.comment ?? "Rejected without a reason";
      await humanTasks.closeHumanTask({
        taskId: task.taskId,
        result: {
          decision: state.customerApprovalStatus,
          reason: state.rejectionReason,
          submittedBy: action.submittedBy ?? null,
          channel: action.channel,
        },
      });
      return state;
    }

    state.customerApprovalStatus = "approved";
    completeStep("Wait for Customer Approval");
    await humanTasks.closeHumanTask({
      taskId: task.taskId,
      result: {
        decision: state.customerApprovalStatus,
        submittedBy: action?.submittedBy ?? null,
        channel: action?.channel ?? "AUTHENTICATED",
      },
    });

    await runStep("Activate Account", "activating_account", () =>
      runSyntheticStep("activateAccount", {
        customerId: input.customerId,
        companyName: input.companyName,
        workspaceUrl: state.workspaceUrl ?? null,
      })
    );

    state.status = "completed";
    state.currentStep = "Completed";
    return state;
  } catch (err) {
    if (isCancellation(err)) {
      state.status = "cancelled";
      state.currentStep = "Cancelled";
    }
    throw err;
  }
}

export interface HumanApprovalWorkflowInput {
  requestId: string;
  requestType: string;
  requester: string;
  requesterEmail?: string;
  amount: number;
  description: string;
  threshold: number;
  escalationSeconds: number;
  businessKey?: string;
}

export type HumanApprovalStatus =
  | "submitted"
  | "checking"
  | "waiting_for_approval"
  | "approval_overdue"
  | "waiting_for_resubmission"
  | "approved"
  | "rejected"
  | "cancelled"
  | "failed";

export interface HumanApprovalDecisionRecord {
  timestamp: string;
  status: "approved" | "rejected" | "changes_requested" | "resubmitted";
  approver?: string;
  reason?: string;
  notes?: string;
}

export interface HumanApprovalState {
  requestId: string;
  requestType: string;
  requester: string;
  amount: number;
  description: string;
  threshold: number;
  status: HumanApprovalStatus;
  currentApprover?: string;
  decisionHistory: HumanApprovalDecisionRecord[];
  outstandingChangesRequest?: string;
  escalated: boolean;
  riskScore?: number;
  taskId?: string;
  resubmissionTaskId?: string;
}

export async function humanApprovalWorkflow(
  input: HumanApprovalWorkflowInput,
  context: PlatformWorkflowContext
): Promise<HumanApprovalState> {
  let request = { ...input };
  const state: HumanApprovalState = {
    requestId: request.requestId,
    requestType: request.requestType,
    requester: request.requester,
    amount: request.amount,
    description: request.description,
    threshold: request.threshold,
    status: "submitted",
    decisionHistory: [],
    escalated: false,
  };
  let reviewAction: WorkflowHumanActionInput | undefined;
  let resubmitAction: WorkflowHumanActionInput | undefined;
  const info = workflowInfo();

  setHandler(humanApprovalStateQuery, () => state);
  setHandler(humanApprovalReviewActionSignal, (submitted) => {
    if (!reviewAction && (state.status === "waiting_for_approval" || state.status === "approval_overdue")) {
      reviewAction = submitted;
    }
  });
  setHandler(humanApprovalResubmitActionSignal, (submitted) => {
    if (!resubmitAction && state.status === "waiting_for_resubmission") {
      resubmitAction = submitted;
    }
  });
  await ensureWorkflowExecutionProjection(input, context);

  const runSyntheticStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}:${state.decisionHistory.length}`,
      payload,
    });

  const timestamp = () => new Date().toISOString();

  try {
    while (state.status !== "approved" && state.status !== "rejected") {
      reviewAction = undefined;
      resubmitAction = undefined;
      state.status = "checking";
      state.currentApprover = undefined;

      const check = await runSyntheticStep("runApprovalChecks", {
        requestId: request.requestId,
        amount: request.amount,
        threshold: request.threshold,
      });
      const riskScore = request.amount > 5000 ? 80 : 20;
      state.riskScore = Number(check.echoed.riskScore ?? riskScore);

      if (request.amount < request.threshold) {
        state.status = "approved";
        state.decisionHistory.push({
          timestamp: timestamp(),
          status: "approved",
          reason: "Auto-approved because amount is below threshold",
        });
        await runSyntheticStep("recordDecision", {
          requestId: request.requestId,
          status: "approved",
          mode: "automatic",
        });
        return state;
      }

      state.status = "waiting_for_approval";
      state.currentApprover = "Manager";
      const reviewTask = await humanTasks.createHumanTask({
        orgId: context.orgId,
        workflowId: info.workflowId,
        runId: info.runId,
        taskKey: `manager-review-${state.decisionHistory.length}`,
        taskType: "human_approval_manager_review",
        title: `Review ${request.requestType}: ${request.requestId}`,
        description: `${request.requester} requested approval for ${request.description} ($${request.amount}).`,
        roleRequirements: [{ roleName: "ADMIN" }],
        actionKey: "managerReview",
        actionForm: { fields: [] },
        context: {
          workflowDefinitionKey: context.workflowDefinitionKey,
          requestId: request.requestId,
          amount: request.amount,
          threshold: request.threshold,
        },
        tokenTtlHours: 72,
      });
      state.taskId = reviewTask.taskId;

      const actedBeforeEscalation = await condition(
        () => reviewAction !== undefined,
        `${request.escalationSeconds} seconds`
      );

      if (!actedBeforeEscalation) {
        state.status = "approval_overdue";
        state.escalated = true;
        await runSyntheticStep("sendEscalation", {
          requestId: request.requestId,
          amount: request.amount,
          threshold: request.threshold,
        });
        await condition(() => reviewAction !== undefined);
      }

      const submittedReview = reviewAction as WorkflowHumanActionInput | undefined;
      if (!submittedReview) {
        throw new Error("Human approval review action was not received");
      }

      if (submittedReview.decision === "approved") {
        state.status = "approved";
        state.decisionHistory.push({
          timestamp: timestamp(),
          status: "approved",
          approver: submittedReview.submittedBy,
          notes: submittedReview.comment,
        });
        await runSyntheticStep("recordDecision", {
          requestId: request.requestId,
          status: "approved",
          approver: submittedReview.submittedBy ?? null,
        });
        await humanTasks.closeHumanTask({
          taskId: reviewTask.taskId,
          result: {
            decision: "approved",
            submittedBy: submittedReview.submittedBy ?? null,
            channel: submittedReview.channel,
          },
        });
      } else if (submittedReview.decision === "rejected") {
        state.status = "rejected";
        state.decisionHistory.push({
          timestamp: timestamp(),
          status: "rejected",
          approver: submittedReview.submittedBy,
          reason: submittedReview.comment ?? "Rejected without a reason",
        });
        await runSyntheticStep("recordDecision", {
          requestId: request.requestId,
          status: "rejected",
          reason: submittedReview.comment ?? null,
        });
        await humanTasks.closeHumanTask({
          taskId: reviewTask.taskId,
          result: {
            decision: "rejected",
            reason: submittedReview.comment ?? null,
            submittedBy: submittedReview.submittedBy ?? null,
            channel: submittedReview.channel,
          },
        });
      } else if (submittedReview.decision === "changes_requested") {
        state.status = "waiting_for_resubmission";
        state.outstandingChangesRequest = submittedReview.comment ?? "Changes requested";
        state.decisionHistory.push({
          timestamp: timestamp(),
          status: "changes_requested",
          approver: submittedReview.submittedBy,
          notes: state.outstandingChangesRequest,
        });
        await humanTasks.closeHumanTask({
          taskId: reviewTask.taskId,
          result: {
            decision: "changes_requested",
            notes: state.outstandingChangesRequest,
            submittedBy: submittedReview.submittedBy ?? null,
            channel: submittedReview.channel,
          },
        });

        const resubmissionTask = await humanTasks.createHumanTask({
          orgId: context.orgId,
          workflowId: info.workflowId,
          runId: info.runId,
          taskKey: `requester-resubmission-${state.decisionHistory.length}`,
          taskType: "human_approval_resubmission",
          title: `Resubmit ${request.requestType}: ${request.requestId}`,
          description: state.outstandingChangesRequest,
          assignedUserEmail: request.requesterEmail,
          roleRequirements: [{ roleName: "ADMIN" }],
          actionKey: "resubmit",
          actionForm: { fields: [] },
          context: {
            workflowDefinitionKey: context.workflowDefinitionKey,
            requestId: request.requestId,
            currentAmount: request.amount,
            currentDescription: request.description,
          },
          tokenTtlHours: 72,
        });
        state.resubmissionTaskId = resubmissionTask.taskId;

        await condition(() => resubmitAction !== undefined);
        const submittedResubmission = resubmitAction as WorkflowHumanActionInput | undefined;
        if (!submittedResubmission) {
          throw new Error("Human approval resubmission action was not received");
        }

        request = {
          ...request,
          amount: Number(submittedResubmission.payload?.newAmount ?? request.amount),
          description: String(submittedResubmission.payload?.newDescription ?? request.description),
        };
        state.amount = request.amount;
        state.description = request.description;
        state.outstandingChangesRequest = undefined;
        state.decisionHistory.push({
          timestamp: timestamp(),
          status: "resubmitted",
          notes: `Amount updated to ${request.amount}`,
        });
        await humanTasks.closeHumanTask({
          taskId: resubmissionTask.taskId,
          result: {
            decision: "resubmitted",
            amount: request.amount,
            description: request.description,
            submittedBy: submittedResubmission.submittedBy ?? null,
            channel: submittedResubmission.channel,
          },
        });
      }
    }

    return state;
  } catch (err) {
    if (isCancellation(err)) {
      state.status = "cancelled";
      return state;
    }
    state.status = "failed";
    throw err;
  }
}

export interface OrderFulfillmentItem {
  id: string;
  quantity: number;
  price: number;
}

export interface OrderFulfillmentSagaWorkflowInput {
  orderId: string;
  customerId: string;
  items: OrderFulfillmentItem[];
  paymentTokenRef: string;
  shippingAddress: string;
  email: string;
  fulfillmentScenario: "happy_path" | "shipment_rejected";
  businessKey?: string;
}

export type OrderFulfillmentSagaStatus =
  | "created"
  | "reserving_inventory"
  | "charging_payment"
  | "creating_shipment"
  | "sending_confirmation"
  | "completed"
  | "compensating"
  | "compensated"
  | "cancelled"
  | "failed";

export interface OrderFulfillmentSagaState {
  orderId: string;
  customerId: string;
  status: OrderFulfillmentSagaStatus;
  totalAmount: number;
  completedSideEffects: string[];
  compensationHistory: string[];
  lastError?: string;
  inventoryState: "idle" | "reserved" | "released";
  paymentState: "idle" | "charged" | "refunded";
  shipmentState: "idle" | "created" | "cancelled";
  orderRecordState: "idle" | "created" | "cancelled";
  trackingNumber?: string;
  transactionId?: string;
}

export async function orderFulfillmentSagaWorkflow(
  input: OrderFulfillmentSagaWorkflowInput,
  context: PlatformWorkflowContext
): Promise<OrderFulfillmentSagaState> {
  const info = workflowInfo();
  const state: OrderFulfillmentSagaState = {
    orderId: input.orderId,
    customerId: input.customerId,
    status: "created",
    totalAmount: input.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
    completedSideEffects: [],
    compensationHistory: [],
    inventoryState: "idle",
    paymentState: "idle",
    shipmentState: "idle",
    orderRecordState: "idle",
  };
  const compensations: Array<{ name: string; run: () => Promise<void> }> = [];

  setHandler(orderFulfillmentSagaStateQuery, () => state);
  await ensureWorkflowExecutionProjection(input, context);

  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}`,
      payload,
    });

  try {
    await runStep("createOrder", {
      orderId: input.orderId,
      customerId: input.customerId,
      itemCount: input.items.length,
      totalAmount: state.totalAmount,
    });
    state.orderRecordState = "created";
    state.completedSideEffects.push("Create Order Record");
    compensations.push({
      name: "Cancel Order",
      run: async () => {
        await runStep("cancelOrder", { orderId: input.orderId });
        state.orderRecordState = "cancelled";
      },
    });

    state.status = "reserving_inventory";
    await runStep("reserveInventory", {
      orderId: input.orderId,
      items: input.items,
    });
    state.inventoryState = "reserved";
    state.completedSideEffects.push("Reserve Inventory");
    compensations.push({
      name: "Release Inventory",
      run: async () => {
        await runStep("releaseInventory", { orderId: input.orderId, items: input.items });
        state.inventoryState = "released";
      },
    });

    state.status = "charging_payment";
    const payment = await runStep("chargePayment", {
      orderId: input.orderId,
      amount: state.totalAmount,
      paymentTokenRef: input.paymentTokenRef,
    });
    state.transactionId = String(payment.echoed.transactionId ?? `tx_${input.orderId}`);
    state.paymentState = "charged";
    state.completedSideEffects.push("Charge Payment");
    compensations.push({
      name: "Refund Payment",
      run: async () => {
        await runStep("refundPayment", { orderId: input.orderId, amount: state.totalAmount });
        state.paymentState = "refunded";
      },
    });

    state.status = "creating_shipment";
    if (input.fulfillmentScenario === "shipment_rejected") {
      throw new Error("Synthetic shipping carrier rejected the shipment");
    }
    const shipment = await runStep("createShipment", {
      orderId: input.orderId,
      shippingAddress: input.shippingAddress,
    });
    state.trackingNumber = String(shipment.echoed.trackingNumber ?? `tr_${input.orderId}`);
    state.shipmentState = "created";
    state.completedSideEffects.push("Create Shipment");
    compensations.push({
      name: "Cancel Shipment",
      run: async () => {
        await runStep("cancelShipment", { orderId: input.orderId, trackingNumber: state.trackingNumber ?? null });
        state.shipmentState = "cancelled";
      },
    });

    state.status = "sending_confirmation";
    await runStep("sendOrderConfirmation", {
      orderId: input.orderId,
      email: input.email,
      trackingNumber: state.trackingNumber ?? null,
    });
    state.completedSideEffects.push("Send Confirmation");

    state.status = "completed";
    return state;
  } catch (err) {
    if (isCancellation(err)) {
      state.status = "cancelled";
      throw err;
    }

    state.lastError = err instanceof Error ? err.message : "Order fulfillment failed";
    state.status = "compensating";
    for (let index = compensations.length - 1; index >= 0; index -= 1) {
      const compensation = compensations[index];
      await compensation.run();
      state.compensationHistory.push(compensation.name);
    }
    state.status = "compensated";
    return state;
  }
}

export type DataSyncTarget = "crm" | "erp" | "billing";

export interface DataSynchronizationWorkflowInput {
  sourceRecordId: string;
  eventId: string;
  sourceSystem: string;
  changedFields: string[];
  targetSystems: DataSyncTarget[];
  validationScenario: "all_match" | "reconcile_first_target";
  businessKey?: string;
}

export type DataSynchronizationStatus =
  | "created"
  | "fetching_source"
  | "transforming"
  | "syncing_targets"
  | "validating"
  | "reconciling"
  | "completed"
  | "failed";

export interface DataSynchronizationTargetState {
  target: DataSyncTarget;
  status: "pending" | "running" | "succeeded" | "failed" | "validated";
  attempts: number;
  idempotencyKey: string;
  lastError?: string;
  externalRecordId?: string;
  lastSyncedAt?: string;
  validationMessage?: string;
  reconciled?: boolean;
}

export interface DataSynchronizationState {
  sourceRecordId: string;
  eventId: string;
  sourceSystem: string;
  status: DataSynchronizationStatus;
  currentStep: string;
  changedFields: string[];
  requiredTargets: DataSyncTarget[];
  sourceRecord?: Record<string, unknown>;
  canonicalCustomer?: Record<string, unknown>;
  targets: Record<DataSyncTarget, DataSynchronizationTargetState>;
  validation?: {
    valid: boolean;
    checkedTargets: DataSyncTarget[];
    mismatchedTargets: DataSyncTarget[];
    messages: Record<string, string>;
  };
  completedSteps: string[];
  lastError?: string;
}

const createDataSyncTargetState = (
  target: DataSyncTarget,
  eventId: string,
  sourceRecordId: string
): DataSynchronizationTargetState => ({
  target,
  status: "pending",
  attempts: 0,
  idempotencyKey: `${eventId}:${target}:ext_${sourceRecordId}`,
});

export async function dataSynchronizationWorkflow(
  input: DataSynchronizationWorkflowInput,
  context: PlatformWorkflowContext
): Promise<DataSynchronizationState> {
  const info = workflowInfo();
  const requiredTargets = input.targetSystems.length > 0 ? input.targetSystems : ["crm", "erp", "billing"] as DataSyncTarget[];
  const state: DataSynchronizationState = {
    sourceRecordId: input.sourceRecordId,
    eventId: input.eventId,
    sourceSystem: input.sourceSystem,
    status: "created",
    currentStep: "Created",
    changedFields: [...input.changedFields],
    requiredTargets: [...requiredTargets],
    targets: {
      crm: createDataSyncTargetState("crm", input.eventId, input.sourceRecordId),
      erp: createDataSyncTargetState("erp", input.eventId, input.sourceRecordId),
      billing: createDataSyncTargetState("billing", input.eventId, input.sourceRecordId),
    },
    completedSteps: [],
  };

  setHandler(dataSynchronizationStateQuery, () => state);
  await ensureWorkflowExecutionProjection(input, context);

  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}:${String(payload.target ?? payload.sourceRecordId ?? "all")}`,
      payload,
    });

  try {
    state.status = "fetching_source";
    state.currentStep = "Fetch Source Record";
    const source = await runStep("fetchSourceRecord", {
      sourceRecordId: input.sourceRecordId,
      sourceSystem: input.sourceSystem,
      changedFields: input.changedFields,
    });
    state.sourceRecord = {
      sourceRecordId: input.sourceRecordId,
      sourceSystem: input.sourceSystem,
      externalCustomerId: `ext_${input.sourceRecordId}`,
      legalName: String(source.echoed.legalName ?? "Northstar Manufacturing Group"),
      contactEmail: input.changedFields.includes("primaryContact")
        ? "maya.chen@northstar.example"
        : "jordan.lee@northstar.example",
      lifecycleStatus: input.changedFields.includes("status") ? "active" : "prospect",
    };
    state.completedSteps.push(state.currentStep);

    state.status = "transforming";
    state.currentStep = "Transform Canonical Model";
    const transformed = await runStep("transformCustomer", {
      sourceRecordId: input.sourceRecordId,
      sourceSystem: input.sourceSystem,
    });
    state.canonicalCustomer = {
      externalCustomerId: `ext_${input.sourceRecordId}`,
      companyName: String(transformed.echoed.companyName ?? state.sourceRecord.legalName),
      billingAccount: `ba_${input.sourceRecordId}`,
      primaryContact: {
        name: input.changedFields.includes("primaryContact") ? "Maya Chen" : "Jordan Lee",
        email: state.sourceRecord.contactEmail,
      },
      status: state.sourceRecord.lifecycleStatus,
      segment: "enterprise",
    };
    state.completedSteps.push(state.currentStep);

    state.status = "syncing_targets";
    state.currentStep = "Synchronize Destination Systems";
    await Promise.all(requiredTargets.map(async (target) => {
      const targetState = state.targets[target];
      targetState.status = "running";
      targetState.lastError = undefined;
      const result = await runStep(`sync.${target}`, {
        target,
        eventId: input.eventId,
        canonicalCustomer: state.canonicalCustomer ?? {},
      });
      targetState.status = "succeeded";
      targetState.attempts = Number(result.echoed.attempts ?? 1);
      targetState.externalRecordId = String(result.echoed.externalRecordId ?? `${target}_ext_${input.sourceRecordId}`);
      targetState.lastSyncedAt = new Date().toISOString();
    }));
    state.completedSteps.push(state.currentStep);

    state.status = "validating";
    state.currentStep = "Validate Destination Consistency";
    await runStep("validateTargets", {
      eventId: input.eventId,
      targets: requiredTargets,
      validationScenario: input.validationScenario,
    });
    const mismatchedTargets = input.validationScenario === "reconcile_first_target" ? requiredTargets.slice(0, 1) : [];
    state.validation = {
      valid: mismatchedTargets.length === 0,
      checkedTargets: [...requiredTargets],
      mismatchedTargets,
      messages: requiredTargets.reduce<Record<string, string>>((messages, target) => {
        messages[target] = mismatchedTargets.includes(target)
          ? `${target.toUpperCase()} has stale values for ext_${input.sourceRecordId}`
          : `${target.toUpperCase()} matches canonical customer ext_${input.sourceRecordId}`;
        return messages;
      }, {}),
    };

    for (const target of requiredTargets) {
      state.targets[target].validationMessage = state.validation.messages[target];
      if (state.validation.valid) state.targets[target].status = "validated";
    }

    if (!state.validation.valid) {
      state.status = "reconciling";
      state.currentStep = "Reconcile Mismatched Systems";
      await Promise.all(mismatchedTargets.map(async (target) => {
        const result = await runStep(`reconcile.${target}`, {
          target,
          eventId: input.eventId,
          canonicalCustomer: state.canonicalCustomer ?? {},
        });
        state.targets[target].attempts = Math.max(state.targets[target].attempts, Number(result.echoed.attempts ?? 1));
        state.targets[target].externalRecordId = String(result.echoed.externalRecordId ?? `${target}_ext_${input.sourceRecordId}`);
        state.targets[target].lastSyncedAt = new Date().toISOString();
        state.targets[target].reconciled = true;
        state.targets[target].status = "succeeded";
        state.targets[target].validationMessage = `${target.toUpperCase()} reconciled to canonical customer ext_${input.sourceRecordId}`;
      }));
      state.completedSteps.push(state.currentStep);

      state.status = "validating";
      state.currentStep = "Validate Reconciled Systems";
      state.validation = {
        valid: true,
        checkedTargets: [...requiredTargets],
        mismatchedTargets: [],
        messages: requiredTargets.reduce<Record<string, string>>((messages, target) => {
          messages[target] = state.targets[target].reconciled
            ? state.targets[target].validationMessage ?? `${target.toUpperCase()} reconciled`
            : `${target.toUpperCase()} matches canonical customer ext_${input.sourceRecordId}`;
          return messages;
        }, {}),
      };
      for (const target of requiredTargets) {
        state.targets[target].status = "validated";
        state.targets[target].validationMessage = state.validation.messages[target];
      }
    }

    state.completedSteps.push(state.currentStep);
    state.status = "completed";
    state.currentStep = "Completed";
    return state;
  } catch (err) {
    state.status = "failed";
    state.lastError = err instanceof Error ? err.message : "Data synchronization failed";
    return state;
  }
}

export type EmployeeSystem = "email" | "github" | "saas";
export type EmployeeLifecycleStatus =
  | "hired"
  | "waiting_for_provisioning_window"
  | "creating_identity"
  | "provisioning_access"
  | "waiting_for_manager_checklist"
  | "waiting_for_post_start_review"
  | "verifying_access"
  | "completed"
  | "cancelling"
  | "cancelled"
  | "failed";

export interface EmployeeLifecycleWorkflowInput {
  employeeId: string;
  name: string;
  manager: string;
  managerEmail?: string;
  department: string;
  startDate: string;
  requestedSystems: EmployeeSystem[];
  accessProfile: string;
  provisioningLeadTimeSeconds: number;
  postStartReviewSeconds: number;
  businessKey?: string;
}

export interface EmployeeSystemState {
  system: EmployeeSystem;
  status: "pending" | "running" | "provisioned" | "failed" | "deprovisioned" | "verified";
  externalAccountId?: string;
  attempts: number;
  idempotencyKey: string;
  lastError?: string;
}

export interface EmployeeLifecycleState {
  employeeId: string;
  name: string;
  manager: string;
  department: string;
  accessProfile: string;
  startDate: string;
  status: EmployeeLifecycleStatus;
  currentStep: string;
  requestedSystems: EmployeeSystem[];
  systems: Record<EmployeeSystem, EmployeeSystemState>;
  identityState: "pending" | "running" | "created" | "deprovisioned" | "failed";
  identityId?: string;
  managerChecklistStatus: "pending" | "waiting" | "completed";
  managerChecklistCompletedBy?: string;
  managerChecklistNotes?: string;
  managerChecklistTaskId?: string;
  nextScheduledAction?: {
    label: string;
    at: string;
  };
  timeline: Array<{
    timestamp: string;
    status: EmployeeLifecycleStatus;
    message: string;
  }>;
  failedSystems: EmployeeSystem[];
  lastError?: string;
}

const allEmployeeSystems: EmployeeSystem[] = ["email", "github", "saas"];

const createEmployeeSystemState = (system: EmployeeSystem, employeeId: string): EmployeeSystemState => ({
  system,
  status: "pending",
  attempts: 0,
  idempotencyKey: `${employeeId}:${system}`,
});

export async function employeeLifecycleWorkflow(
  input: EmployeeLifecycleWorkflowInput,
  context: PlatformWorkflowContext
): Promise<EmployeeLifecycleState> {
  const info = workflowInfo();
  await ensureWorkflowExecutionProjection(input, context);
  let checklistAction: WorkflowHumanActionInput | undefined;
  const state: EmployeeLifecycleState = {
    employeeId: input.employeeId,
    name: input.name,
    manager: input.manager,
    department: input.department,
    accessProfile: input.accessProfile,
    startDate: input.startDate,
    status: "hired",
    currentStep: "Hired",
    requestedSystems: [...input.requestedSystems],
    systems: {
      email: createEmployeeSystemState("email", input.employeeId),
      github: createEmployeeSystemState("github", input.employeeId),
      saas: createEmployeeSystemState("saas", input.employeeId),
    },
    identityState: "pending",
    managerChecklistStatus: "pending",
    timeline: [],
    failedSystems: [],
  };

  const timestamp = () => new Date().toISOString();
  const remember = (status: EmployeeLifecycleStatus, message: string) => {
    state.timeline.push({ timestamp: timestamp(), status, message });
  };
  const setStatus = (status: EmployeeLifecycleStatus, step: string, message: string) => {
    state.status = status;
    state.currentStep = step;
    remember(status, message);
  };
  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}:${String(payload.system ?? payload.employeeId ?? "all")}`,
      payload,
    });

  setHandler(employeeLifecycleStateQuery, () => state);
  setHandler(employeeLifecycleChecklistActionSignal, (submitted) => {
    if (!checklistAction && state.managerChecklistStatus === "waiting") {
      checklistAction = submitted;
    }
  });

  try {
    remember("hired", `Employee ${input.employeeId} lifecycle started`);

    if (input.provisioningLeadTimeSeconds > 0) {
      state.nextScheduledAction = {
        label: "Provision access",
        at: new Date(Date.now() + input.provisioningLeadTimeSeconds * 1000).toISOString(),
      };
      setStatus("waiting_for_provisioning_window", "Wait for Provisioning Window", "Waiting for scheduled provisioning window");
      await sleep(input.provisioningLeadTimeSeconds * 1000);
      state.nextScheduledAction = undefined;
    }

    setStatus("creating_identity", "Create Identity", "Creating employee identity");
    state.identityState = "running";
    const identity = await runStep("employee.createIdentity", {
      employeeId: input.employeeId,
      name: input.name,
      department: input.department,
      accessProfile: input.accessProfile,
    });
    state.identityState = "created";
    state.identityId = String(identity.echoed.identityId ?? `id_${input.employeeId}`);

    setStatus("provisioning_access", "Provision Access", "Provisioning requested systems in parallel");
    await Promise.all(input.requestedSystems.map(async (system) => {
      const systemState = state.systems[system];
      systemState.status = "running";
      systemState.lastError = undefined;
      const result = await runStep(`employee.provision.${system}`, {
        employeeId: input.employeeId,
        system,
        identityId: state.identityId,
        accessProfile: input.accessProfile,
      });
      systemState.status = "provisioned";
      systemState.attempts = Number(result.echoed.attempts ?? 1);
      systemState.externalAccountId = String(result.echoed.externalAccountId ?? `${system}_${input.employeeId}`);
    }));

    setStatus("waiting_for_manager_checklist", "Manager Checklist", "Waiting for manager onboarding checklist");
    state.managerChecklistStatus = "waiting";
    const checklistTask = await humanTasks.createHumanTask({
      orgId: context.orgId,
      workflowId: info.workflowId,
      runId: info.runId,
      taskKey: "manager-checklist",
      taskType: "employee_lifecycle_manager_checklist",
      title: `Complete onboarding checklist for ${input.name}`,
      description: `${input.manager} should verify systems and first-day readiness for ${input.name}.`,
      assignedUserEmail: input.managerEmail,
      roleRequirements: [{ roleName: "ADMIN" }],
      actionKey: "managerChecklist",
      actionForm: { fields: [] },
      context: {
        workflowDefinitionKey: context.workflowDefinitionKey,
        employeeId: input.employeeId,
        requestedSystems: input.requestedSystems,
      },
      tokenTtlHours: 72,
    });
    state.managerChecklistTaskId = checklistTask.taskId;

    await condition(() => checklistAction !== undefined);
    state.managerChecklistStatus = "completed";
    state.managerChecklistCompletedBy = checklistAction?.submittedBy;
    state.managerChecklistNotes = typeof checklistAction?.payload?.notes === "string"
      ? checklistAction.payload.notes
      : checklistAction?.comment;
    await humanTasks.closeHumanTask({
      taskId: checklistTask.taskId,
      result: {
        decision: checklistAction?.decision ?? "complete",
        completedSystems: checklistAction?.payload?.completedSystems ?? input.requestedSystems,
        notes: state.managerChecklistNotes ?? null,
        submittedBy: checklistAction?.submittedBy ?? null,
        channel: checklistAction?.channel ?? "AUTHENTICATED",
      },
    });

    if (input.postStartReviewSeconds > 0) {
      state.nextScheduledAction = {
        label: "Verify access",
        at: new Date(Date.now() + input.postStartReviewSeconds * 1000).toISOString(),
      };
      setStatus("waiting_for_post_start_review", "Post-start Review Delay", "Waiting for scheduled post-start review");
      await sleep(input.postStartReviewSeconds * 1000);
      state.nextScheduledAction = undefined;
    }

    setStatus("verifying_access", "Verify Access", "Verifying provisioned access");
    await runStep("employee.verifyAccess", {
      employeeId: input.employeeId,
      systems: input.requestedSystems,
      identityId: state.identityId,
    });
    for (const system of input.requestedSystems) {
      state.systems[system].status = "verified";
    }

    setStatus("completed", "Completed", "Employee lifecycle completed");
    return state;
  } catch (err) {
    if (isCancellation(err)) {
      setStatus("cancelling", "Cancellation Cleanup", "Cleaning up provisioned access");
      const provisionedSystems = input.requestedSystems.filter((system) =>
        ["provisioned", "verified"].includes(state.systems[system].status)
      );
      if (provisionedSystems.length > 0 || state.identityState === "created") {
        await runStep("employee.deprovisionAccess", {
          employeeId: input.employeeId,
          systems: provisionedSystems,
          identityCreated: state.identityState === "created",
        });
      }
      for (const system of provisionedSystems) {
        state.systems[system].status = "deprovisioned";
      }
      if (state.identityState === "created") state.identityState = "deprovisioned";
      setStatus("cancelled", "Cancelled", "Employee lifecycle cancelled");
      return state;
    }
    state.status = "failed";
    state.currentStep = "Failed";
    state.lastError = err instanceof Error ? err.message : "Employee lifecycle failed";
    state.failedSystems = allEmployeeSystems.filter((system) => state.systems[system].status === "failed");
    remember("failed", state.lastError);
    return state;
  }
}

export type EngagementPhase =
  | "discovery"
  | "solution_design"
  | "implementation"
  | "uat"
  | "go_live"
  | "post_launch_review";
export type ImplementationWorkstream = "data" | "application" | "integrations";
export type ClientEngagementStatus = "started" | "running" | "waiting_for_approval" | "blocked" | "completed" | "cancelled" | "failed";
export type EngagementPhaseStatus = "pending" | "running" | "waiting_for_approval" | "approved" | "rejected" | "completed" | "blocked" | "failed" | "cancelled";
export type EngagementWorkstreamStatus = "pending" | "running" | "completed" | "failed";

export interface ClientEngagementWorkflowInput {
  engagementId: string;
  clientName: string;
  sponsorEmail: string;
  projectManager: string;
  targetGoLiveDate: string;
  scopeSummary: string;
  workstreams: ImplementationWorkstream[];
  phaseDelaySeconds: number;
  postLaunchReviewSeconds: number;
  businessKey?: string;
}

export interface EngagementPhaseState {
  phase: EngagementPhase;
  status: EngagementPhaseStatus;
  startedAt?: string;
  completedAt?: string;
  milestonesCompleted: string[];
  approvalTaskId?: string;
}

export interface EngagementWorkstreamState {
  workstream: ImplementationWorkstream;
  status: EngagementWorkstreamStatus;
  childWorkflowId?: string;
  completedMilestones: string[];
  startedAt?: string;
  completedAt?: string;
  lastError?: string;
}

export interface ClientEngagementState {
  engagementId: string;
  clientName: string;
  sponsorEmail: string;
  projectManager: string;
  targetGoLiveDate: string;
  scopeSummary: string;
  status: ClientEngagementStatus;
  currentPhase: EngagementPhase;
  currentStep: string;
  completedPhases: EngagementPhase[];
  phases: Record<EngagementPhase, EngagementPhaseState>;
  implementationWorkstreams: Record<ImplementationWorkstream, EngagementWorkstreamState>;
  blockers: Array<{
    phase: EngagementPhase;
    reason: string;
    raisedAt: string;
    raisedBy?: string;
  }>;
  clientApproval?: {
    phase: EngagementPhase;
    decision: "approved" | "rejected";
    comment?: string;
    submittedBy?: string;
    submittedAt: string;
  };
  milestones: string[];
  activeChildWorkflows: string[];
  timeline: Array<{
    timestamp: string;
    status: ClientEngagementStatus;
    message: string;
  }>;
  lastError?: string;
}

interface ClientEngagementChildInput {
  parentWorkflowId: string;
  orgId: string;
  workflowDefinitionKey: string;
  engagementId: string;
  clientName: string;
  workstream: ImplementationWorkstream;
}

interface ClientEngagementWorkstreamResult {
  workstream: ImplementationWorkstream;
  childWorkflowId: string;
  completedMilestones: string[];
  completedAt: string;
}

const engagementPhases: EngagementPhase[] = [
  "discovery",
  "solution_design",
  "implementation",
  "uat",
  "go_live",
  "post_launch_review",
];
const allImplementationWorkstreams: ImplementationWorkstream[] = ["data", "application", "integrations"];
const engagementPhaseMilestones: Record<EngagementPhase, string[]> = {
  discovery: ["stakeholders mapped", "current state documented"],
  solution_design: ["future state approved", "integration plan drafted"],
  implementation: ["workstreams delivered"],
  uat: ["test plan executed", "defects triaged"],
  go_live: ["production launch completed"],
  post_launch_review: ["success metrics reviewed", "handoff completed"],
};

const createEngagementPhaseState = (phase: EngagementPhase): EngagementPhaseState => ({
  phase,
  status: "pending",
  milestonesCompleted: [],
});

const createEngagementWorkstreamState = (
  workstream: ImplementationWorkstream,
  engagementId: string
): EngagementWorkstreamState => ({
  workstream,
  status: "pending",
  childWorkflowId: `${engagementId}.workstream.${workstream}`,
  completedMilestones: [],
});

export async function clientEngagementWorkstreamWorkflow(
  input: ClientEngagementChildInput
): Promise<ClientEngagementWorkstreamResult> {
  const info = workflowInfo();
  const result = await showcaseActivities.runShowcaseSyntheticStep({
    orgId: input.orgId,
    workflowDefinitionKey: input.workflowDefinitionKey,
    requirementKey: "syntheticEcho",
    stepKey: `clientEngagement.workstream.${input.workstream}`,
    idempotencyKey: `${info.workflowId}:deliver`,
    payload: {
      parentWorkflowId: input.parentWorkflowId,
      engagementId: input.engagementId,
      clientName: input.clientName,
      workstream: input.workstream,
    },
  });
  const defaultMilestones = [
    `${input.workstream} plan completed`,
    `${input.workstream} build completed`,
    `${input.workstream} validation completed`,
  ];
  const echoedMilestones = result.echoed.completedMilestones;
  return {
    workstream: input.workstream,
    childWorkflowId: info.workflowId,
    completedMilestones: Array.isArray(echoedMilestones) ? echoedMilestones.map(String) : defaultMilestones,
    completedAt: new Date().toISOString(),
  };
}

export async function clientEngagementWorkflow(
  input: ClientEngagementWorkflowInput,
  context: PlatformWorkflowContext
): Promise<ClientEngagementState> {
  const info = workflowInfo();
  await ensureWorkflowExecutionProjection(input, context);
  let approvalAction: WorkflowHumanActionInput | undefined;
  const state: ClientEngagementState = {
    engagementId: input.engagementId,
    clientName: input.clientName,
    sponsorEmail: input.sponsorEmail,
    projectManager: input.projectManager,
    targetGoLiveDate: input.targetGoLiveDate,
    scopeSummary: input.scopeSummary,
    status: "started",
    currentPhase: "discovery",
    currentStep: "Started",
    completedPhases: [],
    phases: {
      discovery: createEngagementPhaseState("discovery"),
      solution_design: createEngagementPhaseState("solution_design"),
      implementation: createEngagementPhaseState("implementation"),
      uat: createEngagementPhaseState("uat"),
      go_live: createEngagementPhaseState("go_live"),
      post_launch_review: createEngagementPhaseState("post_launch_review"),
    },
    implementationWorkstreams: {
      data: createEngagementWorkstreamState("data", input.engagementId),
      application: createEngagementWorkstreamState("application", input.engagementId),
      integrations: createEngagementWorkstreamState("integrations", input.engagementId),
    },
    blockers: [],
    milestones: [],
    activeChildWorkflows: [],
    timeline: [],
  };

  const timestamp = () => new Date().toISOString();
  const remember = (status: ClientEngagementStatus, message: string) => {
    state.timeline.push({ timestamp: timestamp(), status, message });
  };
  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}:${String(payload.phase ?? payload.engagementId ?? "all")}`,
      payload,
    });
  const delayBetweenPhases = async () => {
    if (input.phaseDelaySeconds > 0) await sleep(input.phaseDelaySeconds * 1000);
  };
  const completePhase = (phase: EngagementPhase, milestones: string[]) => {
    const phaseState = state.phases[phase];
    phaseState.status = "completed";
    phaseState.completedAt = timestamp();
    phaseState.milestonesCompleted = milestones;
    state.completedPhases.push(phase);
    state.milestones.push(...milestones.map((milestone) => `${phase}: ${milestone}`));
  };

  setHandler(clientEngagementStateQuery, () => state);
  setHandler(clientEngagementApprovalActionSignal, (submitted) => {
    if (!approvalAction && state.status === "waiting_for_approval") {
      approvalAction = submitted;
    }
  });

  try {
    remember("started", `Client engagement ${input.engagementId} started`);

    for (const phase of ["discovery", "solution_design"] as EngagementPhase[]) {
      state.status = "running";
      state.currentPhase = phase;
      state.currentStep = `Run ${phase.replaceAll("_", " ")}`;
      const phaseState = state.phases[phase];
      phaseState.status = "running";
      phaseState.startedAt = timestamp();
      await runStep(`clientEngagement.phase.${phase}`, {
        engagementId: input.engagementId,
        clientName: input.clientName,
        phase,
        scopeSummary: input.scopeSummary,
      });
      completePhase(phase, engagementPhaseMilestones[phase]);
      await delayBetweenPhases();
    }

    state.status = "running";
    state.currentPhase = "implementation";
    state.currentStep = "Run implementation child workstreams";
    state.phases.implementation.status = "running";
    state.phases.implementation.startedAt = timestamp();
    state.activeChildWorkflows = input.workstreams.map((workstream) => `${info.workflowId}.workstream.${workstream}`);
    for (const workstream of input.workstreams) {
      state.implementationWorkstreams[workstream].status = "running";
      state.implementationWorkstreams[workstream].startedAt = timestamp();
      state.implementationWorkstreams[workstream].childWorkflowId = `${info.workflowId}.workstream.${workstream}`;
    }
    const workstreamResults = await Promise.all(input.workstreams.map((workstream) =>
      executeChild(clientEngagementWorkstreamWorkflow, {
        args: [{
          parentWorkflowId: info.workflowId,
          orgId: context.orgId,
          workflowDefinitionKey: context.workflowDefinitionKey,
          engagementId: input.engagementId,
          clientName: input.clientName,
          workstream,
        }],
        workflowId: `${info.workflowId}.workstream.${workstream}`,
      })
    ));
    for (const result of workstreamResults) {
      const workstreamState = state.implementationWorkstreams[result.workstream];
      workstreamState.status = "completed";
      workstreamState.childWorkflowId = result.childWorkflowId;
      workstreamState.completedMilestones = result.completedMilestones;
      workstreamState.completedAt = result.completedAt;
    }
    state.activeChildWorkflows = [];
    completePhase("implementation", [
      ...engagementPhaseMilestones.implementation,
      ...workstreamResults.flatMap((result) => result.completedMilestones),
    ]);
    await delayBetweenPhases();

    state.status = "running";
    state.currentPhase = "uat";
    state.currentStep = "Run uat";
    state.phases.uat.status = "running";
    state.phases.uat.startedAt = timestamp();
    await runStep("clientEngagement.phase.uat", {
      engagementId: input.engagementId,
      phase: "uat",
      workstreams: input.workstreams,
    });
    completePhase("uat", engagementPhaseMilestones.uat);

    state.status = "waiting_for_approval";
    state.currentStep = "Wait for client approval";
    state.phases.uat.status = "waiting_for_approval";
    const approvalTask = await humanTasks.createHumanTask({
      orgId: context.orgId,
      workflowId: info.workflowId,
      runId: info.runId,
      taskKey: "client-uat-approval",
      taskType: "client_engagement_phase_approval",
      title: `Approve UAT for ${input.clientName}`,
      description: `Approve or reject UAT completion for engagement ${input.engagementId}.`,
      assignedUserEmail: input.sponsorEmail,
      roleRequirements: [{ roleName: "ADMIN" }],
      actionKey: "clientPhaseApproval",
      actionForm: { fields: [] },
      context: {
        workflowDefinitionKey: context.workflowDefinitionKey,
        engagementId: input.engagementId,
        phase: "uat",
      },
      tokenTtlHours: 168,
    });
    state.phases.uat.approvalTaskId = approvalTask.taskId;
    await condition(() => approvalAction !== undefined);

    state.clientApproval = {
      phase: "uat",
      decision: approvalAction?.decision === "approved" ? "approved" : "rejected",
      comment: approvalAction?.comment,
      submittedBy: approvalAction?.submittedBy,
      submittedAt: timestamp(),
    };
    await humanTasks.closeHumanTask({
      taskId: approvalTask.taskId,
      result: {
        decision: state.clientApproval.decision,
        comment: state.clientApproval.comment ?? null,
        submittedBy: state.clientApproval.submittedBy ?? null,
        channel: approvalAction?.channel ?? "AUTHENTICATED",
      },
    });

    if (state.clientApproval.decision === "rejected") {
      state.status = "blocked";
      state.currentStep = "Blocked by client approval";
      state.phases.uat.status = "rejected";
      state.blockers.push({
        phase: "uat",
        reason: state.clientApproval.comment ?? "Client rejected UAT",
        raisedAt: state.clientApproval.submittedAt,
        raisedBy: state.clientApproval.submittedBy,
      });
      remember("blocked", "Client rejected UAT approval");
      return state;
    }

    state.phases.uat.status = "approved";
    state.status = "running";
    state.currentPhase = "go_live";
    state.currentStep = "Run go-live";
    state.phases.go_live.status = "running";
    state.phases.go_live.startedAt = timestamp();
    await runStep("clientEngagement.phase.go_live", {
      engagementId: input.engagementId,
      phase: "go_live",
      targetGoLiveDate: input.targetGoLiveDate,
    });
    completePhase("go_live", engagementPhaseMilestones.go_live);

    if (input.postLaunchReviewSeconds > 0) {
      await sleep(input.postLaunchReviewSeconds * 1000);
    }

    state.currentPhase = "post_launch_review";
    state.currentStep = "Run post-launch review";
    state.phases.post_launch_review.status = "running";
    state.phases.post_launch_review.startedAt = timestamp();
    await runStep("clientEngagement.phase.post_launch_review", {
      engagementId: input.engagementId,
      phase: "post_launch_review",
      milestones: state.milestones,
    });
    completePhase("post_launch_review", engagementPhaseMilestones.post_launch_review);

    state.status = "completed";
    state.currentStep = "Completed";
    remember("completed", "Client engagement completed");
    return state;
  } catch (err) {
    if (isCancellation(err)) {
      state.status = "cancelled";
      state.currentStep = "Cancelled";
      for (const phase of engagementPhases) {
        if (state.phases[phase].status === "running" || state.phases[phase].status === "waiting_for_approval") {
          state.phases[phase].status = "cancelled";
        }
      }
      remember("cancelled", "Client engagement cancelled");
      return state;
    }
    state.status = "failed";
    state.currentStep = "Failed";
    state.lastError = err instanceof Error ? err.message : "Client engagement failed";
    for (const workstream of allImplementationWorkstreams) {
      if (state.implementationWorkstreams[workstream].status === "running") {
        state.implementationWorkstreams[workstream].status = "failed";
        state.implementationWorkstreams[workstream].lastError = state.lastError;
      }
    }
    remember("failed", state.lastError);
    return state;
  }
}

export type AiDocumentType = "invoice" | "contract" | "rfp" | "support_case" | "unknown";
export type AiDocumentStage =
  | "uploaded"
  | "parsing"
  | "classifying"
  | "extracting"
  | "enriching"
  | "validating"
  | "waiting_for_human_review"
  | "storing"
  | "completed"
  | "rejected"
  | "failed";

export interface AiDocumentProcessingWorkflowInput {
  documentId: string;
  documentTypeHint?: AiDocumentType;
  documentRef: string;
  confidenceThreshold: number;
  reviewScenario: "auto_accept" | "low_confidence" | "validation_error";
  businessKey?: string;
}

export interface AiExtractedDataSummary {
  documentNumber?: string;
  companyName?: string;
  effectiveDate?: string;
  dueDate?: string;
  amount?: number;
  currency?: string;
  obligations?: string[];
  requestedServices?: string[];
  issueSummary?: string;
}

export interface AiDocumentProcessingState {
  documentId: string;
  documentTypeHint?: AiDocumentType;
  documentRef: string;
  stage: AiDocumentStage;
  classification?: AiDocumentType;
  extractedDataSummary?: AiExtractedDataSummary;
  enrichment?: {
    companyLookup?: {
      companyName: string;
      industry: string;
      accountTier: string;
    };
    riskAnalysis?: {
      riskLevel: "low" | "medium" | "high";
      reasons: string[];
    };
    summary?: string;
    dataValidation?: {
      valid: boolean;
      warnings: string[];
    };
  };
  validation?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  confidenceScore?: number;
  confidenceThreshold: number;
  humanReviewStatus: "not_required" | "pending" | "approved" | "corrected" | "rejected";
  reviewer?: string;
  reviewNotes?: string;
  reviewTaskId?: string;
  storedResultId?: string;
  completedSteps: string[];
  timeline: Array<{
    timestamp: string;
    message: string;
  }>;
  lastError?: string;
}

const defaultAiDocumentSummary = (
  documentId: string,
  classification: AiDocumentType
): AiExtractedDataSummary => {
  if (classification === "support_case") {
    return {
      documentNumber: `CASE-DOC-${documentId}`,
      companyName: "Northstar Manufacturing Group",
      issueSummary: "Recurring billing synchronization failures with delayed invoices.",
      requestedServices: ["billing reconciliation", "support escalation"],
    };
  }
  if (classification === "contract") {
    return {
      documentNumber: `MSA-${documentId}`,
      companyName: "Northstar Manufacturing Group",
      effectiveDate: "2026-08-14",
      obligations: ["mutual confidentiality", "standard support terms"],
      currency: "USD",
    };
  }
  return {
    documentNumber: `INV-${documentId}`,
    companyName: "Northstar Manufacturing Group",
    dueDate: "2026-09-15",
    amount: 42000,
    currency: "USD",
    obligations: ["pay invoice by due date"],
  };
};

const correctedAiDocumentSummary = (
  payload: Record<string, unknown> | undefined,
  fallback: AiExtractedDataSummary
): AiExtractedDataSummary => ({
  documentNumber: typeof payload?.documentNumber === "string" && payload.documentNumber ? payload.documentNumber : fallback.documentNumber,
  companyName: typeof payload?.companyName === "string" && payload.companyName ? payload.companyName : fallback.companyName,
  effectiveDate: typeof payload?.effectiveDate === "string" && payload.effectiveDate ? payload.effectiveDate : fallback.effectiveDate,
  dueDate: typeof payload?.dueDate === "string" && payload.dueDate ? payload.dueDate : fallback.dueDate,
  amount: typeof payload?.amount === "number" ? payload.amount : fallback.amount,
  currency: typeof payload?.currency === "string" && payload.currency ? payload.currency : fallback.currency,
  obligations: Array.isArray(payload?.obligations) ? payload.obligations.map(String) : fallback.obligations,
  requestedServices: Array.isArray(payload?.requestedServices) ? payload.requestedServices.map(String) : fallback.requestedServices,
  issueSummary: typeof payload?.issueSummary === "string" && payload.issueSummary ? payload.issueSummary : fallback.issueSummary,
});

export async function aiDocumentProcessingWorkflow(
  input: AiDocumentProcessingWorkflowInput,
  context: PlatformWorkflowContext
): Promise<AiDocumentProcessingState> {
  const info = workflowInfo();
  await ensureWorkflowExecutionProjection(input, context);
  let reviewAction: WorkflowHumanActionInput | undefined;
  const state: AiDocumentProcessingState = {
    documentId: input.documentId,
    documentTypeHint: input.documentTypeHint,
    documentRef: input.documentRef,
    stage: "uploaded",
    confidenceThreshold: input.confidenceThreshold,
    humanReviewStatus: "not_required",
    completedSteps: [],
    timeline: [],
  };
  const timestamp = () => new Date().toISOString();
  const remember = (message: string) => {
    state.timeline.push({ timestamp: timestamp(), message });
  };
  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}:${String(payload.documentId ?? "document")}`,
      payload,
    });

  setHandler(aiDocumentProcessingStateQuery, () => state);
  setHandler(aiDocumentReviewActionSignal, (submitted) => {
    if (!reviewAction && state.stage === "waiting_for_human_review" && state.humanReviewStatus === "pending") {
      reviewAction = submitted;
    }
  });

  try {
    remember(`Document reference ${input.documentId} submitted`);

    state.stage = "parsing";
    await runStep("aiDocument.parseReference", {
      documentId: input.documentId,
      documentRef: input.documentRef,
    });
    state.completedSteps.push("Parse Document Reference");

    state.stage = "classifying";
    await runStep("aiDocument.classify", {
      documentId: input.documentId,
      documentTypeHint: input.documentTypeHint ?? "unknown",
      reviewScenario: input.reviewScenario,
    });
    state.classification = input.documentTypeHint && input.documentTypeHint !== "unknown" ? input.documentTypeHint : "invoice";
    const classificationConfidence = input.reviewScenario === "low_confidence" ? 0.72 : 0.94;
    state.completedSteps.push("Classify Document");

    state.stage = "extracting";
    await runStep("aiDocument.extractStructuredData", {
      documentId: input.documentId,
      classification: state.classification,
    });
    const extractionConfidence = input.reviewScenario === "validation_error" ? 0.88 : 0.92;
    state.confidenceScore = Math.min(classificationConfidence, extractionConfidence);
    state.extractedDataSummary = defaultAiDocumentSummary(input.documentId, state.classification);
    state.completedSteps.push("AI Structured Extraction");

    state.stage = "enriching";
    await Promise.all([
      runStep("aiDocument.lookupCompany", {
        documentId: input.documentId,
        companyName: state.extractedDataSummary.companyName ?? "unknown",
      }),
      runStep("aiDocument.analyzeRisk", {
        documentId: input.documentId,
        classification: state.classification,
        amount: state.extractedDataSummary.amount ?? null,
      }),
      runStep("aiDocument.generateSummary", {
        documentId: input.documentId,
        classification: state.classification,
      }),
      runStep("aiDocument.validateExtractedData", {
        documentId: input.documentId,
        classification: state.classification,
      }),
    ]);
    state.enrichment = {
      companyLookup: {
        companyName: state.extractedDataSummary.companyName ?? "Unknown Company",
        industry: "Manufacturing",
        accountTier: "enterprise",
      },
      riskAnalysis: {
        riskLevel: state.extractedDataSummary.amount && state.extractedDataSummary.amount > 40000 ? "medium" : "low",
        reasons: state.extractedDataSummary.amount && state.extractedDataSummary.amount > 40000
          ? ["High-value document requires confidence-aware review"]
          : ["No high-risk terms detected in structured summary"],
      },
      summary: `${state.classification} ${state.extractedDataSummary.documentNumber ?? input.documentId} for ${state.extractedDataSummary.companyName ?? "unknown company"}`,
      dataValidation: {
        valid: true,
        warnings: state.extractedDataSummary.amount && state.extractedDataSummary.amount > 40000
          ? ["High-value amount should be reviewed when confidence is low"]
          : [],
      },
    };
    state.completedSteps.push("Parallel Enrichment");

    state.stage = "validating";
    await runStep("aiDocument.validateExtraction", {
      documentId: input.documentId,
      classification: state.classification,
      reviewScenario: input.reviewScenario,
    });
    state.validation = input.reviewScenario === "validation_error"
      ? { valid: false, errors: ["Due date is missing or inconsistent"], warnings: ["Human correction required"] }
      : { valid: true, errors: [], warnings: state.enrichment.dataValidation?.warnings ?? [] };
    state.completedSteps.push("Validate Structured Output");

    const needsReview = !state.validation.valid || (state.confidenceScore ?? 0) < input.confidenceThreshold;
    if (needsReview) {
      state.stage = "waiting_for_human_review";
      state.humanReviewStatus = "pending";
      remember(!state.validation.valid
        ? `Validation failed: ${state.validation.errors.join(", ")}`
        : `Confidence ${(state.confidenceScore ?? 0).toFixed(2)} below threshold ${input.confidenceThreshold.toFixed(2)}`);
      const reviewTask = await humanTasks.createHumanTask({
        orgId: context.orgId,
        workflowId: info.workflowId,
        runId: info.runId,
        taskKey: "document-review",
        taskType: "ai_document_review",
        title: `Review AI extraction for ${input.documentId}`,
        description: "Review the structured extraction summary. Raw document content and prompts are intentionally not included.",
        roleRequirements: [{ roleName: "ADMIN" }],
        actionKey: "documentReview",
        actionForm: { fields: [] },
        context: {
          workflowDefinitionKey: context.workflowDefinitionKey,
          documentId: input.documentId,
          documentRef: input.documentRef,
          classification: state.classification,
          validation: state.validation,
        },
        tokenTtlHours: 72,
      });
      state.reviewTaskId = reviewTask.taskId;
      await condition(() => reviewAction !== undefined);

      state.reviewer = reviewAction?.submittedBy;
      state.reviewNotes = reviewAction?.comment ?? (typeof reviewAction?.payload?.comment === "string" ? reviewAction.payload.comment : undefined);
      if (reviewAction?.decision === "reject") {
        state.humanReviewStatus = "rejected";
        state.stage = "rejected";
        state.lastError = typeof reviewAction.payload?.rejectionReason === "string"
          ? reviewAction.payload.rejectionReason
          : reviewAction.comment ?? "Document rejected by reviewer";
        await humanTasks.closeHumanTask({
          taskId: reviewTask.taskId,
          result: {
            decision: "reject",
            reason: state.lastError,
            submittedBy: reviewAction.submittedBy ?? null,
            channel: reviewAction.channel,
          },
        });
        return state;
      }

      if (reviewAction?.decision === "correct") {
        state.extractedDataSummary = correctedAiDocumentSummary(reviewAction.payload, state.extractedDataSummary ?? {});
        state.humanReviewStatus = "corrected";
        state.validation = { valid: true, errors: [], warnings: ["Human correction applied"] };
        state.confidenceScore = Math.max(state.confidenceScore ?? 0, input.confidenceThreshold);
        state.completedSteps.push("Human Correction Applied");
      } else {
        state.humanReviewStatus = "approved";
      }

      await humanTasks.closeHumanTask({
        taskId: reviewTask.taskId,
        result: {
          decision: reviewAction?.decision ?? "approve",
          comment: state.reviewNotes ?? null,
          submittedBy: reviewAction?.submittedBy ?? null,
          channel: reviewAction?.channel ?? "AUTHENTICATED",
        },
      });
    }

    state.stage = "storing";
    await runStep("aiDocument.storeResult", {
      documentId: input.documentId,
      classification: state.classification,
      humanReviewed: state.humanReviewStatus !== "not_required",
    });
    state.storedResultId = `stored_${input.documentId}`;
    state.completedSteps.push("Store Result");
    state.stage = "completed";
    remember(`Stored AI document result ${state.storedResultId}`);
    return state;
  } catch (err) {
    state.stage = "failed";
    state.lastError = err instanceof Error ? err.message : "AI document processing failed";
    remember(state.lastError);
    return state;
  }
}

export type AiSupportAgentStage =
  | "received"
  | "understanding"
  | "retrieving_context"
  | "deciding"
  | "waiting_for_approval"
  | "executing_tools"
  | "validating_result"
  | "responding"
  | "completed"
  | "rejected"
  | "failed";
export type AiSupportAgentToolName = "lookupCustomer" | "lookupInvoice" | "issueCredit" | "updateCase" | "sendCustomerResponse";
export type AiSupportAgentAction = "issue_credit" | "update_case" | "send_instructions" | "escalate";

export interface AiSupportAgentWorkflowInput {
  caseId: string;
  customerId: string;
  customerMessageSummary: string;
  planTier: string;
  accountStatus: string;
  recentInvoiceId: string;
  duplicateChargeSuspected: boolean;
  approvalThresholdAmount: number;
  demoScenario: "credit_requires_approval" | "send_instructions";
  accountContext: {
    planTier: string;
    accountStatus: string;
    recentInvoiceId: string;
    duplicateChargeSuspected: boolean;
  };
  businessKey?: string;
}

export interface AiSupportAgentProposal {
  intent: "billing_adjustment" | "technical_support" | "account_update" | "unknown";
  proposedAction: AiSupportAgentAction;
  amount?: number;
  requiresApproval: boolean;
  reason: string;
  rationaleSummary: string;
}

export interface AiSupportAgentToolCall {
  toolName: AiSupportAgentToolName;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  idempotencyKey: string;
  startedAt?: string;
  completedAt?: string;
  resultSummary?: string;
  lastError?: string;
}

export interface AiSupportAgentState {
  caseId: string;
  customerId: string;
  customerMessageSummary: string;
  accountContext: AiSupportAgentWorkflowInput["accountContext"];
  stage: AiSupportAgentStage;
  proposal?: AiSupportAgentProposal;
  pendingApproval: boolean;
  approvalStatus: "not_required" | "pending" | "approved" | "modified" | "rejected";
  approver?: string;
  approvalNotes?: string;
  toolCalls: AiSupportAgentToolCall[];
  customerContext?: {
    customerName: string;
    planTier: string;
    accountStatus: string;
  };
  invoiceContext?: {
    invoiceId: string;
    amount: number;
    duplicateCharge: boolean;
  };
  validation?: {
    valid: boolean;
    message: string;
  };
  finalResponseSummary?: string;
  completedSteps: string[];
  timeline: Array<{
    timestamp: string;
    message: string;
  }>;
  lastError?: string;
}

export async function aiSupportAgentWorkflow(
  input: AiSupportAgentWorkflowInput,
  context: PlatformWorkflowContext
): Promise<AiSupportAgentState> {
  const info = workflowInfo();
  await ensureWorkflowExecutionProjection(input, context);
  let approvalAction: WorkflowHumanActionInput | undefined;
  const state: AiSupportAgentState = {
    caseId: input.caseId,
    customerId: input.customerId,
    customerMessageSummary: input.customerMessageSummary,
    accountContext: { ...input.accountContext },
    stage: "received",
    pendingApproval: false,
    approvalStatus: "not_required",
    toolCalls: [],
    completedSteps: [],
    timeline: [],
  };
  const timestamp = () => new Date().toISOString();
  const remember = (message: string) => {
    state.timeline.push({ timestamp: timestamp(), message });
  };
  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}:${String(payload.toolName ?? payload.caseId ?? "agent")}`,
      payload,
    });
  const runTool = async (toolName: AiSupportAgentToolName, resultSummary: string) => {
    const call: AiSupportAgentToolCall = {
      toolName,
      status: "running",
      idempotencyKey: `${input.caseId}:${toolName}`,
      startedAt: timestamp(),
    };
    state.toolCalls.push(call);
    try {
      await runStep(`aiSupportAgent.tool.${toolName}`, {
        caseId: input.caseId,
        customerId: input.customerId,
        toolName,
      });
      call.status = "completed";
      call.completedAt = timestamp();
      call.resultSummary = resultSummary;
      remember(`${toolName} completed`);
    } catch (err) {
      call.status = "failed";
      call.lastError = err instanceof Error ? err.message : "Tool failed";
      throw err;
    }
  };

  setHandler(aiSupportAgentStateQuery, () => state);
  setHandler(aiSupportAgentApprovalActionSignal, (submitted) => {
    if (!approvalAction && state.stage === "waiting_for_approval" && state.pendingApproval) {
      approvalAction = submitted;
    }
  });

  try {
    remember(`Support case ${input.caseId} received`);

    state.stage = "understanding";
    await runStep("aiSupportAgent.understandRequest", {
      caseId: input.caseId,
      safeMessageSummary: input.customerMessageSummary,
      demoScenario: input.demoScenario,
    });
    state.completedSteps.push("Understand Request");

    state.stage = "retrieving_context";
    await Promise.all([
      runTool("lookupCustomer", `Customer ${input.customerId} on ${input.planTier}`),
      runTool("lookupInvoice", `Invoice ${input.recentInvoiceId} duplicate=${input.duplicateChargeSuspected}`),
    ]);
    state.customerContext = {
      customerName: "Northstar Manufacturing Group",
      planTier: input.planTier,
      accountStatus: input.accountStatus,
    };
    state.invoiceContext = {
      invoiceId: input.recentInvoiceId,
      amount: input.duplicateChargeSuspected ? 49 : 0,
      duplicateCharge: input.duplicateChargeSuspected,
    };
    state.completedSteps.push("Retrieve Customer Context");

    state.stage = "deciding";
    await runStep("aiSupportAgent.proposeAction", {
      caseId: input.caseId,
      customerId: input.customerId,
      demoScenario: input.demoScenario,
      duplicateChargeSuspected: input.duplicateChargeSuspected,
    });
    const proposedAction: AiSupportAgentAction = input.demoScenario === "send_instructions" || !input.duplicateChargeSuspected
      ? "send_instructions"
      : "issue_credit";
    const proposedAmount = proposedAction === "issue_credit" ? state.invoiceContext.amount : undefined;
    state.proposal = {
      intent: proposedAction === "issue_credit" ? "billing_adjustment" : "technical_support",
      proposedAction,
      amount: proposedAmount,
      requiresApproval: proposedAction === "issue_credit" && (proposedAmount ?? 0) > input.approvalThresholdAmount,
      reason: proposedAction === "issue_credit"
        ? "Duplicate charge suspected from invoice context"
        : "Provide next best support instructions",
      rationaleSummary: "Synthetic AI policy evaluated safe message summary and retrieved account context.",
    };
    state.completedSteps.push("Determine Proposed Action");

    if (state.proposal.requiresApproval) {
      state.stage = "waiting_for_approval";
      state.pendingApproval = true;
      state.approvalStatus = "pending";
      const approvalTask = await humanTasks.createHumanTask({
        orgId: context.orgId,
        workflowId: info.workflowId,
        runId: info.runId,
        taskKey: "agent-approval",
        taskType: "ai_support_agent_approval",
        title: `Review AI support action for ${input.caseId}`,
        description: `Proposed action: ${state.proposal.proposedAction}. Tool execution waits for approval.`,
        roleRequirements: [{ roleName: "ADMIN" }],
        actionKey: "agentApproval",
        actionForm: { fields: [] },
        context: {
          workflowDefinitionKey: context.workflowDefinitionKey,
          caseId: input.caseId,
          proposal: state.proposal,
        },
        tokenTtlHours: 72,
      });
      await condition(() => approvalAction !== undefined);
      state.pendingApproval = false;
      state.approver = approvalAction?.submittedBy;
      state.approvalNotes = approvalAction?.comment ?? (typeof approvalAction?.payload?.comment === "string" ? approvalAction.payload.comment : undefined);

      if (approvalAction?.decision === "rejected") {
        state.approvalStatus = "rejected";
        state.stage = "rejected";
        state.lastError = state.approvalNotes ?? "Agent action rejected";
        await humanTasks.closeHumanTask({
          taskId: approvalTask.taskId,
          result: {
            decision: "rejected",
            comment: state.approvalNotes ?? null,
            submittedBy: approvalAction.submittedBy ?? null,
            channel: approvalAction.channel,
          },
        });
        return state;
      }

      if (approvalAction?.decision === "modified") {
        const replacementAction = typeof approvalAction.payload?.replacementAction === "string"
          ? approvalAction.payload.replacementAction as AiSupportAgentAction
          : "send_instructions";
        state.proposal = {
          intent: replacementAction === "issue_credit" ? "billing_adjustment" : "technical_support",
          proposedAction: replacementAction,
          amount: typeof approvalAction.payload?.amount === "number" ? approvalAction.payload.amount : undefined,
          requiresApproval: false,
          reason: typeof approvalAction.payload?.reason === "string" && approvalAction.payload.reason
            ? approvalAction.payload.reason
            : "Modified by reviewer",
          rationaleSummary: "Reviewer modified the AI proposal before tool execution.",
        };
        state.approvalStatus = "modified";
      } else {
        state.approvalStatus = "approved";
      }

      await humanTasks.closeHumanTask({
        taskId: approvalTask.taskId,
        result: {
          decision: approvalAction?.decision ?? "approved",
          proposal: state.proposal,
          comment: state.approvalNotes ?? null,
          submittedBy: approvalAction?.submittedBy ?? null,
          channel: approvalAction?.channel ?? "AUTHENTICATED",
        },
      });
    }

    state.stage = "executing_tools";
    if (state.proposal?.proposedAction === "issue_credit") {
      await runTool("issueCredit", `Credit issued for ${state.proposal.amount ?? 0}`);
      await runTool("updateCase", `Case ${input.caseId} updated to credit_issued`);
    } else {
      await runTool("updateCase", `Case ${input.caseId} updated to responded`);
    }
    state.completedSteps.push("Execute Tools");

    state.stage = "validating_result";
    await runStep("aiSupportAgent.validateOutcome", {
      caseId: input.caseId,
      proposedAction: state.proposal?.proposedAction ?? "unknown",
      toolSummaries: state.toolCalls.map((call) => call.resultSummary ?? ""),
    });
    const hasRequiredTool = state.proposal?.proposedAction === "issue_credit"
      ? state.toolCalls.some((call) => call.toolName === "issueCredit" && call.status === "completed")
      : state.toolCalls.some((call) => call.toolName === "updateCase" && call.status === "completed");
    state.validation = {
      valid: hasRequiredTool,
      message: hasRequiredTool ? "Tool outcome matches approved proposal" : "Tool outcome did not match proposal",
    };
    state.completedSteps.push("Validate Result");
    if (!state.validation.valid) {
      throw new Error(state.validation.message);
    }

    state.stage = "responding";
    state.finalResponseSummary = state.proposal?.proposedAction === "issue_credit"
      ? `Credit response prepared for case ${input.caseId}`
      : `Instruction response prepared for case ${input.caseId}`;
    await runTool("sendCustomerResponse", state.finalResponseSummary);
    state.completedSteps.push("Respond");

    state.stage = "completed";
    remember("AI support agent workflow completed");
    return state;
  } catch (err) {
    state.stage = "failed";
    state.lastError = err instanceof Error ? err.message : "AI support agent failed";
    remember(state.lastError);
    return state;
  }
}

export type ComplianceControlClassification = "automated" | "manual";
export type ComplianceReviewStatus =
  | "scheduled"
  | "collecting_evidence"
  | "running_checks"
  | "waiting_for_evidence"
  | "overdue"
  | "escalated"
  | "generating_report"
  | "completed"
  | "failed";
export type ComplianceControlStatus =
  | "pending"
  | "collecting"
  | "checking"
  | "waiting_for_evidence"
  | "evidence_submitted"
  | "accepted"
  | "rejected"
  | "waived"
  | "overdue"
  | "escalated"
  | "passed"
  | "failed";

export interface ComplianceControlInput {
  controlId: string;
  title: string;
  owner: string;
  evidenceRequired: string;
  classification: ComplianceControlClassification;
}

export interface ComplianceReviewWorkflowInput {
  reviewId: string;
  reviewPeriod: string;
  controls: ComplianceControlInput[];
  evidenceDeadlineSeconds: number;
  escalationIntervalSeconds: number;
  scheduleNote?: string;
  businessKey?: string;
}

export interface ComplianceEvidenceRecord {
  submittedBy: string;
  submittedAt: string;
  reference: string;
  notes?: string;
  acceptedBy?: string;
  acceptedAt?: string;
  rejectionReason?: string;
}

export interface ComplianceFinding {
  controlId: string;
  severity: "info" | "low" | "medium" | "high";
  message: string;
}

export interface ComplianceControlState extends ComplianceControlInput {
  status: ComplianceControlStatus;
  findings: ComplianceFinding[];
  evidence?: ComplianceEvidenceRecord;
  requestedAt?: string;
  remindedAt?: string;
  overdueAt?: string;
  escalatedAt?: string;
  waivedBy?: string;
  waiverReason?: string;
  completedAt?: string;
  lastError?: string;
}

export interface ComplianceReviewState {
  reviewId: string;
  reviewPeriod: string;
  status: ComplianceReviewStatus;
  currentStep: string;
  evidenceDeadlineSeconds: number;
  escalationIntervalSeconds: number;
  controls: Record<string, ComplianceControlState>;
  statusBreakdown: Partial<Record<ComplianceControlStatus, number>>;
  missingEvidence: string[];
  overdueControls: string[];
  findings: ComplianceFinding[];
  completionPercentage: number;
  report?: {
    reportId: string;
    generatedAt: string;
    summary: string;
  };
  completedSteps: string[];
  timeline: Array<{
    timestamp: string;
    message: string;
  }>;
  lastError?: string;
}

const complianceTerminal = (status: ComplianceControlStatus) =>
  ["accepted", "waived", "passed", "failed"].includes(status);

export async function complianceReviewWorkflow(
  input: ComplianceReviewWorkflowInput,
  context: PlatformWorkflowContext
): Promise<ComplianceReviewState> {
  const info = workflowInfo();
  await ensureWorkflowExecutionProjection(input, context);
  const submittedActions: WorkflowHumanActionInput[] = [];
  let status: ComplianceReviewStatus = "scheduled";
  let currentStep = "Scheduled";
  let report: ComplianceReviewState["report"] | undefined;
  let lastError: string | undefined;
  const completedSteps: string[] = [];
  const timeline: ComplianceReviewState["timeline"] = [];
  const controls = input.controls.reduce<Record<string, ComplianceControlState>>((acc, control) => {
    acc[control.controlId] = {
      ...control,
      status: "pending",
      findings: [],
    };
    return acc;
  }, {});
  const timestamp = () => new Date().toISOString();
  const remember = (message: string) => {
    timeline.push({ timestamp: timestamp(), message });
  };
  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}:${String(payload.controlId ?? payload.reviewId ?? "review")}`,
      payload,
    });
  const snapshot = (): ComplianceReviewState => {
    const controlValues = Object.values(controls);
    const statusBreakdown = controlValues.reduce<Partial<Record<ComplianceControlStatus, number>>>((acc, control) => {
      acc[control.status] = (acc[control.status] ?? 0) + 1;
      return acc;
    }, {});
    const missingEvidence = controlValues
      .filter((control) => control.classification === "manual" && !complianceTerminal(control.status))
      .map((control) => control.controlId);
    const overdueControls = controlValues
      .filter((control) => ["overdue", "escalated"].includes(control.status))
      .map((control) => control.controlId);
    const findings = controlValues.flatMap((control) => control.findings);
    const completedCount = controlValues.filter((control) => complianceTerminal(control.status)).length;
    return {
      reviewId: input.reviewId,
      reviewPeriod: input.reviewPeriod,
      status,
      currentStep,
      evidenceDeadlineSeconds: input.evidenceDeadlineSeconds,
      escalationIntervalSeconds: input.escalationIntervalSeconds,
      controls,
      statusBreakdown,
      missingEvidence,
      overdueControls,
      findings,
      completionPercentage: controlValues.length === 0 ? 0 : Math.round((completedCount / controlValues.length) * 100),
      report,
      completedSteps: [...completedSteps],
      timeline: [...timeline],
      lastError,
    };
  };
  const actionForControl = (controlId: string) =>
    submittedActions.find((action) => action.payload?.controlId === controlId);

  setHandler(complianceReviewStateQuery, snapshot);
  setHandler(complianceReviewControlActionSignal, (submitted) => {
    if (typeof submitted.payload?.controlId === "string") {
      submittedActions.push(submitted);
    }
  });

  const applyControlAction = (control: ComplianceControlState, action: WorkflowHumanActionInput) => {
    const decision = action.decision;
    const payload = action.payload ?? {};
    if (decision === "waive") {
      control.status = "waived";
      control.completedAt = timestamp();
      control.waivedBy = action.submittedBy;
      control.waiverReason = typeof payload.reason === "string" ? payload.reason : action.comment;
      control.findings.push({
        controlId: control.controlId,
        severity: "low",
        message: `Control waived: ${control.waiverReason ?? "No reason provided"}`,
      });
      remember(`Control ${control.controlId} waived`);
      return;
    }
    if (decision === "reject") {
      control.status = "rejected";
      control.evidence = {
        submittedBy: typeof payload.submittedBy === "string" && payload.submittedBy ? payload.submittedBy : "unknown",
        submittedAt: timestamp(),
        reference: typeof payload.evidenceReference === "string" ? payload.evidenceReference : "",
        notes: typeof payload.notes === "string" ? payload.notes : action.comment,
        rejectionReason: typeof payload.reason === "string" ? payload.reason : action.comment,
      };
      control.findings.push({
        controlId: control.controlId,
        severity: "medium",
        message: `Evidence rejected: ${control.evidence.rejectionReason ?? "No reason provided"}`,
      });
      remember(`Evidence rejected for ${control.controlId}`);
      return;
    }
    control.status = "accepted";
    control.completedAt = timestamp();
    control.evidence = {
      submittedBy: typeof payload.submittedBy === "string" && payload.submittedBy ? payload.submittedBy : action.submittedBy ?? "unknown",
      submittedAt: timestamp(),
      reference: typeof payload.evidenceReference === "string" && payload.evidenceReference ? payload.evidenceReference : `evidence://${control.controlId}`,
      notes: typeof payload.notes === "string" ? payload.notes : action.comment,
      acceptedBy: action.submittedBy,
      acceptedAt: timestamp(),
    };
    control.findings.push({
      controlId: control.controlId,
      severity: "info",
      message: "Evidence submitted and accepted through generic workflow task",
    });
    remember(`Evidence accepted for ${control.controlId}`);
  };

  const processManualControl = async (control: ComplianceControlState) => {
    control.status = "waiting_for_evidence";
    const requested = await runStep("compliance.requestEvidence", {
      reviewId: input.reviewId,
      controlId: control.controlId,
      owner: control.owner,
      evidenceRequired: control.evidenceRequired,
    });
    control.requestedAt = String(requested.echoed.requestedAt ?? timestamp());
    const task = await humanTasks.createHumanTask({
      orgId: context.orgId,
      workflowId: info.workflowId,
      runId: info.runId,
      taskKey: `compliance-control-${control.controlId}`,
      taskType: "compliance_control_evidence",
      title: `Submit evidence for ${control.controlId}`,
      description: `${control.title}: ${control.evidenceRequired}`,
      roleRequirements: [{ roleName: "ADMIN" }],
      actionKey: "complianceControlAction",
      actionForm: { fields: [] },
      context: {
        workflowDefinitionKey: context.workflowDefinitionKey,
        reviewId: input.reviewId,
        controlId: control.controlId,
      },
      tokenTtlHours: 72,
    });
    remember(`Evidence requested for ${control.controlId}`);

    const actedBeforeDeadline = await condition(
      () => actionForControl(control.controlId) !== undefined,
      `${input.evidenceDeadlineSeconds} seconds`
    );
    if (!actedBeforeDeadline && !actionForControl(control.controlId)) {
      status = "overdue";
      control.status = "overdue";
      control.overdueAt = timestamp();
      await runStep("compliance.sendReminder", {
        reviewId: input.reviewId,
        controlId: control.controlId,
        owner: control.owner,
      });
      control.remindedAt = timestamp();
      remember(`Reminder sent for ${control.controlId}`);
    }

    const actedBeforeEscalation = await condition(
      () => actionForControl(control.controlId) !== undefined,
      `${input.escalationIntervalSeconds} seconds`
    );
    if (!actedBeforeEscalation && !actionForControl(control.controlId)) {
      status = "escalated";
      control.status = "escalated";
      await runStep("compliance.sendEscalation", {
        reviewId: input.reviewId,
        controlId: control.controlId,
        owner: control.owner,
      });
      control.escalatedAt = timestamp();
      remember(`Escalation sent for ${control.controlId}`);
    }

    await condition(() => actionForControl(control.controlId) !== undefined);
    const action = actionForControl(control.controlId);
    if (action) applyControlAction(control, action);
    await humanTasks.closeHumanTask({
      taskId: task.taskId,
      result: {
        decision: action?.decision ?? "unknown",
        controlId: control.controlId,
        status: control.status,
        submittedBy: action?.submittedBy ?? null,
        channel: action?.channel ?? "AUTHENTICATED",
      },
    });
  };

  try {
    remember(`Compliance review ${input.reviewId} started`);
    status = "collecting_evidence";
    currentStep = "Collect automated evidence";
    await runStep("compliance.collectSystemEvidence", {
      reviewId: input.reviewId,
      automatedControlIds: input.controls.filter((control) => control.classification === "automated").map((control) => control.controlId),
    });
    completedSteps.push("Collect Automated Evidence");

    status = "running_checks";
    currentStep = "Run automated controls";
    await Promise.all(Object.values(controls).filter((control) => control.classification === "automated").map(async (control) => {
      control.status = "checking";
      await runStep("compliance.runControlCheck", {
        reviewId: input.reviewId,
        controlId: control.controlId,
        title: control.title,
      });
      control.status = "passed";
      control.completedAt = timestamp();
      control.findings.push({
        controlId: control.controlId,
        severity: "info",
        message: `${control.title} passed synthetic automated evidence check.`,
      });
      remember(`Automated check ${control.controlId} passed`);
    }));
    completedSteps.push("Run Automated Checks");

    const manualControls = Object.values(controls).filter((control) => control.classification === "manual");
    if (manualControls.length > 0) {
      status = "waiting_for_evidence";
      currentStep = "Wait for control owner evidence";
      await Promise.all(manualControls.map(processManualControl));
      completedSteps.push("Resolve Manual Evidence");
    }

    status = "generating_report";
    currentStep = "Generate compliance report";
    await runStep("compliance.generateReport", {
      reviewId: input.reviewId,
      findingCount: Object.values(controls).flatMap((control) => control.findings).length,
      completedControls: Object.values(controls).filter((control) => complianceTerminal(control.status)).map((control) => control.controlId),
    });
    report = {
      reportId: `report_${input.reviewId}`,
      generatedAt: timestamp(),
      summary: `Compliance review ${input.reviewId} completed with ${snapshot().completionPercentage}% controls resolved.`,
    };
    completedSteps.push("Generate Report");

    status = "completed";
    currentStep = "Completed";
    remember(`Compliance review ${input.reviewId} completed`);
    return snapshot();
  } catch (err) {
    status = "failed";
    currentStep = "Failed";
    lastError = err instanceof Error ? err.message : "Compliance review failed";
    remember(lastError);
    return snapshot();
  }
}

export type UnderwritingApplicationType = "business_loan" | "vendor_risk" | "account_opening" | "eligibility";
export type UnderwritingCheckType = "identity" | "financial" | "fraud";
export type UnderwritingStatus =
  | "received"
  | "gathering_data"
  | "running_checks"
  | "evaluating_risk"
  | "waiting_for_information"
  | "waiting_for_analyst"
  | "approved"
  | "rejected"
  | "cancelled"
  | "failed";
export type UnderwritingCheckStatus = "pending" | "running" | "passed" | "failed" | "insufficient_information" | "cancelled";

export interface UnderwritingCapstoneWorkflowInput {
  applicationId: string;
  applicantName: string;
  applicationType: UnderwritingApplicationType;
  submittedData: Record<string, unknown>;
  decisionPolicy: {
    autoApproveMaxRiskScore: number;
    manualReviewMinRiskScore: number;
    autoRejectMinRiskScore: number;
    requireAnalystForMissingInformation: boolean;
  };
  demoTiming: {
    informationReminderSeconds: number;
  };
  demoScenario: "auto_approve" | "manual_review" | "missing_information" | "auto_reject";
  businessKey?: string;
}

export interface UnderwritingRiskFinding {
  checkType: UnderwritingCheckType;
  severity: "info" | "low" | "medium" | "high";
  message: string;
}

export interface UnderwritingCheckResult {
  checkType: UnderwritingCheckType;
  status: UnderwritingCheckStatus;
  riskScore: number;
  findings: UnderwritingRiskFinding[];
  missingFields: string[];
  affectedByFields: string[];
  checkedAt: string;
  summary: string;
}

export interface UnderwritingCheckState extends UnderwritingCheckResult {
  childWorkflowId: string;
  attempts: number;
  lastError?: string;
}

export interface UnderwritingDecisionRecord {
  timestamp: string;
  decision: "approved" | "rejected" | "manual_review_required" | "information_requested" | "cancelled";
  actor: "system" | "analyst" | "applicant";
  reason: string;
  riskScore?: number;
}

export interface UnderwritingCapstoneState {
  applicationId: string;
  applicantName: string;
  applicationType: UnderwritingApplicationType;
  status: UnderwritingStatus;
  currentStage: string;
  submittedData: Record<string, unknown>;
  checkResults: Record<UnderwritingCheckType, UnderwritingCheckState>;
  missingInformation: string[];
  riskFindings: UnderwritingRiskFinding[];
  analystReviewStatus: "not_required" | "pending" | "approved" | "rejected" | "requested_information";
  decisionHistory: UnderwritingDecisionRecord[];
  nextAction: string;
  childWorkflowIds: string[];
  parentWorkflowId: string;
  finalDecision?: "approved" | "rejected";
  riskScore?: number;
  riskSummary?: string;
  completedSteps: string[];
  timeline: Array<{
    timestamp: string;
    message: string;
  }>;
  lastError?: string;
}

interface UnderwritingRiskCheckChildInput {
  orgId: string;
  workflowDefinitionKey: string;
  parentWorkflowId: string;
  applicationId: string;
  checkType: UnderwritingCheckType;
  data: Record<string, unknown>;
  demoScenario: UnderwritingCapstoneWorkflowInput["demoScenario"];
  attempt: number;
}

const underwritingCheckTypes: UnderwritingCheckType[] = ["identity", "financial", "fraud"];

const createUnderwritingCheckState = (
  applicationId: string,
  checkType: UnderwritingCheckType
): UnderwritingCheckState => ({
  checkType,
  status: "pending",
  riskScore: 0,
  findings: [],
  missingFields: [],
  affectedByFields: [],
  checkedAt: "",
  summary: "",
  childWorkflowId: `underwriting.${applicationId}.check.${checkType}`,
  attempts: 0,
});

export async function underwritingRiskCheckChildWorkflow(
  input: UnderwritingRiskCheckChildInput
): Promise<UnderwritingCheckResult> {
  const info = workflowInfo();
  const required: Record<UnderwritingCheckType, string[]> = {
    identity: ["identityDocument", "businessRegistration"],
    financial: ["bankStatements", "requestedAmount"],
    fraud: ["identityDocument", "bankStatements"],
  };
  const missingFields = required[input.checkType].filter((field) => input.data[field] === undefined || input.data[field] === "");
  await showcaseActivities.runShowcaseSyntheticStep({
    orgId: input.orgId,
    workflowDefinitionKey: input.workflowDefinitionKey,
    requirementKey: "syntheticEcho",
    stepKey: `underwriting.riskCheck.${input.checkType}`,
    idempotencyKey: `${info.workflowId}:risk-check`,
    payload: {
      parentWorkflowId: input.parentWorkflowId,
      applicationId: input.applicationId,
      checkType: input.checkType,
      missingFields,
      attempt: input.attempt,
    },
  });
  if (missingFields.length > 0) {
    return {
      checkType: input.checkType,
      status: "insufficient_information",
      riskScore: 50,
      findings: [{
        checkType: input.checkType,
        severity: "medium",
        message: `${input.checkType} check needs ${missingFields.join(", ")}`,
      }],
      missingFields,
      affectedByFields: missingFields,
      checkedAt: new Date().toISOString(),
      summary: `${input.checkType} check requires additional information.`,
    };
  }
  const riskFlags = String(input.data.riskFlags ?? "").toLowerCase();
  const highRisk = input.demoScenario === "auto_reject" || riskFlags.includes(input.checkType) || input.data[`${input.checkType}Risk`] === "high";
  const mediumRisk = input.demoScenario === "manual_review" || riskFlags.includes("medium") || input.data[`${input.checkType}Risk`] === "medium";
  const riskScore = highRisk ? 86 : mediumRisk ? 58 : input.checkType === "financial" && Number(input.data.requestedAmount ?? 0) > 100_000 ? 62 : 18;
  return {
    checkType: input.checkType,
    status: riskScore >= 80 ? "failed" : "passed",
    riskScore,
    findings: [{
      checkType: input.checkType,
      severity: riskScore >= 80 ? "high" : riskScore >= 50 ? "medium" : "info",
      message: riskScore >= 80
        ? `${input.checkType} check found a synthetic high-risk signal.`
        : riskScore >= 50
          ? `${input.checkType} check requires analyst review.`
          : `${input.checkType} check passed synthetic policy.`,
    }],
    missingFields: [],
    affectedByFields: [],
    checkedAt: new Date().toISOString(),
    summary: `${input.checkType} check completed with risk score ${riskScore}.`,
  };
}

export async function underwritingCapstoneWorkflow(
  input: UnderwritingCapstoneWorkflowInput,
  context: PlatformWorkflowContext
): Promise<UnderwritingCapstoneState> {
  const info = workflowInfo();
  await ensureWorkflowExecutionProjection(input, context);
  const actions: WorkflowHumanActionInput[] = [];
  let status: UnderwritingStatus = "received";
  let currentStage = "Application Received";
  let nextAction = "Gather application data";
  let analystReviewStatus: UnderwritingCapstoneState["analystReviewStatus"] = "not_required";
  let finalDecision: UnderwritingCapstoneState["finalDecision"] | undefined;
  let riskScore: number | undefined;
  let riskSummary: string | undefined;
  let lastError: string | undefined;
  let cancellationReason: string | undefined;
  let data: Record<string, unknown> = { ...input.submittedData };
  let analystTaskId: string | undefined;
  let informationTaskId: string | undefined;
  const completedSteps: string[] = [];
  const decisionHistory: UnderwritingDecisionRecord[] = [];
  const timeline: UnderwritingCapstoneState["timeline"] = [];
  const checks: Record<UnderwritingCheckType, UnderwritingCheckState> = {
    identity: createUnderwritingCheckState(input.applicationId, "identity"),
    financial: createUnderwritingCheckState(input.applicationId, "financial"),
    fraud: createUnderwritingCheckState(input.applicationId, "fraud"),
  };
  const timestamp = () => new Date().toISOString();
  const remember = (message: string) => {
    timeline.push({ timestamp: timestamp(), message });
  };
  const runStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho",
      stepKey,
      idempotencyKey: `${info.workflowId}:${stepKey}:${String(payload.stepInstance ?? payload.decision ?? payload.message ?? payload.applicationId ?? "underwriting")}`,
      payload,
    });
  const missingInformation = () => Array.from(new Set(underwritingCheckTypes.flatMap((type) => checks[type].missingFields)));
  const riskFindings = () => underwritingCheckTypes.flatMap((type) => checks[type].findings);
  const snapshot = (): UnderwritingCapstoneState => ({
    applicationId: input.applicationId,
    applicantName: input.applicantName,
    applicationType: input.applicationType,
    status,
    currentStage,
    submittedData: { ...data },
    checkResults: {
      identity: { ...checks.identity },
      financial: { ...checks.financial },
      fraud: { ...checks.fraud },
    },
    missingInformation: missingInformation(),
    riskFindings: riskFindings(),
    analystReviewStatus,
    decisionHistory: decisionHistory.map((decision) => ({ ...decision })),
    nextAction,
    childWorkflowIds: underwritingCheckTypes.map((type) => checks[type].childWorkflowId),
    parentWorkflowId: info.workflowId,
    finalDecision,
    riskScore,
    riskSummary,
    completedSteps: [...completedSteps],
    timeline: [...timeline],
    lastError,
  });
  const peekActionSignal = (decision: string) => actions.find((action) => action.decision === decision);
  const consumeActionSignal = (...decisions: string[]) => {
    for (const decision of decisions) {
      const index = actions.findIndex((action) => action.decision === decision);
      if (index >= 0) {
        const [action] = actions.splice(index, 1);
        return action;
      }
    }
    return undefined;
  };

  setHandler(underwritingCapstoneStateQuery, snapshot);
  setHandler(underwritingCapstoneActionSignal, (submitted) => {
    actions.push(submitted);
  });

  const runChecks = async (types: UnderwritingCheckType[]) => {
    status = "running_checks";
    currentStage = types.length === 3 ? "Run Parallel Risk Checks" : `Re-run ${types.join(", ")} checks`;
    nextAction = "Wait for risk check children";
    await Promise.all(types.map(async (type) => {
      checks[type].status = "running";
      checks[type].attempts += 1;
      const childWorkflowId = `${info.workflowId}.check.${type}.attempt.${checks[type].attempts}`;
      checks[type].childWorkflowId = childWorkflowId;
      const result = await executeChild(underwritingRiskCheckChildWorkflow, {
        workflowId: childWorkflowId,
        args: [{
          orgId: context.orgId,
          workflowDefinitionKey: context.workflowDefinitionKey,
          parentWorkflowId: info.workflowId,
          applicationId: input.applicationId,
          checkType: type,
          data,
          demoScenario: input.demoScenario,
          attempt: checks[type].attempts,
        }],
      });
      checks[type] = {
        ...checks[type],
        ...result,
        childWorkflowId,
        attempts: checks[type].attempts,
      };
      remember(`${type} child workflow completed with ${result.status}`);
    }));
  };

  const setDecision = async (decision: "approved" | "rejected", actor: "system" | "analyst", reason: string) => {
    finalDecision = decision;
    status = decision;
    currentStage = decision === "approved" ? "Approved" : "Rejected";
    nextAction = "No further action";
    decisionHistory.push({ timestamp: timestamp(), decision, actor, reason, riskScore });
    await runStep("underwriting.recordDecision", {
      applicationId: input.applicationId,
      decision,
      reason,
    });
    remember(`Application ${decision}: ${reason}`);
  };

  const createInformationTask = async (fields: string[], reason: string) => {
    status = "waiting_for_information";
    currentStage = "Waiting for Additional Information";
    nextAction = `Submit: ${fields.join(", ")}`;
    decisionHistory.push({ timestamp: timestamp(), decision: "information_requested", actor: "system", reason, riskScore });
    await runStep("underwriting.notifyRequester", {
      applicationId: input.applicationId,
      message: `Please provide: ${fields.join(", ")}`,
    });
    const task = await humanTasks.createHumanTask({
      orgId: context.orgId,
      workflowId: info.workflowId,
      runId: info.runId,
      taskKey: `underwriting-information-${decisionHistory.length}`,
      taskType: "underwriting_missing_information",
      title: `Submit missing information for ${input.applicationId}`,
      description: `Please provide: ${fields.join(", ")}`,
      roleRequirements: [{ roleName: "ADMIN" }],
      actionKey: "underwritingAction",
      actionForm: { fields: [] },
      context: {
        workflowDefinitionKey: context.workflowDefinitionKey,
        applicationId: input.applicationId,
        requestedFields: fields,
      },
      tokenTtlHours: 72,
    });
    informationTaskId = task.taskId;
    if (input.demoTiming.informationReminderSeconds > 0) {
      const answeredBeforeReminder = await condition(
        () => peekActionSignal("submit_information") !== undefined || peekActionSignal("cancel") !== undefined,
        `${input.demoTiming.informationReminderSeconds} seconds`
      );
      if (!answeredBeforeReminder && !peekActionSignal("submit_information") && !peekActionSignal("cancel")) {
        await runStep("underwriting.notifyRequester", {
          applicationId: input.applicationId,
          message: `Reminder: ${fields.join(", ")} still needed`,
        });
        remember("Additional information reminder sent");
      }
    }
    await condition(() => peekActionSignal("submit_information") !== undefined || peekActionSignal("cancel") !== undefined);
    const cancel = consumeActionSignal("cancel");
    if (cancel) {
      cancellationReason = typeof cancel.payload?.reason === "string" ? cancel.payload.reason : cancel.comment ?? "Application cancelled";
      throw new Error(cancellationReason);
    }
    const submission = consumeActionSignal("submit_information");
    const submittedFields = submission?.payload?.submittedFields;
    if (submittedFields && typeof submittedFields === "object" && !Array.isArray(submittedFields)) {
      data = { ...data, ...submittedFields };
    }
    await humanTasks.closeHumanTask({
      taskId: task.taskId,
      result: {
        decision: "submit_information",
        submittedFields: submittedFields ?? {},
        submittedBy: submission?.submittedBy ?? null,
        channel: submission?.channel ?? "AUTHENTICATED",
      },
    });
    const changedFields = Object.keys((submittedFields ?? {}) as Record<string, unknown>);
    const affected = underwritingCheckTypes.filter((type) =>
      checks[type].status === "insufficient_information" ||
      checks[type].missingFields.some((field) => changedFields.includes(field)) ||
      checks[type].affectedByFields.some((field) => changedFields.includes(field))
    );
    for (const type of affected) {
      checks[type].missingFields = [];
      checks[type].affectedByFields = [];
    }
    await runChecks(affected.length > 0 ? affected : underwritingCheckTypes);
  };

  const evaluate = async (): Promise<"done" | "continue"> => {
    status = "evaluating_risk";
    currentStage = "Evaluate Risk";
    nextAction = "Apply synthetic decision policy";
    const missing = missingInformation();
    if (missing.length > 0) {
      await createInformationTask(missing, "Risk checks returned insufficient information");
      return "continue";
    }

    await runStep("underwriting.summarizeRisk", {
      applicationId: input.applicationId,
      checkCount: underwritingCheckTypes.length,
    });
    const results = underwritingCheckTypes.map((type) => checks[type]);
    riskScore = Math.max(...results.map((result) => result.riskScore), 0);
    riskSummary = `Synthetic underwriting analysis for ${input.applicationId}: max risk score ${riskScore} across ${results.length} checks.`;
    completedSteps.push("Evaluate Risk");

    if (riskScore <= input.decisionPolicy.autoApproveMaxRiskScore && results.every((result) => result.status === "passed")) {
      await setDecision("approved", "system", `Auto-approved by policy at risk score ${riskScore}`);
      return "done";
    }
    if (riskScore >= input.decisionPolicy.autoRejectMinRiskScore || results.some((result) => result.status === "failed" && result.riskScore >= input.decisionPolicy.autoRejectMinRiskScore)) {
      await setDecision("rejected", "system", `Auto-rejected by policy at risk score ${riskScore}`);
      return "done";
    }

    status = "waiting_for_analyst";
    currentStage = "Waiting for Analyst Review";
    nextAction = "Analyst approve, reject, or request information";
    analystReviewStatus = "pending";
    decisionHistory.push({ timestamp: timestamp(), decision: "manual_review_required", actor: "system", reason: riskSummary, riskScore });
    const task = await humanTasks.createHumanTask({
      orgId: context.orgId,
      workflowId: info.workflowId,
      runId: info.runId,
      taskKey: `underwriting-analyst-${decisionHistory.length}`,
      taskType: "underwriting_analyst_review",
      title: `Analyst review for ${input.applicationId}`,
      description: riskSummary,
      roleRequirements: [{ roleName: "ADMIN" }],
      actionKey: "underwritingAction",
      actionForm: { fields: [] },
      context: {
        workflowDefinitionKey: context.workflowDefinitionKey,
        applicationId: input.applicationId,
        riskScore,
        riskSummary,
      },
      tokenTtlHours: 72,
    });
    analystTaskId = task.taskId;
    await condition(() =>
      peekActionSignal("approved") !== undefined ||
      peekActionSignal("rejected") !== undefined ||
      peekActionSignal("request_information") !== undefined ||
      peekActionSignal("cancel") !== undefined
    );
    const cancel = consumeActionSignal("cancel");
    if (cancel) {
      cancellationReason = typeof cancel.payload?.reason === "string" ? cancel.payload.reason : cancel.comment ?? "Application cancelled";
      throw new Error(cancellationReason);
    }
    const approved = consumeActionSignal("approved");
    const rejected = consumeActionSignal("rejected");
    const requestInfo = consumeActionSignal("request_information");
    const acted = approved ?? rejected ?? requestInfo;
    await humanTasks.closeHumanTask({
      taskId: task.taskId,
      result: {
        decision: acted?.decision ?? "unknown",
        reason: acted?.payload?.reason ?? acted?.comment ?? null,
        submittedBy: acted?.submittedBy ?? null,
        channel: acted?.channel ?? "AUTHENTICATED",
      },
    });
    if (approved) {
      analystReviewStatus = "approved";
      await setDecision("approved", "analyst", typeof approved.payload?.reason === "string" ? approved.payload.reason : approved.comment ?? "Approved by analyst");
      return "done";
    }
    if (rejected) {
      analystReviewStatus = "rejected";
      await setDecision("rejected", "analyst", typeof rejected.payload?.reason === "string" ? rejected.payload.reason : rejected.comment ?? "Rejected by analyst");
      return "done";
    }
    if (requestInfo) {
      analystReviewStatus = "requested_information";
      const fields = Array.isArray(requestInfo.payload?.requestedFields) ? requestInfo.payload.requestedFields.map(String) : ["analystRequestedDocument"];
      await createInformationTask(fields, typeof requestInfo.payload?.reason === "string" ? requestInfo.payload.reason : "Analyst requested more information");
      return "continue";
    }
    return "continue";
  };

  try {
    remember(`Application ${input.applicationId} received`);
    status = "gathering_data";
    currentStage = "Gather Data";
    nextAction = "Normalize submitted data";
    await runStep("underwriting.gatherData", {
      applicationId: input.applicationId,
      applicationType: input.applicationType,
      demoScenario: input.demoScenario,
    });
    if (input.demoScenario === "manual_review") data = { ...data, riskFlags: "medium" };
    if (input.demoScenario === "auto_reject") data = { ...data, riskFlags: "fraud" };
    completedSteps.push("Gather Data");

    await runChecks(underwritingCheckTypes);
    completedSteps.push("Run Initial Checks");

    while (!["approved", "rejected", "cancelled", "failed"].includes(status)) {
      const result = await evaluate();
      if (result === "done") break;
    }
    return snapshot();
  } catch (err) {
    const cancelAction = consumeActionSignal("cancel") ?? peekActionSignal("cancel");
    if (cancelAction || cancellationReason) {
      await runStep("underwriting.cleanupApplication", {
        applicationId: input.applicationId,
        reason: cancellationReason ?? cancelAction?.payload?.reason ?? cancelAction?.comment ?? "Application cancelled",
      });
      status = "cancelled";
      currentStage = "Cancelled";
      nextAction = "No further action";
      decisionHistory.push({
        timestamp: timestamp(),
        decision: "cancelled",
        actor: "applicant",
        reason: cancellationReason ?? (typeof cancelAction?.payload?.reason === "string" ? cancelAction.payload.reason : cancelAction?.comment ?? "Application cancelled"),
      });
    } else {
      status = "failed";
      currentStage = "Failed";
      nextAction = "Review error and retry demo";
      lastError = err instanceof Error ? err.message : "Underwriting capstone failed";
    }
    if (analystTaskId) {
      await humanTasks.closeHumanTask({ taskId: analystTaskId, result: { status, error: lastError ?? null } });
    }
    if (informationTaskId) {
      await humanTasks.closeHumanTask({ taskId: informationTaskId, result: { status, error: lastError ?? null } });
    }
    remember(lastError ?? status);
    return snapshot();
  }
}
