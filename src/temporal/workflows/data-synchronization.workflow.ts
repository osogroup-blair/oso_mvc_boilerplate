import { setHandler, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext } from "../contracts.js";
import { dataSynchronizationStateQuery, showcaseActivities, ensureWorkflowExecutionProjection, type DataSyncTarget, type DataSynchronizationWorkflowInput, type DataSynchronizationState, createDataSyncTargetState } from './shared.js';
import { runVersionedWorkflow } from './workflow-runtime.js';
import type { RequirementKeyFor } from "../workflow-registry.js";

export async function dataSynchronizationWorkflow(
  input: DataSynchronizationWorkflowInput,
  context: PlatformWorkflowContext
): Promise<DataSynchronizationState> {
 return runVersionedWorkflow(context, async()=>{
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
      requirementKey: "syntheticEcho" satisfies RequirementKeyFor<"showcase.dataSynchronization">,
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

 });
}
