import type { IntegrationRequirementKey } from "./workflow-registry.js";

export interface PlatformWorkflowContext {
  orgId: string;
  startedById: string;
  workflowDefinitionKey: string;
  scheduleId?: string;
  actionProtocol?: string;
}

export interface EnsureWorkflowExecutionProjectionInput {
  orgId: string;
  workflowDefinitionKey: string;
  startedById: string;
  workflowId: string;
  runId?: string;
  scheduleId?: string;
  actionProtocol?: string;
  input: unknown;
}

export interface EnsureWorkflowExecutionProjectionResult {
  executionId: string;
  created: boolean;
}

export interface HumanTaskRoleRequirement {
  roleName?: string;
  roleId?: string;
}

export interface CreateHumanTaskInput {
  orgId: string;
  workflowId: string;
  runId?: string;
  taskKey: string;
  taskType: string;
  title: string;
  description?: string;
  assignedUserEmail?: string;
  roleRequirements?: HumanTaskRoleRequirement[];
  actionKey: string;
  actionForm: Record<string, unknown>;
  context?: Record<string, unknown>;
  dueAt?: string;
  tokenTtlHours?: number;
}

export interface CreateHumanTaskResult {
  taskId: string;
  status: "OPEN" | "COMPLETED" | "CANCELED" | "EXPIRED";
}

export interface WorkflowHumanActionInput {
  operationId?: string;
  tokenId?: string;
  taskId: string;
  actionKey: string;
  decision: string;
  comment?: string;
  payload?: Record<string, unknown>;
  submittedAt: string;
  submittedBy?: string;
  channel: "AUTHENTICATED" | "TOKEN";
}

export interface CloseHumanTaskInput {
  taskId: string;
  result: Record<string, unknown>;
}

export interface HumanTaskActivities {
  createHumanTask(input: CreateHumanTaskInput): Promise<CreateHumanTaskResult>;
  closeHumanTask(input: CloseHumanTaskInput): Promise<void>;
}

/**
 * ApplicationFailure types raised by integration Activities when a binding or
 * connection cannot serve the requirement. They are non-retryable: retrying
 * cannot fix configuration, an admin must. Compare by string in Workflow code.
 */
export const INTEGRATION_FAILURE_TYPES = {
  MISSING: "INTEGRATION_MISSING",
  DISABLED: "INTEGRATION_DISABLED",
  REQUIREMENT_MISSING: "INTEGRATION_REQUIREMENT_MISSING",
  CONNECTION_NOT_FOUND: "INTEGRATION_CONNECTION_NOT_FOUND",
  CONNECTION_UNAVAILABLE: "INTEGRATION_CONNECTION_UNAVAILABLE",
  PROVIDER_MISMATCH: "INTEGRATION_PROVIDER_MISMATCH",
  PROVIDER_UNREGISTERED: "INTEGRATION_PROVIDER_UNREGISTERED",
  CAPABILITY_MISSING: "INTEGRATION_CAPABILITY_MISSING",
  CONFIG_INVALID: "INTEGRATION_CONFIG_INVALID",
  RESOLUTION_FAILED: "INTEGRATION_RESOLUTION_FAILED",
} as const;

export type IntegrationFailureType = (typeof INTEGRATION_FAILURE_TYPES)[keyof typeof INTEGRATION_FAILURE_TYPES];

export function isIntegrationConfigurationFailure(type: string | undefined | null): type is IntegrationFailureType {
  return !!type && (Object.values(INTEGRATION_FAILURE_TYPES) as string[]).includes(type);
}

export interface RunSyntheticIntegrationInput {
  orgId: string;
  workflowDefinitionKey: string;
  /** Checked against every requirement declared in workflow-registry.ts. */
  requirementKey: IntegrationRequirementKey;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface RunSyntheticIntegrationResult {
  providerKey: string;
  connectionId: string;
  endpointLabel?: unknown;
  echoed: Record<string, unknown>;
  replayed: boolean;
}

export interface IntegrationActivities {
  runSyntheticIntegration(input: RunSyntheticIntegrationInput): Promise<RunSyntheticIntegrationResult>;
}

export interface RunShowcaseSyntheticStepInput {
  orgId: string;
  workflowDefinitionKey: string;
  /** Checked against every requirement declared in workflow-registry.ts. */
  requirementKey: IntegrationRequirementKey;
  stepKey: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface RunShowcaseSyntheticStepResult {
  stepKey: string;
  providerKey: string;
  connectionId: string;
  endpointLabel?: unknown;
  echoed: Record<string, unknown>;
  replayed: boolean;
}

export interface ShowcaseActivities {
  runShowcaseSyntheticStep(input: RunShowcaseSyntheticStepInput): Promise<RunShowcaseSyntheticStepResult>;
}

export interface ProjectionActivities {
  ensureWorkflowExecutionProjection(
    input: EnsureWorkflowExecutionProjectionInput
  ): Promise<EnsureWorkflowExecutionProjectionResult>;
}
