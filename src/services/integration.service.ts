import { ZodError } from "zod";
import {
  IntegrationConnectionStatus,
  IntegrationTestStatus,
  type Prisma,
} from "@prisma/client";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import {
  IntegrationConnectionModel,
  integrationConnectionModel,
} from "../models/integrationConnection.model.js";
import {
  WorkflowIntegrationBindingModel,
  workflowIntegrationBindingModel,
} from "../models/workflowIntegrationBinding.model.js";
import {
  WorkflowDefinitionModel,
  workflowDefinitionModel,
} from "../models/workflowDefinition.model.js";
import {
  OrganizationContextService,
  organizationContextService,
} from "./organizationContext.service.js";
import { permissionsService, PermissionsService } from "./permissions.service.js";
import { auditService, AuditService } from "./audit.service.js";
import {
  CredentialEncryptionService,
  credentialEncryptionService,
} from "./credential-encryption.service.js";
import {
  getIntegrationProvider,
  listIntegrationProviders,
  type IntegrationProviderRegistration,
  type ProviderRuntime,
} from "../integrations/index.js";
import {
  evaluateBindingAvailability,
  type IntegrationAvailabilityStatus,
} from "../integrations/availability.js";
import {
  IntegrationTimeoutError,
  runWithTimeout,
  scrubIntegrationMessage,
} from "../integrations/safety.js";
import { settingService } from "./setting.service.js";
import { providerRuntimeFromConfig } from "./integration-runtime.js";
import type { ListParams } from "../lib/query.js";

const DEFAULT_TEST_TIMEOUT_SECONDS = 10;
const MIN_TEST_TIMEOUT_SECONDS = 1;
const MAX_TEST_TIMEOUT_SECONDS = 60;

export interface IntegrationActor {
  userId: string;
  roleId: string;
}

export interface CreateConnectionInput {
  orgId?: string;
  providerKey: string;
  name: string;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface BindRequirementInput {
  orgId?: string;
  workflowDefinitionId: string;
  requirementKey: string;
  connectionId: string;
  isEnabled: boolean;
}

export interface RequirementStatus {
  requirement: {
    key: string;
    providerKey: string;
    capabilityKey: string | null;
    label: string;
    description: string | null;
    isRequired: boolean;
  };
  binding: Awaited<ReturnType<WorkflowIntegrationBindingModel["listForWorkflow"]>>[number] | null;
  status: IntegrationAvailabilityStatus;
  reason: string;
  available: boolean;
}

export class IntegrationService extends BaseService {
  constructor(
    private readonly connections: IntegrationConnectionModel = integrationConnectionModel,
    private readonly bindings: WorkflowIntegrationBindingModel = workflowIntegrationBindingModel,
    private readonly workflows: WorkflowDefinitionModel = workflowDefinitionModel,
    private readonly orgContext: OrganizationContextService = organizationContextService,
    private readonly permissions: PermissionsService = permissionsService,
    private readonly audit: AuditService = auditService,
    private readonly encryption: CredentialEncryptionService = credentialEncryptionService,
    private readonly settings: Pick<typeof settingService, "get"> = settingService,
    private readonly runtime: ProviderRuntime = providerRuntimeFromConfig()
  ) {
    super("IntegrationService");
  }

  providers() {
    return listIntegrationProviders();
  }

  async listConnections(actor: IntegrationActor, orgId: string | undefined, params: ListParams) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const [connections, total] = await Promise.all([
      this.connections.listForOrg(context.activeOrg.id, params),
      this.connections.countForOrg(context.activeOrg.id, params.search),
    ]);
    return { ...context, connections, total, providers: this.providers() };
  }

  async getConnection(actor: IntegrationActor, id: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const connection = await this.connections.findSafeByIdInOrg(id, context.activeOrg.id);
    if (!connection) throw AppError.notFound("Integration connection");
    return { ...context, connection, provider: this.requireProvider(connection.providerKey) };
  }

