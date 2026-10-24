import { condition, setHandler, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { complianceReviewStateQuery, complianceReviewControlActionSignal, humanTasks, showcaseActivities, ensureWorkflowExecutionProjection, type ComplianceReviewStatus, type ComplianceControlStatus, type ComplianceReviewWorkflowInput, type ComplianceControlState, type ComplianceReviewState, complianceTerminal } from './shared.js';
import { runVersionedWorkflow, setHumanActionHandler } from './workflow-runtime.js';
import type { RequirementKeyFor } from "../workflow-registry.js";

export async function complianceReviewWorkflow(
  input: ComplianceReviewWorkflowInput,
  context: PlatformWorkflowContext
): Promise<ComplianceReviewState> {
 return runVersionedWorkflow(context, async()=>{
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
      requirementKey: "syntheticEcho" satisfies RequirementKeyFor<"showcase.complianceReview">,
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
  setHumanActionHandler(complianceReviewControlActionSignal, (submitted) => {
    if (typeof submitted.payload?.controlId === "string") {
      submittedActions.push(submitted); return true;
    }
   return false; });

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

 });
}
