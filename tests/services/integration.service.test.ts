import { describe, it, expect, vi, beforeEach } from "vitest";
import { IntegrationConnectionStatus, IntegrationTestStatus } from "@prisma/client";
import { IntegrationService } from "../../src/services/integration.service.js";
import { CredentialEncryptionService } from "../../src/services/credential-encryption.service.js";

const makeConnections = () => ({
  listForOrg: vi.fn(),
  countForOrg: vi.fn(),
  listActiveByProvider: vi.fn(),
  listAllForOrg: vi.fn(),
  findSafeByIdInOrg: vi.fn(),
  findSecretByIdInOrg: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  updateTestResult: vi.fn(),
  softDelete: vi.fn(),
});

const makeBindings = () => ({
  listForWorkflow: vi.fn(),
  findByIdInOrg: vi.fn(),
  findForRequirement: vi.fn(),
  upsert: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
});

const makeWorkflows = () => ({
  findById: vi.fn(),
});

const makeOrgContext = () => ({
  resolveForUser: vi.fn(),
});

const makePermissions = () => ({
  can: vi.fn(),
});

const makeAudit = () => ({
  record: vi.fn().mockResolvedValue(undefined),
});

const orgContext = {
  activeOrg: { id: "org-1", name: "Acme", slug: "acme" },
  memberships: [],
  needsSelection: false,
};

describe("IntegrationService", () => {
  let connections: ReturnType<typeof makeConnections>;
  let bindings: ReturnType<typeof makeBindings>;
  let workflows: ReturnType<typeof makeWorkflows>;
  let organizations: ReturnType<typeof makeOrgContext>;
  let permissions: ReturnType<typeof makePermissions>;
  let audit: ReturnType<typeof makeAudit>;
  let service: IntegrationService;

  beforeEach(() => {
    connections = makeConnections();
    bindings = makeBindings();
    workflows = makeWorkflows();
    organizations = makeOrgContext();
    permissions = makePermissions();
    audit = makeAudit();
    service = new IntegrationService(
      connections as never,
      bindings as never,
      workflows as never,
      organizations as never,
      permissions as never,
      audit as never,
      new CredentialEncryptionService("test-key-material-12345678901234567890", "v-test")
    );

    organizations.resolveForUser.mockResolvedValue(orgContext);
    permissions.can.mockResolvedValue(true);
  });

  it("creates encrypted connections and audits without plaintext credentials", async () => {
    connections.create.mockResolvedValue({
      id: "conn-1",
      orgId: "org-1",
      providerKey: "synthetic.echo",
      name: "Synthetic",
      status: IntegrationConnectionStatus.ACTIVE,
      credentialFingerprint: "fingerprint",
    });
    connections.findSafeByIdInOrg.mockResolvedValue({
      id: "conn-1",
      orgId: "org-1",
      providerKey: "synthetic.echo",
      name: "Synthetic",
      status: IntegrationConnectionStatus.ACTIVE,
    });

    await service.createConnection(
      { userId: "user-1", roleId: "role-1" },
      {
        orgId: "org-1",
        providerKey: "synthetic.echo",
        name: "Synthetic",
        config: { endpointLabel: "Local" },
        credentials: { apiToken: "secret-token" },
      }
    );

    expect(connections.create).toHaveBeenCalledWith(expect.objectContaining({
      credentialCiphertext: expect.any(String),
      credentialIv: expect.any(String),
      credentialAuthTag: expect.any(String),
    }));
    expect(JSON.stringify(connections.create.mock.calls[0][0])).not.toContain("secret-token");
    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain("secret-token");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "integrationConnection.create",
    }));
  });

  it("summarizes required binding availability", async () => {
    bindings.listForWorkflow.mockResolvedValue([
      {
        requirementKey: "syntheticEcho",
        isEnabled: true,
        connection: {
          providerKey: "synthetic.echo",
          status: IntegrationConnectionStatus.ACTIVE,
        },
      },
    ]);

    const statuses = await service.getRequirementStatuses("org-1", {
      id: "def-1",
      integrationRequirements: [
        {
          key: "syntheticEcho",
          providerKey: "synthetic.echo",
          capabilityKey: "echo",
          label: "Synthetic",
          description: null,
          isRequired: true,
        },
      ],
    });

    expect(statuses[0]).toMatchObject({ status: "AVAILABLE", available: true });
  });

  it("rejects workflow bindings when provider keys do not match", async () => {
    workflows.findById.mockResolvedValue({
      id: "def-1",
      integrationRequirements: [
        {
          key: "syntheticEcho",
          providerKey: "synthetic.echo",
          capabilityKey: "echo",
          label: "Synthetic",
          description: null,
          isRequired: true,
        },
      ],
    });
    connections.findSafeByIdInOrg.mockResolvedValue({
      id: "conn-1",
      providerKey: "other.provider",
      status: IntegrationConnectionStatus.ACTIVE,
    });

    await expect(
      service.bindRequirement(
        { userId: "user-1", roleId: "role-1" },
        {
          orgId: "org-1",
          workflowDefinitionId: "def-1",
          requirementKey: "syntheticEcho",
          connectionId: "conn-1",
          isEnabled: true,
        }
      )
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(bindings.upsert).not.toHaveBeenCalled();
  });

  it("tests a connection and stores only status metadata", async () => {
    const encryption = new CredentialEncryptionService("test-key-material-12345678901234567890", "v-test");
    connections.findSecretByIdInOrg.mockResolvedValue({
      id: "conn-1",
      orgId: "org-1",
      providerKey: "synthetic.echo",
      name: "Synthetic",
      config: { endpointLabel: "Local" },
      status: IntegrationConnectionStatus.ACTIVE,
      ...encryption.encrypt({ apiToken: "secret-token" }),
    });
    connections.updateTestResult.mockResolvedValue({
      id: "conn-1",
      lastTestStatus: IntegrationTestStatus.SUCCEEDED,
      lastTestMessage: "ok",
    });

    const result = await service.testConnection(
      { userId: "user-1", roleId: "role-1" },
      "conn-1",
      "org-1"
    );

    expect(result.ok).toBe(true);
    expect(connections.updateTestResult).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      lastTestStatus: IntegrationTestStatus.SUCCEEDED,
    }));
    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain("secret-token");
  });
});