  async getNewConnectionPage(actor: IntegrationActor, orgId?: string, providerKey?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const selectedProvider = providerKey ? this.requireProvider(providerKey) : this.providers()[0];
    return { ...context, providers: this.providers(), selectedProvider };
  }

  async createConnection(actor: IntegrationActor, input: CreateConnectionInput) {
    const context = await this.requireActiveOrg(actor.userId, input.orgId);
    await this.assertCanAdmin(actor.roleId);
    const provider = this.requireProvider(input.providerKey);
    const config = provider.validateConfig(input.config);
    const credentials = provider.validateCredentials(input.credentials);
    const encrypted = this.encryption.encrypt(credentials);

    const created = await this.createConnectionRecord({
      orgId: context.activeOrg.id,
      providerKey: provider.key,
      name: input.name.trim(),
      status: IntegrationConnectionStatus.ACTIVE,
      config: config as Prisma.InputJsonObject,
      ...encrypted,
    });

    await this.audit.record({
      actorId: actor.userId,
      action: "integrationConnection.create",
      entityType: "IntegrationConnection",
      entityId: created.id,
      changes: {
        after: {
          orgId: created.orgId,
          providerKey: created.providerKey,
          name: created.name,
          config: provider.redactConfig(config),
          ...this.encryption.redacted(),
        },
      },
    });

    return this.getConnection(actor, created.id, context.activeOrg.id);
  }

  async rotateCredentials(
    actor: IntegrationActor,
    id: string,
    orgId: string | undefined,
    credentialsInput: Record<string, unknown>
  ) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const before = await this.requireSecretConnection(id, context.activeOrg.id);
    const provider = this.requireProvider(before.providerKey);
    const credentials = provider.validateCredentials(credentialsInput);
    const encrypted = this.encryption.encrypt(credentials);

    const updated = await this.connections.update(id, {
      ...encrypted,
      // Rotation must never re-enable a connection an admin disabled.
      status: this.isDisabled(before) ? IntegrationConnectionStatus.DISABLED : IntegrationConnectionStatus.ACTIVE,
      lastTestStatus: IntegrationTestStatus.NOT_TESTED,
      lastTestMessage: "Credentials rotated; run a connection test.",
    }, actor.userId);

    await this.audit.record({
      actorId: actor.userId,
      action: "integrationConnection.credentials.rotate",
      entityType: "IntegrationConnection",
      entityId: id,
      changes: {
        before: { credentialFingerprint: before.credentialFingerprint },
        after: { credentialFingerprint: updated.credentialFingerprint, ...this.encryption.redacted() },
      },
    });

