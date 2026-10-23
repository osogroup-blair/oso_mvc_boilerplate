import { condition, isCancellation, setHandler, sleep, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext, WorkflowHumanActionInput } from "../contracts.js";
import { employeeLifecycleStateQuery, employeeLifecycleChecklistActionSignal, humanTasks, showcaseActivities, ensureWorkflowExecutionProjection, type EmployeeLifecycleStatus, type EmployeeLifecycleWorkflowInput, type EmployeeLifecycleState, allEmployeeSystems, createEmployeeSystemState } from './shared.js';
import { runVersionedWorkflow, setHumanActionHandler } from './workflow-runtime.js';

export async function employeeLifecycleWorkflow(
  input: EmployeeLifecycleWorkflowInput,
  context: PlatformWorkflowContext
): Promise<EmployeeLifecycleState> {
 return runVersionedWorkflow(context, async()=>{
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
  setHumanActionHandler(employeeLifecycleChecklistActionSignal, (submitted) => {
    if (!checklistAction && state.managerChecklistStatus === "waiting") {
      checklistAction = submitted; return true;
    }
   return false; });

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

 });
}
