import { describe, it, expect, vi, beforeEach } from "vitest";
import { IntegrationConnectionStatus, IntegrationTestStatus } from "@prisma/client";
import { IntegrationService } from "../../src/services/integration.service.js";
import { CredentialEncryptionService } from "../../src/services/credential-encryption.service.js";
import { syntheticEchoProvider } from "../../src/integrations/provider-registry.js";

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

const makeSettings = () => ({
  get: vi.fn().mockResolvedValue("10"),
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
  let settings: ReturnType<typeof makeSettings>;
  let service: IntegrationService;
  const encryption = new CredentialEncryptionService("test-key-material-12345678901234567890", "v-test");

  beforeEach(() => {
    connections = makeConnections();
    bindings = makeBindings();
    workflows = makeWorkflows();
    organizations = makeOrgContext();
    permissions = makePermissions();
    audit = makeAudit();
    settings = makeSettings();
    service = new IntegrationService(
      connections as never,
      bindings as never,
      workflows as never,
      organizations as never,
      permissions as never,
      audit as never,
      encryption,
      settings
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
          orgId: "org-1",
          providerKey: "synthetic.echo",
          status: IntegrationConnectionStatus.ACTIVE,
          disabledAt: null,
          deletedAt: null,
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

  const secretRow = (overrides: Record<string, unknown> = {}) => ({
    id: "conn-1",
    orgId: "org-1",
    providerKey: "synthetic.echo",
    name: "Synthetic",
    config: { endpointLabel: "Local" },
    status: IntegrationConnectionStatus.ACTIVE,
    disabledAt: null,
    deletedAt: null,
    ...encryption.encrypt({ apiToken: "secret-token" }),
    ...overrides,
  });
  const actor = { userId: "user-1", roleId: "role-1" };

  it("tests a connection and stores only status metadata", async () => {
    const row = secretRow();
    connections.findSecretByIdInOrg.mockResolvedValue(row);
    connections.updateTestResult.mockResolvedValue(1);

    const result = await service.testConnection(actor, "conn-1", "org-1");

    expect(result).toMatchObject({ ok: true, stale: false });
    expect(connections.updateTestResult).toHaveBeenCalledWith("conn-1", row.credentialFingerprint, expect.objectContaining({
      status: IntegrationConnectionStatus.ACTIVE,
      lastTestStatus: IntegrationTestStatus.SUCCEEDED,
    }));
    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain("secret-token");
  });

  it("never re-enables a disabled connection when it is tested", async () => {
    connections.findSecretByIdInOrg.mockResolvedValue(secretRow({
      status: IntegrationConnectionStatus.DISABLED,
      disabledAt: new Date(),
    }));
    connections.updateTestResult.mockResolvedValue(1);

    const result = await service.testConnection(actor, "conn-1", "org-1");

    expect(result.ok).toBe(true);
    expect(connections.updateTestResult.mock.calls[0][2]).toMatchObject({
      status: undefined,
      lastTestStatus: IntegrationTestStatus.SUCCEEDED,
    });
    expect(audit.record.mock.calls[0][0].changes.after).toMatchObject({ statusPreserved: IntegrationConnectionStatus.DISABLED });
  });

  it("treats a connection with disabledAt but a stale ACTIVE status as disabled", async () => {
    connections.findSecretByIdInOrg.mockResolvedValue(secretRow({ disabledAt: new Date() }));
    connections.updateTestResult.mockResolvedValue(1);

    await service.testConnection(actor, "conn-1", "org-1");

    expect(connections.updateTestResult.mock.calls[0][2].status).toBeUndefined();
  });

  it("keeps a disabled connection disabled when credentials are rotated", async () => {
    connections.findSecretByIdInOrg.mockResolvedValue(secretRow({
      status: IntegrationConnectionStatus.DISABLED,
      disabledAt: new Date(),
    }));
    connections.update.mockResolvedValue({ credentialFingerprint: "next" });
    connections.findSafeByIdInOrg.mockResolvedValue({ id: "conn-1", providerKey: "synthetic.echo" });

    await service.rotateCredentials(actor, "conn-1", "org-1", { apiToken: "rotated-token" });

    expect(connections.update).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      status: IntegrationConnectionStatus.DISABLED,
    }));
  });

  it("discards a test result when credentials rotated during the test", async () => {
    connections.findSecretByIdInOrg.mockResolvedValue(secretRow());
    connections.updateTestResult.mockResolvedValue(0);

    const result = await service.testConnection(actor, "conn-1", "org-1");

    expect(result).toMatchObject({ stale: true });
    expect(result.message).toContain("result discarded");
    expect(audit.record.mock.calls[0][0].changes.after).toMatchObject({ stale: true });
  });

  it("scrubs credential values that a provider echoes into its test message", async () => {
    connections.findSecretByIdInOrg.mockResolvedValue(secretRow({ config: { endpointLabel: "token=secret-token" } }));
    connections.updateTestResult.mockResolvedValue(1);

    const result = await service.testConnection(actor, "conn-1", "org-1");

    expect(result.message).toContain("[redacted]");
    expect(result.message).not.toContain("secret-token");
    expect(JSON.stringify(connections.updateTestResult.mock.calls[0])).not.toContain("secret-token");
    expect(JSON.stringify(audit.record.mock.calls[0][0])).not.toContain("secret-token");
  });

  it("records a failed test instead of throwing when the provider throws", async () => {
    const spy = vi.spyOn(syntheticEchoProvider, "testConnection").mockRejectedValue(new Error("upstream said secret-token"));
    connections.findSecretByIdInOrg.mockResolvedValue(secretRow());
    connections.updateTestResult.mockResolvedValue(1);

    try {
      const result = await service.testConnection(actor, "conn-1", "org-1");

      expect(result).toMatchObject({ ok: false, message: expect.stringContaining("INTEGRATION_TEST_ERROR") });
      expect(result.message).not.toContain("secret-token");
      expect(connections.updateTestResult.mock.calls[0][2]).toMatchObject({
        status: IntegrationConnectionStatus.CONFIG_ERROR,
        lastTestStatus: IntegrationTestStatus.FAILED,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it("aborts a provider test that exceeds the configured timeout", async () => {
    let aborted = false;
    const spy = vi.spyOn(syntheticEchoProvider, "testConnection").mockImplementation(({ signal }) =>
      new Promise((resolve) => {
        signal?.addEventListener("abort", () => { aborted = true; resolve({ ok: true, message: "too late" }); });
      })
    );
    settings.get.mockResolvedValue("1");
    connections.findSecretByIdInOrg.mockResolvedValue(secretRow());
    connections.updateTestResult.mockResolvedValue(1);

    try {
      const result = await service.testConnection(actor, "conn-1", "org-1");

      expect(result).toMatchObject({ ok: false, message: expect.stringContaining("INTEGRATION_TEST_TIMEOUT") });
      expect(aborted).toBe(true);
      expect(settings.get).toHaveBeenCalledWith("INTEGRATION_TEST_TIMEOUT_SECONDS", "10");
    } finally {
      spy.mockRestore();
    }
  });

  it("validates stored config before calling the provider", async () => {
    const spy = vi.spyOn(syntheticEchoProvider, "testConnection");
    connections.findSecretByIdInOrg.mockResolvedValue(secretRow({ config: { endpointLabel: "x".repeat(500) } }));
    connections.updateTestResult.mockResolvedValue(1);

    try {
      const result = await service.testConnection(actor, "conn-1", "org-1");

      expect(result).toMatchObject({ ok: false, message: expect.stringContaining("INTEGRATION_CONFIG_INVALID") });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
