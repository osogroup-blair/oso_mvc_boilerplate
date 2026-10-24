import { ApplicationFailure } from "@temporalio/activity";
import { ZodError } from "zod";
import { AppError } from "../../lib/AppError.js";
import { IntegrationUnavailableError } from "../../integrations/availability.js";
import {
  integrationResolverService,
  type IntegrationResolverService,
  type ResolvedIntegration,
} from "../../services/integration-resolver.service.js";
import {
  activityIdempotencyService,
  type ActivityIdempotencyService,
  type ActivityOperationPolicy,
} from "../../services/activity-idempotency.service.js";
import {
  getIntegrationProvider,
  ProviderHttpError,
  type IntegrationProviderKey,
  type IntegrationProviderRegistration,
  type OperationFor,
} from "../../integrations/index.js";
import { INTEGRATION_FAILURE_TYPES } from "../contracts.js";
import type { IntegrationRequirementKey } from "../workflow-registry.js";

export interface IntegrationOperationInput<K extends IntegrationProviderKey> {
  orgId: string;
  workflowDefinitionKey: string;
  requirementKey: IntegrationRequirementKey;
  /** Provider the operation is written against; types the adapter passed to the callback. */
  providerKey: K;
  /** Declared provider operation; its retrySafe flag drives the idempotency policy. */
  operation: OperationFor<K>;
  /** Idempotency scope; one per provider operation, e.g. "integration.synthetic.echo". */
  scope: string;
  idempotencyKey: string;
  /** Hashed for idempotency; must be the full business request, never credentials. */
  request: unknown;
}

export type { ResolvedIntegration } from "../../services/integration-resolver.service.js";

/** Retry safety comes from the provider's declared operation, never from the call site. */
export type IntegrationOperationPolicy<T> = Omit<ActivityOperationPolicy<T>, "retrySafe">;

export interface IntegrationOperationDeps {
  resolver: Pick<IntegrationResolverService, "resolve">;
  idempotency: Pick<ActivityIdempotencyService, "run" | "findSucceeded">;
  providers: (providerKey: string) => IntegrationProviderRegistration | null;
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
  deps: IntegrationOperationDeps = {
    resolver: integrationResolverService,
    idempotency: activityIdempotencyService,
    providers: getIntegrationProvider,
  }
) {
  return async function runIntegrationOperation<K extends IntegrationProviderKey, T>(
    input: IntegrationOperationInput<K>,
    operation: (resolved: ResolvedIntegration<K>, operationKey: string) => Promise<T>,
    policy: IntegrationOperationPolicy<T> = {}
  ): Promise<{ value: T; replayed: boolean }> {
    const declared = deps.providers(input.providerKey)?.operations[input.operation];
    if (!declared) {
      throw ApplicationFailure.nonRetryable(
        `Provider ${input.providerKey} does not declare operation ${input.operation}`,
        INTEGRATION_FAILURE_TYPES.RESOLUTION_FAILED
      );
    }

    let resolved: ResolvedIntegration<K>;
    try {
      resolved = await deps.resolver.resolve({
        orgId: input.orgId,
        workflowDefinitionKey: input.workflowDefinitionKey,
        requirementKey: input.requirementKey,
        providerKey: input.providerKey,
      });
    } catch (error) {
      const failure = toIntegrationConfigurationFailure(error);
      if (!failure) throw error;
      const prior = await deps.idempotency.findSucceeded<T>(input.orgId, input.scope, input.idempotencyKey, input.request);
      if (prior) return { value: prior.value, replayed: true };
      throw failure;
    }

    try {
      return await deps.idempotency.run(
        input.orgId,
        input.scope,
        input.idempotencyKey,
        input.request,
        (operationKey) => operation(resolved, operationKey),
        { ...policy, retrySafe: declared.retrySafe }
      );
    } catch (error) {
      // A definitive provider rejection is recorded FAILED by the idempotency
      // service; stop Temporal from retrying into "operator review required".
      if (policy.classifyError?.(error) === "terminal") {
        const reason = error instanceof ProviderHttpError ? error.message : "provider rejected the request";
        throw ApplicationFailure.nonRetryable(
          `${input.providerKey}.${input.operation}: ${reason}`,
          INTEGRATION_FAILURE_TYPES.PROVIDER_REJECTED
        );
      }
      throw error;
    }
  };
}

export const runIntegrationOperation = createIntegrationOperationRunner();
