import type { IntegrationConnection } from "@prisma/client";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { integrationConnectionModel, IntegrationConnectionModel } from "../models/integrationConnection.model.js";
import { credentialEncryptionService, CredentialEncryptionService } from "./credential-encryption.service.js";
import { getIntegrationProvider } from "../integrations/index.js";
import { assertAvailable, evaluateConnectionAvailability } from "../integrations/availability.js";

export interface ConnectionRequirement { orgId: string; providerKey?: string; capabilityKey?: string }

/** Binding selection is a caller concern; secret/adapter construction is shared. */
export class IntegrationConnectionResolverService extends BaseService {
  constructor(private readonly model: IntegrationConnectionModel = integrationConnectionModel,
    private readonly encryption: CredentialEncryptionService = credentialEncryptionService) { super("IntegrationConnectionResolverService"); }

  async resolve(connectionId: string, requirement: ConnectionRequirement) {
    const row = await this.model.findSecretByIdInOrg(connectionId, requirement.orgId);
    return this.fromConnection(row, requirement);
  }

  fromConnection(row: IntegrationConnection | null, requirement: ConnectionRequirement) {
    // Availability is evaluated before decryption so rejected rows never expose secrets.
    assertAvailable(evaluateConnectionAvailability(requirement.orgId, row, requirement));
    const provider = row && getIntegrationProvider(row.providerKey);
    if (!row || !provider) throw AppError.notFound("Integration connection"); // unreachable once AVAILABLE
    const credentials = provider.validateCredentials(this.encryption.decrypt(row));
    const config = provider.validateConfig(row.config);
    const adapter = provider.createAdapter({ credentials, config, connectionId: row.id });
    return { provider, adapter, connection: { id: row.id, name: row.name, providerKey: row.providerKey } };
  }
}
export const integrationConnectionResolverService = new IntegrationConnectionResolverService();
