import { IntegrationConnectionStatus } from "@prisma/client";
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
import { getIntegrationProvider } from "../integrations/provider-registry.js";

export interface ResolveIntegrationInput {
  orgId: string;
  workflowDefinitionKey: string;
  requirementKey: string;
}

export class IntegrationResolverService extends BaseService {
  constructor(
    private readonly bindings: WorkflowIntegrationBindingModel = workflowIntegrationBindingModel,
    private readonly encryption: CredentialEncryptionService = credentialEncryptionService
  ) {
    super("IntegrationResolverService");
  }

  async resolve(input: ResolveIntegrationInput) {
    const binding = await this.bindings.findForRequirement(
      input.orgId,
      input.workflowDefinitionKey,
      input.requirementKey
    );
    if (!binding) throw AppError.notFound("Workflow integration binding");
    if (!binding.isEnabled) throw AppError.forbidden("Workflow integration binding is disabled");
    const requirement = binding.workflowDefinition.integrationRequirements[0];
    if (!requirement) throw AppError.notFound("Workflow integration requirement");
    if (binding.connection.providerKey !== requirement.providerKey) {
      throw AppError.badRequest("Workflow integration binding provider mismatch");
    }
    if (binding.connection.status !== IntegrationConnectionStatus.ACTIVE) {
      throw AppError.conflict("Workflow integration connection is not active");
    }

    const provider = getIntegrationProvider(binding.connection.providerKey);
    if (!provider) throw AppError.badRequest(`Unknown integration provider: ${binding.connection.providerKey}`);
    const credentials = provider.validateCredentials(this.encryption.decrypt(binding.connection));
    const config = provider.validateConfig(binding.connection.config);
    const adapter = provider.createAdapter({
      credentials,
      config,
      connectionId: binding.connection.id,
    });

    return {
      provider,
      adapter,
      connection: {
        id: binding.connection.id,
        name: binding.connection.name,
        providerKey: binding.connection.providerKey,
      },
      requirement: {
        key: requirement.key,
        capabilityKey: requirement.capabilityKey,
      },
    };
  }
}

export const integrationResolverService = new IntegrationResolverService();
