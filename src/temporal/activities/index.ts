import { workflowHumanTaskService } from "../../services/workflow-human-task.service.js";
import { workflowExecutionService } from "../../services/workflow-execution.service.js";
import { runIntegrationOperation } from "./integration-activity.js";
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
  const result = await runIntegrationOperation(
    {
      orgId: input.orgId,
      workflowDefinitionKey: input.workflowDefinitionKey,
      requirementKey: input.requirementKey,
      scope: "integration.synthetic.echo",
      idempotencyKey: input.idempotencyKey,
      request: input,
    },
    async (resolved) => {
      const adapter = resolved.adapter as SyntheticEchoAdapter;
      const echoed = await adapter.echo(input.payload);

      return {
        providerKey: resolved.connection.providerKey,
        connectionId: resolved.connection.id,
        endpointLabel: echoed.endpointLabel,
        echoed: echoed.echoed as Record<string, unknown>,
        replayed: false,
      };
    }, { retrySafe: true }
  );

  return { ...result.value, replayed: result.replayed };
}

export async function runShowcaseSyntheticStep(
  input: RunShowcaseSyntheticStepInput
): Promise<RunShowcaseSyntheticStepResult> {
  const result = await runIntegrationOperation(
    {
      orgId: input.orgId,
      workflowDefinitionKey: input.workflowDefinitionKey,
      requirementKey: input.requirementKey,
      scope: `showcase.synthetic.${input.workflowDefinitionKey}.${input.stepKey}`,
      idempotencyKey: input.idempotencyKey,
      request: input,
    },
    async (resolved) => {
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
    }, { retrySafe: true }
  );

  return { ...result.value, replayed: result.replayed };
}

export async function cancelOpenWorkflowTasks(input:{orgId:string;workflowId:string;runId:string}) { await workflowHumanTaskService.cancelOpenWorkflowTasks(input); }
export async function applicationCanary() { return {status:"ok"}; }

export const activities = {
  applicationCanary, cancelOpenWorkflowTasks,
  ensureWorkflowExecutionProjection,
  createHumanTask,
  closeHumanTask,
  runSyntheticIntegration,
  runShowcaseSyntheticStep,
};
