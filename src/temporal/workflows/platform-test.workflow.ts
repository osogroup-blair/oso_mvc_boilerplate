import { isCancellation, setHandler, sleep, workflowInfo } from "@temporalio/workflow";
import type { PlatformWorkflowContext } from "../contracts.js";
import { type PlatformTestWorkflowInput, type PlatformTestWorkflowState, platformTestStateQuery, integrations, ensureWorkflowExecutionProjection } from './shared.js';
import { runVersionedWorkflow } from './workflow-runtime.js';
import type { RequirementKeyFor } from "../workflow-registry.js";

export async function platformTestWorkflow(
  input: PlatformTestWorkflowInput,
  context: PlatformWorkflowContext
): Promise<PlatformTestWorkflowState> {
 return runVersionedWorkflow(context, async()=>{
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
      requirementKey: "syntheticEcho" satisfies RequirementKeyFor<"platform.test">,
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

 });
}
