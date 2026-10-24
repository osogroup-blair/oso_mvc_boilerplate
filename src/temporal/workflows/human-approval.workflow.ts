import { condition, isCancellation, setHandler, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { humanApprovalStateQuery, humanApprovalReviewActionSignal, humanApprovalResubmitActionSignal, humanTasks, showcaseActivities, ensureWorkflowExecutionProjection, type HumanApprovalWorkflowInput, type HumanApprovalState } from './shared.js';
import { runVersionedWorkflow, setHumanActionHandler } from './workflow-runtime.js';
import type { RequirementKeyFor } from "../workflow-registry.js";

export async function humanApprovalWorkflow(
  input: HumanApprovalWorkflowInput,
  context: PlatformWorkflowContext
): Promise<HumanApprovalState> {
 return runVersionedWorkflow(context, async()=>{
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
  setHumanActionHandler(humanApprovalReviewActionSignal, (submitted) => {
    if (!reviewAction && (state.status === "waiting_for_approval" || state.status === "approval_overdue")) {
      reviewAction = submitted; return true;
    }
   return false; });
  setHumanActionHandler(humanApprovalResubmitActionSignal, (submitted) => {
    if (!resubmitAction && state.status === "waiting_for_resubmission") {
      resubmitAction = submitted; return true;
    }
   return false; });
  await ensureWorkflowExecutionProjection(input, context);

  const runSyntheticStep = (stepKey: string, payload: Record<string, unknown>) =>
    showcaseActivities.runShowcaseSyntheticStep({
      orgId: context.orgId,
      workflowDefinitionKey: context.workflowDefinitionKey,
      requirementKey: "syntheticEcho" satisfies RequirementKeyFor<"showcase.humanApproval">,
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

 });
}
