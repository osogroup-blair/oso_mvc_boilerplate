import { condition, executeChild, setHandler, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { underwritingCapstoneStateQuery, underwritingCapstoneActionSignal, humanTasks, showcaseActivities, ensureWorkflowExecutionProjection, type UnderwritingCheckType, type UnderwritingStatus, type UnderwritingCapstoneWorkflowInput, type UnderwritingCheckState, type UnderwritingDecisionRecord, type UnderwritingCapstoneState, underwritingCheckTypes, createUnderwritingCheckState } from './shared.js';
import { underwritingRiskCheckChildWorkflow } from './underwriting-risk-check-child.workflow.js';
import { runVersionedWorkflow, setHumanActionHandler } from './workflow-runtime.js';

export async function underwritingCapstoneWorkflow(
  input: UnderwritingCapstoneWorkflowInput,
  context: PlatformWorkflowContext
): Promise<UnderwritingCapstoneState> {
 return runVersionedWorkflow(context, async()=>{
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
  setHumanActionHandler(underwritingCapstoneActionSignal, (submitted) => {
    actions.push(submitted); return true;
   return false; });

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

 });
}
