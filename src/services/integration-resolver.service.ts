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

export interface ResolveIntegrationInput {
  orgId: string;
  workflowDefinitionKey: string;
  requirementKey: string;
}

export class IntegrationResolverService extends BaseService {
  constructor(
    private readonly bindings: WorkflowIntegrationBindingModel = workflowIntegrationBindingModel,
    encryption: CredentialEncryptionService = credentialEncryptionService,
    private readonly connections = new IntegrationConnectionResolverService(undefined, encryption)
  ) {
    super("IntegrationResolverService");
  }

  async resolve(input: ResolveIntegrationInput) {
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
    const resolved = this.connections.fromConnection(binding.connection, { orgId: input.orgId, providerKey: requirement.providerKey ?? undefined, capabilityKey: requirement.capabilityKey ?? undefined });

    return {
      ...resolved,
      requirement: {
        key: requirement.key,
        capabilityKey: requirement.capabilityKey,
      },
    };
  }
}

export const integrationResolverService = new IntegrationResolverService();
