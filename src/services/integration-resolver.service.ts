import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import {
  WorkflowIntegrationBindingModel,
  workflowIntegrationBindingModel,
} from "../models/workflowIntegrationBinding.model.js";
import {
  CredentialEncryptionService,
  credentialEncryptionService,
} from "./credential-encryption.service.js";
import { IntegrationConnectionResolverService } from "./integration-connection-resolver.service.js";
import {
  assertAvailable,
  evaluateBindingAvailability,
  IntegrationUnavailableError,
} from "../integrations/availability.js";
import type { AdapterFor, IntegrationProviderKey, IntegrationProviderRegistration } from "../integrations/index.js";

export interface ResolveIntegrationInput<K extends IntegrationProviderKey = IntegrationProviderKey> {
  orgId: string;
  workflowDefinitionKey: string;
  requirementKey: string;
  /** The provider the calling Activity is written against; types the returned adapter. */
  providerKey: K;
}

/** What an Activity receives: a provider-typed adapter plus safe connection metadata (never credentials). */
export interface ResolvedIntegration<K extends IntegrationProviderKey> {
  adapter: AdapterFor<K>;
  provider: IntegrationProviderRegistration;
  connection: { id: string; name: string; providerKey: string };
  requirement: { key: string; capabilityKey: string | null };
}

export class IntegrationResolverService extends BaseService {
  constructor(
    private readonly bindings: WorkflowIntegrationBindingModel = workflowIntegrationBindingModel,
    encryption: CredentialEncryptionService = credentialEncryptionService,
    private readonly connections = new IntegrationConnectionResolverService(undefined, encryption)
  ) {
    super("IntegrationResolverService");
  }

  async resolve<K extends IntegrationProviderKey>(input: ResolveIntegrationInput<K>): Promise<ResolvedIntegration<K>> {
    const binding = await this.bindings.findForRequirement(
      input.orgId,
      input.workflowDefinitionKey,
      input.requirementKey
    );
    const requirement = binding?.workflowDefinition.integrationRequirements[0];
    if (binding && !requirement) {
      throw new IntegrationUnavailableError("REQUIREMENT_MISSING", "Workflow integration requirement not found");
    }
    // Same evaluator as workflow start gating, so the two can never disagree.
    assertAvailable(evaluateBindingAvailability(input.orgId, binding, requirement ?? {}));
    if (!binding || !requirement) throw AppError.notFound("Workflow integration binding"); // unreachable once AVAILABLE
    // Configuration is fine but the Activity was written for a different provider
    // than the registry declares: a code defect, reported as a mismatch.
    if (requirement.providerKey !== input.providerKey) {
      throw new IntegrationUnavailableError(
        "PROVIDER_MISMATCH",
        `Activity expects provider ${input.providerKey} but requirement ${requirement.key} declares ${requirement.providerKey}`
      );
    }
    const resolved = this.connections.fromConnection(binding.connection, { orgId: input.orgId, providerKey: requirement.providerKey ?? undefined, capabilityKey: requirement.capabilityKey ?? undefined });

    return {
      ...resolved,
      // Safe: the connection's provider was checked against input.providerKey above.
      adapter: resolved.adapter as AdapterFor<K>,
      requirement: {
        key: requirement.key,
        capabilityKey: requirement.capabilityKey,
      },
    };
  }
}

export const integrationResolverService = new IntegrationResolverService();
