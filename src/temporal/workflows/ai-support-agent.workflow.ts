import { condition, setHandler, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { aiSupportAgentStateQuery, aiSupportAgentApprovalActionSignal, humanTasks, showcaseActivities, ensureWorkflowExecutionProjection, type AiSupportAgentToolName, type AiSupportAgentAction, type AiSupportAgentWorkflowInput, type AiSupportAgentToolCall, type AiSupportAgentState } from './shared.js';
import { runVersionedWorkflow, setHumanActionHandler } from './workflow-runtime.js';
import type { RequirementKeyFor } from "../workflow-registry.js";

export async function aiSupportAgentWorkflow(
  input: AiSupportAgentWorkflowInput,
  context: PlatformWorkflowContext
): Promise<AiSupportAgentState> {
 return runVersionedWorkflow(context, async()=>{
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
      requirementKey: "syntheticEcho" satisfies RequirementKeyFor<"showcase.aiSupportAgent">,
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
  setHumanActionHandler(aiSupportAgentApprovalActionSignal, (submitted) => {
    if (!approvalAction && state.stage === "waiting_for_approval" && state.pendingApproval) {
      approvalAction = submitted; return true;
    }
   return false; });

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

 });
}