    return this.getConnection(actor, id, context.activeOrg.id);
  }

  async disableConnection(actor: IntegrationActor, id: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const before = await this.requireSecretConnection(id, context.activeOrg.id);
    const updated = await this.connections.update(id, {
      status: IntegrationConnectionStatus.DISABLED,
      disabledAt: new Date(),
    }, actor.userId);

    await this.audit.record({
      actorId: actor.userId,
      action: "integrationConnection.disable",
      entityType: "IntegrationConnection",
      entityId: id,
      changes: { before: { status: before.status }, after: { status: updated.status } },
    });

    return this.getConnection(actor, id, context.activeOrg.id);
  }

  async testConnection(actor: IntegrationActor, id: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const connection = await this.requireSecretConnection(id, context.activeOrg.id);
    const provider = this.requireProvider(connection.providerKey);
    const disabled = this.isDisabled(connection);
    const result = await this.runProviderTest(provider, connection, await this.testTimeoutMs());
    const lastTestStatus = result.ok ? IntegrationTestStatus.SUCCEEDED : IntegrationTestStatus.FAILED;

    const written = await this.connections.updateTestResult(id, connection.credentialFingerprint, {
      // A disabled connection may be tested, but only an explicit enable action may change its status.
      status: disabled
        ? undefined
        : result.ok ? IntegrationConnectionStatus.ACTIVE : IntegrationConnectionStatus.CONFIG_ERROR,
      lastTestStatus,
      lastTestMessage: result.message,
    }, actor.userId);
    const stale = written === 0;

    await this.audit.record({
      actorId: actor.userId,
      action: "integrationConnection.test",
      entityType: "IntegrationConnection",
      entityId: id,
      changes: {
        after: {
          providerKey: connection.providerKey,
          lastTestStatus,
          lastTestMessage: result.message,
          ...(disabled ? { statusPreserved: IntegrationConnectionStatus.DISABLED } : {}),
          ...(stale ? { stale: true } : {}),
        },
      },
    });

    if (stale) {
      return { ok: result.ok, stale, message: "Credentials changed while the test was running; result discarded. Run the test again." };
    }
    return { ok: result.ok, stale, message: result.message };
  }

  async getWorkflowBindingPage(actor: IntegrationActor, workflowDefinitionId: string, orgId?: string) {
    const context = await this.requireActiveOrg(actor.userId, orgId);
    await this.assertCanAdmin(actor.roleId);
    const definition = await this.workflows.findById(workflowDefinitionId);
    if (!definition) throw AppError.notFound("Workflow definition");
    const connections = await this.connections.listAllForOrg(context.activeOrg.id);
    const requirementStatuses = await this.getRequirementStatuses(context.activeOrg.id, definition);

    return {
      ...context,
      definition,
      connections,
      providers: this.providers(),
      requirementStatuses,
      allRequiredAvailable: requirementStatuses.every((item) => !item.requirement.isRequired || item.available),
    };
  }

  async bindRequirement(actor: IntegrationActor, input: BindRequirementInput) {
    const context = await this.requireActiveOrg(actor.userId, input.orgId);
    await this.assertCanAdmin(actor.roleId);
    const definition = await this.workflows.findById(input.workflowDefinitionId);
    if (!definition) throw AppError.notFound("Workflow definition");
    const requirement = definition.integrationRequirements.find((item) => item.key === input.requirementKey);
    if (!requirement) throw AppError.notFound("Workflow integration requirement");
    const connection = await this.connections.findSafeByIdInOrg(input.connectionId, context.activeOrg.id);
    if (!connection) throw AppError.notFound("Integration connection");
    if (connection.providerKey !== requirement.providerKey) {
      throw AppError.badRequest("Selected connection provider does not match the workflow requirement");
    }

    const binding = await this.bindings.upsert({
      orgId: context.activeOrg.id,
      workflowDefinitionId: definition.id,
      requirementKey: requirement.key,
      connectionId: connection.id,
      isEnabled: input.isEnabled,
    }, actor.userId);

    await this.audit.record({
      actorId: actor.userId,
      action: "workflowIntegrationBinding.upsert",
      entityType: "WorkflowIntegrationBinding",
      entityId: binding.id,
      changes: {
        after: {
          orgId: context.activeOrg.id,
          workflowDefinitionId: definition.id,
          requirementKey: requirement.key,
          connectionId: connection.id,
          isEnabled: input.isEnabled,
        },
      },
    });

    return binding;
  }

  async getRequirementStatuses(
    orgId: string,
    definition: {
      id: string;
      integrationRequirements?: Array<{
        key: string;
        providerKey: string;
        capabilityKey: string | null;
        label: string;
        description: string | null;
        isRequired: boolean;
      }>;
    }
  ): Promise<RequirementStatus[]> {
    const requirements = definition.integrationRequirements ?? [];
    if (!requirements.length) return [];
    const bindings = await this.bindings.listForWorkflow(orgId, definition.id);
    const byRequirement = new Map(bindings.map((binding) => [binding.requirementKey, binding]));

    return requirements.map((requirement) => {
      const binding = byRequirement.get(requirement.key) ?? null;
      const { status, reason } = evaluateBindingAvailability(orgId, binding, requirement);
      return {
        requirement,
        binding,
        status,
        reason,
        available: status === "AVAILABLE",
      };
    });
  }

  assertRequiredBindingsAvailable(statuses: RequirementStatus[]) {
    const missing = statuses.filter((item) => item.requirement.isRequired && !item.available);
    if (missing.length) {
      throw AppError.conflict(
        `Missing or unavailable required workflow integrations: ${missing.map((item) => item.requirement.label).join(", ")}`,
      );
    }
  }

  /**
   * Runs provider test code defensively: validated inputs, a hard timeout, and a
   * message scrubbed of credential values. Provider failures become a FAILED
   * result instead of a 500, so the outcome is always recorded.
   */
  private async runProviderTest(
    provider: IntegrationProviderRegistration,
    connection: Awaited<ReturnType<IntegrationService["requireSecretConnection"]>>,
    timeoutMs: number
  ): Promise<{ ok: boolean; message: string }> {
    let credentials: Record<string, unknown> = {};
    try {
      credentials = provider.validateCredentials(this.encryption.decrypt(connection));
      const config = provider.validateConfig(connection.config);
      const result = await runWithTimeout(
        (signal) => provider.testConnection({ credentials, config, signal, runtime: { ...this.runtime, log: this.log } }),
        timeoutMs
      );
      return {
        ok: result.ok === true,
        message: scrubIntegrationMessage(result.message, credentials, provider.redactMessage?.bind(provider)),
      };
    } catch (err) {
      if (err instanceof IntegrationTimeoutError) {
        return { ok: false, message: `INTEGRATION_TEST_TIMEOUT: ${err.message}` };
      }
      if (err instanceof ZodError) {
        return { ok: false, message: "INTEGRATION_CONFIG_INVALID: stored configuration or credentials failed provider validation" };
      }
      if (err instanceof AppError) {
        return { ok: false, message: `INTEGRATION_${err.code}: ${scrubIntegrationMessage(err.message, credentials)}` };
      }
      // Provider error text is untrusted and may echo secrets; log only its type.
      this.log.warn({ providerKey: provider.key, errorName: (err as Error)?.name }, "Integration connection test threw");
      return { ok: false, message: "INTEGRATION_TEST_ERROR: provider test failed unexpectedly" };
    }
  }

  private async testTimeoutMs() {
    const raw = Number.parseInt((await this.settings.get("INTEGRATION_TEST_TIMEOUT_SECONDS", String(DEFAULT_TEST_TIMEOUT_SECONDS))) ?? "", 10);
    const seconds = Number.isFinite(raw) ? Math.min(MAX_TEST_TIMEOUT_SECONDS, Math.max(MIN_TEST_TIMEOUT_SECONDS, raw)) : DEFAULT_TEST_TIMEOUT_SECONDS;
    return seconds * 1000;
  }

  private isDisabled(connection: { status: IntegrationConnectionStatus; disabledAt: Date | null }) {
    return connection.status === IntegrationConnectionStatus.DISABLED || connection.disabledAt !== null;
  }

  private requireProvider(providerKey: string): IntegrationProviderRegistration {
    const provider = getIntegrationProvider(providerKey);
    if (!provider) throw AppError.badRequest(`Unknown integration provider: ${providerKey}`);
    return provider;
  }

  private async requireSecretConnection(id: string, orgId: string) {
    const connection = await this.connections.findSecretByIdInOrg(id, orgId);
    if (!connection) throw AppError.notFound("Integration connection");
    return connection;
  }

  private async requireActiveOrg(userId: string, orgId?: string) {
    const context = await this.orgContext.resolveForUser(userId, orgId);
    if (!context.activeOrg) throw AppError.badRequest("Select an organization before managing integrations");
    return { ...context, activeOrg: context.activeOrg };
  }

  private async assertCanAdmin(roleId: string) {
    const allowed = await this.permissions.can(roleId, "integration", "admin");
    if (!allowed) throw AppError.forbidden("Missing permission: integration:admin");
  }

  private async createConnectionRecord(
    data: Parameters<IntegrationConnectionModel["create"]>[0]
  ) {
    try {
      return await this.connections.create(data);
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw AppError.conflict("Integration connection name already exists for this organization");
      }
      throw err;
    }
  }

  private isUniqueConstraintError(err: unknown) {
    return (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === "P2002"
    );
  }
}

export const integrationService = new IntegrationService();
