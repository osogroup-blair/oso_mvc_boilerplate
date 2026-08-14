import { workflowHumanTaskService } from "../../services/workflow-human-task.service.js";
import { workflowExecutionService } from "../../services/workflow-execution.service.js";
import { integrationResolverService } from "../../services/integration-resolver.service.js";
import { activityIdempotencyService } from "../../services/activity-idempotency.service.js";
import type { SyntheticEchoAdapter } from "../../integrations/provider-registry.js";
import type {
  CloseHumanTaskInput,
  CreateHumanTaskInput,
  EnsureWorkflowExecutionProjectionInput,
  EnsureWorkflowExecutionProjectionResult,
  RunSyntheticIntegrationInput,
  RunSyntheticIntegrationResult,
  RunShowcaseSyntheticStepInput,
  RunShowcaseSyntheticStepResult,
} from "../contracts.js";

export async function createHumanTask(input: CreateHumanTaskInput) {
  return workflowHumanTaskService.createHumanTask(input);
}

export async function closeHumanTask(input: CloseHumanTaskInput) {
  return workflowHumanTaskService.closeHumanTask(input);
}

export async function ensureWorkflowExecutionProjection(
  input: EnsureWorkflowExecutionProjectionInput
): Promise<EnsureWorkflowExecutionProjectionResult> {
  const result = await workflowExecutionService.ensureStartedProjection(input);
  return {
    executionId: result.execution.id,
    created: result.created,
  };
}

export async function runSyntheticIntegration(
  input: RunSyntheticIntegrationInput
): Promise<RunSyntheticIntegrationResult> {
  const result = await activityIdempotencyService.run(
    input.orgId,
    "integration.synthetic.echo",
    input.idempotencyKey,
    input,
    async () => {
      const resolved = await integrationResolverService.resolve({
        orgId: input.orgId,
        workflowDefinitionKey: input.workflowDefinitionKey,
        requirementKey: input.requirementKey,
      });
      const adapter = resolved.adapter as SyntheticEchoAdapter;
      const echoed = await adapter.echo(input.payload);

      return {
        providerKey: resolved.connection.providerKey,
        connectionId: resolved.connection.id,
        endpointLabel: echoed.endpointLabel,
        echoed: echoed.echoed as Record<string, unknown>,
        replayed: false,
      };
    }
  );

  return { ...result.value, replayed: result.replayed };
}

export async function runShowcaseSyntheticStep(
  input: RunShowcaseSyntheticStepInput
): Promise<RunShowcaseSyntheticStepResult> {
  const result = await activityIdempotencyService.run(
    input.orgId,
    `showcase.synthetic.${input.workflowDefinitionKey}.${input.stepKey}`,
    input.idempotencyKey,
    input,
    async () => {
      const resolved = await integrationResolverService.resolve({
        orgId: input.orgId,
        workflowDefinitionKey: input.workflowDefinitionKey,
        requirementKey: input.requirementKey,
      });
      const adapter = resolved.adapter as SyntheticEchoAdapter;
      const echoed = await adapter.echo({
        stepKey: input.stepKey,
        ...input.payload,
      });

      return {
        stepKey: input.stepKey,
        providerKey: resolved.connection.providerKey,
        connectionId: resolved.connection.id,
        endpointLabel: echoed.endpointLabel,
        echoed: echoed.echoed as Record<string, unknown>,
        replayed: false,
      };
    }
  );

  return { ...result.value, replayed: result.replayed };
}

export const activities = {
  ensureWorkflowExecutionProjection,
  createHumanTask,
  closeHumanTask,
  runSyntheticIntegration,
  runShowcaseSyntheticStep,
};
