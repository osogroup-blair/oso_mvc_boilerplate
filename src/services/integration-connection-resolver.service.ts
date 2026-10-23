import type { IntegrationConnection } from "@prisma/client";
import { IntegrationConnectionStatus } from "@prisma/client";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { integrationConnectionModel, IntegrationConnectionModel } from "../models/integrationConnection.model.js";
import { credentialEncryptionService, CredentialEncryptionService } from "./credential-encryption.service.js";
import { getIntegrationProvider } from "../integrations/provider-registry.js";

export interface ConnectionRequirement { orgId: string; providerKey?: string; capabilityKey?: string }

/** Binding selection is a caller concern; secret/adapter construction is shared. */
export class IntegrationConnectionResolverService extends BaseService {
  constructor(private readonly model: IntegrationConnectionModel = integrationConnectionModel,
    private readonly encryption: CredentialEncryptionService = credentialEncryptionService) { super("IntegrationConnectionResolverService"); }

  async resolve(connectionId: string, requirement: ConnectionRequirement) {
    const row = await this.model.findSecretByIdInOrg(connectionId, requirement.orgId);
    if (!row) throw AppError.notFound("Integration connection");
    return this.fromConnection(row, requirement);
  }

  fromConnection(row: IntegrationConnection, requirement: ConnectionRequirement) {
    if (row.orgId !== requirement.orgId || row.deletedAt) throw AppError.notFound("Integration connection");
    if (row.status !== IntegrationConnectionStatus.ACTIVE || row.disabledAt) throw AppError.conflict("Integration connection is unavailable");
    if (requirement.providerKey && row.providerKey !== requirement.providerKey) throw AppError.badRequest("Integration provider mismatch");
    const provider = getIntegrationProvider(row.providerKey);
    if (!provider || requirement.capabilityKey && !provider.capabilities.includes(requirement.capabilityKey)) throw AppError.badRequest("Integration capability is unavailable");
    const credentials = provider.validateCredentials(this.encryption.decrypt(row));
    const config = provider.validateConfig(row.config);
    const adapter = provider.createAdapter({ credentials, config, connectionId: row.id });
    return { provider, adapter, connection: { id: row.id, name: row.name, providerKey: row.providerKey } };
  }
}
export const integrationConnectionResolverService = new IntegrationConnectionResolverService();
