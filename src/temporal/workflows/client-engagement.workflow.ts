import { condition, executeChild, isCancellation, setHandler, sleep, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { clientEngagementStateQuery, clientEngagementApprovalActionSignal, humanTasks, showcaseActivities, ensureWorkflowExecutionProjection, type EngagementPhase, type ClientEngagementStatus, type ClientEngagementWorkflowInput, type ClientEngagementState, engagementPhases, allImplementationWorkstreams, engagementPhaseMilestones, createEngagementPhaseState, createEngagementWorkstreamState } from './shared.js';
import { clientEngagementWorkstreamWorkflow } from './client-engagement-workstream.workflow.js';
import { runVersionedWorkflow, setHumanActionHandler } from './workflow-runtime.js';

export async function clientEngagementWorkflow(
  input: ClientEngagementWorkflowInput,
  context: PlatformWorkflowContext
): Promise<ClientEngagementState> {
 return runVersionedWorkflow(context, async()=>{
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
  setHumanActionHandler(clientEngagementApprovalActionSignal, (submitted) => {
    if (!approvalAction && state.status === "waiting_for_approval") {
      approvalAction = submitted; return true;
    }
   return false; });

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

 });
}
