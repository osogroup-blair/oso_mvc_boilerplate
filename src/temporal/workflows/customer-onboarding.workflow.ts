import { condition, isCancellation, setHandler, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { customerOnboardingStateQuery, customerOnboardingActionSignal, humanTasks, showcaseActivities, ensureWorkflowExecutionProjection, type CustomerOnboardingWorkflowInput, type CustomerOnboardingStatus, type CustomerOnboardingState } from './shared.js';
import { runVersionedWorkflow, setHumanActionHandler } from './workflow-runtime.js';

export async function customerOnboardingWorkflow(
  input: CustomerOnboardingWorkflowInput,
  context: PlatformWorkflowContext
): Promise<CustomerOnboardingState> {
 return runVersionedWorkflow(context, async()=>{
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
  setHumanActionHandler(customerOnboardingActionSignal, (submitted) => {
    if (!action && state.status === "waiting_for_customer_approval") { action = submitted; return true; }
   return false; });
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

 });
}
