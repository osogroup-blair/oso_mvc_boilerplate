export interface PlatformWorkflowContext {
  orgId: string;
  startedById: string;
  workflowDefinitionKey: string;
  scheduleId?: string;
}

export interface EnsureWorkflowExecutionProjectionInput {
  orgId: string;
  workflowDefinitionKey: string;
  startedById: string;
  workflowId: string;
  runId?: string;
  scheduleId?: string;
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

export interface RunSyntheticIntegrationInput {
  orgId: string;
  workflowDefinitionKey: string;
  requirementKey: string;
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
  requirementKey: string;
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
