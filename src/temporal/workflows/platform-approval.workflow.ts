import { condition, isCancellation, setHandler, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { platformApprovalStateQuery, platformApprovalActionSignal, humanTasks, ensureWorkflowExecutionProjection, type PlatformApprovalWorkflowInput, type PlatformApprovalWorkflowState } from './shared.js';
import { runVersionedWorkflow, setHumanActionHandler } from './workflow-runtime.js';

export async function platformApprovalWorkflow(
  input: PlatformApprovalWorkflowInput,
  context: PlatformWorkflowContext
): Promise<PlatformApprovalWorkflowState> {
 return runVersionedWorkflow(context, async()=>{
  const state: PlatformApprovalWorkflowState = {
    phase: "waiting",
    title: input.title,
  };
  let action: WorkflowHumanActionInput | undefined;

  setHandler(platformApprovalStateQuery, () => state);
  setHumanActionHandler(platformApprovalActionSignal, (submitted) => {
    if (!action) { action = submitted; return true; }
   return false; });
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

 });
}
