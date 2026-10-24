// Compile-time contract tests (INT-07/INT-08), checked by `npm run typecheck`.
// Each @ts-expect-error must stay an error: if a misspelled key, unknown
// provider, or undeclared operation ever type-checks, tsc fails on the unused
// directive.
import type {
  IntegrationRequirementKey,
  RequirementKeyFor,
  WorkflowTypeRegistration,
} from "../../src/temporal/workflow-registry.js";
import { defineWorkflow } from "../../src/temporal/workflow-registry.js";
import type { AdapterFor, OperationFor } from "../../src/integrations/index.js";
import { runIntegrationOperation } from "../../src/temporal/activities/integration-activity.js";
import type { RunShowcaseSyntheticStepInput, RunSyntheticIntegrationInput } from "../../src/temporal/contracts.js";

// Requirement keys.
export const declaredKey: IntegrationRequirementKey = "syntheticEcho";
export const scopedKey = "syntheticEcho" satisfies RequirementKeyFor<"showcase.dataSynchronization">;
// @ts-expect-error misspelled requirement key
export const misspelledKey: IntegrationRequirementKey = "syntheticEcoh";
// @ts-expect-error platform.heartbeat declares no integration requirements
export const undeclaredForWorkflow = "syntheticEcho" satisfies RequirementKeyFor<"platform.heartbeat">;
// @ts-expect-error unknown workflow key
export type UnknownWorkflow = RequirementKeyFor<"platform.missing">;

export const syntheticInput: RunSyntheticIntegrationInput = {
  orgId: "org",
  workflowDefinitionKey: "platform.test",
  idempotencyKey: "key",
  payload: {},
  // @ts-expect-error Activity contracts reject undeclared requirement keys
  requirementKey: "syntheticEcoh",
};
export const showcaseInput: RunShowcaseSyntheticStepInput = {
  orgId: "org",
  workflowDefinitionKey: "showcase.dataSynchronization",
  idempotencyKey: "key",
  stepKey: "step",
  payload: {},
  requirementKey: "syntheticEcho",
};

// Providers, adapters and operations.
export const declaredOperation: OperationFor<"synthetic.echo"> = "echo";
// @ts-expect-error synthetic.echo declares no "deliver" operation
export const undeclaredOperation: OperationFor<"synthetic.echo"> = "deliver";
// @ts-expect-error unknown provider key
export type UnknownProviderAdapter = AdapterFor<"ghost.provider">;

const operationInput = {
  orgId: "org",
  workflowDefinitionKey: "platform.test",
  requirementKey: "syntheticEcho",
  scope: "integration.synthetic.echo",
  idempotencyKey: "key",
  request: {},
} as const;

export async function typedAdapterCalls() {
  await runIntegrationOperation({ ...operationInput, providerKey: "synthetic.echo", operation: "echo" }, async ({ adapter }) => {
    const echoed = await adapter.echo({ hello: "world" });
    const providerKey: "synthetic.echo" = echoed.providerKey;
    // @ts-expect-error the synthetic.echo adapter has no deliver method
    await adapter.deliver({});
    return providerKey;
  });
  // @ts-expect-error operation must be declared by the provider
  await runIntegrationOperation({ ...operationInput, providerKey: "synthetic.echo", operation: "deliver" }, async () => null);
  // @ts-expect-error provider must be registered
  await runIntegrationOperation({ ...operationInput, providerKey: "ghost.provider", operation: "echo" }, async () => null);
}

// Registry declarations.
declare const registrationBase: Omit<WorkflowTypeRegistration, "key" | "integrationRequirements">;
export const registeredWithProvider = defineWorkflow({
  ...registrationBase,
  key: "types.valid",
  integrationRequirements: [{ key: "echoRequirement", providerKey: "synthetic.echo", capabilityKey: "echo", label: "Echo" }],
});
export const inferredRequirementKey: "echoRequirement" = registeredWithProvider.integrationRequirements[0].key;
export const registeredWithUnknownProvider = defineWorkflow({
  ...registrationBase,
  key: "types.invalid",
  // @ts-expect-error requirement providers must be registered in src/integrations/index.ts
  integrationRequirements: [{ key: "crm", providerKey: "hubspot", label: "CRM" }],
});
