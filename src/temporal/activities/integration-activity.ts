import { ApplicationFailure } from "@temporalio/activity";
import { ZodError } from "zod";
import { AppError } from "../../lib/AppError.js";
import { IntegrationUnavailableError } from "../../integrations/availability.js";
import {
  integrationResolverService,
  type IntegrationResolverService,
} from "../../services/integration-resolver.service.js";
import {
  activityIdempotencyService,
  type ActivityIdempotencyService,
  type ActivityOperationPolicy,
} from "../../services/activity-idempotency.service.js";
import { INTEGRATION_FAILURE_TYPES } from "../contracts.js";

export interface IntegrationOperationInput {
  orgId: string;
  workflowDefinitionKey: string;
  requirementKey: string;
  /** Idempotency scope; one per provider operation, e.g. "integration.synthetic.echo". */
  scope: string;
  idempotencyKey: string;
  /** Hashed for idempotency; must be the full business request, never credentials. */
  request: unknown;
}

export type ResolvedIntegration = Awaited<ReturnType<IntegrationResolverService["resolve"]>>;

export interface IntegrationOperationDeps {
  resolver: Pick<IntegrationResolverService, "resolve">;
  idempotency: Pick<ActivityIdempotencyService, "run" | "findSucceeded">;
}

/**
 * Maps resolution errors that only an admin can fix to non-retryable Temporal
 * failures. Anything else (database or network trouble while resolving) is
 * returned as null so the caller rethrows it and Temporal retries normally.
 */
export function toIntegrationConfigurationFailure(error: unknown): ApplicationFailure | null {
  if (error instanceof IntegrationUnavailableError) {
    return ApplicationFailure.nonRetryable(error.message, INTEGRATION_FAILURE_TYPES[error.availabilityStatus]);
  }
  if (error instanceof ZodError) {
    return ApplicationFailure.nonRetryable(
      "Integration connection configuration or credentials failed provider validation",
      INTEGRATION_FAILURE_TYPES.CONFIG_INVALID
    );
  }
  if (error instanceof AppError) {
    return ApplicationFailure.nonRetryable(error.message, INTEGRATION_FAILURE_TYPES.RESOLUTION_FAILED);
  }
  return null;
}

/**
 * The one way integration Activities call providers:
 *   1. resolve the bound connection *before* reserving an idempotency row, so
 *      configuration errors never create RUNNING/UNCERTAIN reservations;
 *   2. fail configuration errors fast (non-retryable), replaying a prior
 *      success for the same request if one exists;
 *   3. run the provider call under ActivityIdempotencyService.
 */
export function createIntegrationOperationRunner(
  deps: IntegrationOperationDeps = { resolver: integrationResolverService, idempotency: activityIdempotencyService }
) {
  return async function runIntegrationOperation<T>(
    input: IntegrationOperationInput,
    operation: (resolved: ResolvedIntegration, operationKey: string) => Promise<T>,
    policy: ActivityOperationPolicy<T> = {}
  ): Promise<{ value: T; replayed: boolean }> {
    let resolved: ResolvedIntegration;
    try {
      resolved = await deps.resolver.resolve({
        orgId: input.orgId,
        workflowDefinitionKey: input.workflowDefinitionKey,
        requirementKey: input.requirementKey,
      });
    } catch (error) {
      const failure = toIntegrationConfigurationFailure(error);
      if (!failure) throw error;
      const prior = await deps.idempotency.findSucceeded<T>(input.orgId, input.scope, input.idempotencyKey, input.request);
      if (prior) return { value: prior.value, replayed: true };
      throw failure;
    }

    return deps.idempotency.run(
      input.orgId,
      input.scope,
      input.idempotencyKey,
      input.request,
      (operationKey) => operation(resolved, operationKey),
      policy
    );
  };
}

export const runIntegrationOperation = createIntegrationOperationRunner();
