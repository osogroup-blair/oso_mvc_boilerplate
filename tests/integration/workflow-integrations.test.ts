import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { IntegrationService } from "../../src/services/integration.service.js";
import { IntegrationResolverService } from "../../src/services/integration-resolver.service.js";
import { credentialEncryptionService } from "../../src/services/credential-encryption.service.js";
import { syntheticEchoProvider } from "../../src/integrations/index.js";
import { IntegrationUnavailableError } from "../../src/integrations/availability.js";

// Owned-SQL proof for integrations hardening Phase 1 (INT-01..INT-03). Org
// membership and permission checks are stubbed; models, encryption, audit and
// the compare-and-swap run against the real owned PostgreSQL database.
const SECRET = `owned-secret-${randomUUID()}`;
let orgId: string;
let userId: string;
let definitionId: string;
const definitionKey = `platform.integrations-${randomUUID()}`;
const actor = () => ({ userId, roleId: "stubbed-role" });
const service = new IntegrationService(
  undefined,
  undefined,
  undefined,
  { resolveForUser: async () => ({ activeOrg: { id: orgId, name: "Owned", slug: "owned" }, memberships: [], needsSelection: false }) } as never,
  { can: async () => true } as never,
  undefined,
  undefined,
  { get: async () => "10" }
);
const resolver = new IntegrationResolverService();

beforeAll(async () => {
  const role = await prisma.role.create({ data: { name: `integrations-${randomUUID()}`, permissions: [] } });
  const user = await prisma.user.create({ data: { name: "Synthetic integrations", email: `${randomUUID()}@example.invalid`, passwordHash: "not-a-real-login", roleId: role.id } });
  userId = user.id;
  orgId = (await prisma.organization.create({ data: { name: "Owned integrations", slug: randomUUID() } })).id;
  const definition = await prisma.workflowDefinition.create({
    data: { key: definitionKey, slug: definitionKey.replace(".", "-"), name: "Owned integrations", workflowType: "platformTestWorkflow", defaultTaskQueue: "owned", contractVersion: 1 },
  });
  definitionId = definition.id;
  await prisma.workflowIntegrationRequirement.create({
    data: { workflowDefinitionId: definitionId, key: "syntheticEcho", providerKey: "synthetic.echo", capabilityKey: "echo", label: "Synthetic Echo" },
  });
});
afterAll(async () => { await prisma.$disconnect(); });

async function createConnection(name: string, endpointLabel = "Owned endpoint") {
  const page = await service.createConnection(actor(), {
    orgId, providerKey: "synthetic.echo", name, config: { endpointLabel }, credentials: { apiToken: SECRET },
  });
  return page.connection.id;
}

async function gateAndResolver() {
  const definition = await prisma.workflowDefinition.findUniqueOrThrow({
    where: { id: definitionId }, include: { integrationRequirements: { where: { deletedAt: null } } },
  });
  const [gate] = await service.getRequirementStatuses(orgId, definition);
  const resolved = await resolver.resolve({ orgId, workflowDefinitionKey: definitionKey, requirementKey: "syntheticEcho", providerKey: "synthetic.echo" })
    .then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
  return { gate, resolved };
}

it("keeps start gating and Activity resolution in agreement on real rows", async () => {
  const connectionId = await createConnection(`parity-${randomUUID()}`);
  await service.bindRequirement(actor(), { orgId, workflowDefinitionId: definitionId, requirementKey: "syntheticEcho", connectionId, isEnabled: true });

  const states: Array<[string, () => Promise<unknown>, string]> = [
    ["healthy", async () => undefined, "AVAILABLE"],
    // Status left ACTIVE but disabledAt set: the pre-Phase-1 gate reported AVAILABLE here.
    ["disabledAt with stale ACTIVE status", () => prisma.integrationConnection.update({ where: { id: connectionId }, data: { disabledAt: new Date() } }), "CONNECTION_UNAVAILABLE"],
    ["binding disabled", () => prisma.$transaction([
      prisma.integrationConnection.update({ where: { id: connectionId }, data: { disabledAt: null } }),
      prisma.workflowIntegrationBinding.updateMany({ where: { orgId, workflowDefinitionId: definitionId }, data: { isEnabled: false } }),
    ]), "DISABLED"],
    ["connection soft-deleted", () => prisma.$transaction([
      prisma.workflowIntegrationBinding.updateMany({ where: { orgId, workflowDefinitionId: definitionId }, data: { isEnabled: true } }),
      prisma.integrationConnection.update({ where: { id: connectionId }, data: { deletedAt: new Date() } }),
    ]), "CONNECTION_NOT_FOUND"],
  ];
  for (const [label, mutate, expected] of states) {
    await mutate();
    const { gate, resolved } = await gateAndResolver();
    expect(gate.status, label).toBe(expected);
    expect(resolved.ok, label).toBe(expected === "AVAILABLE");
    if (!resolved.ok) {
      expect(resolved.error, label).toBeInstanceOf(IntegrationUnavailableError);
      expect((resolved.error as IntegrationUnavailableError).availabilityStatus, label).toBe(expected);
    }
  }
});

it("never re-enables a disabled connection through test or rotation", async () => {
  const connectionId = await createConnection(`disabled-${randomUUID()}`);
  await service.disableConnection(actor(), connectionId, orgId);

  const result = await service.testConnection(actor(), connectionId, orgId);
  expect(result).toMatchObject({ ok: true, stale: false });
  let row = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
  expect(row.status).toBe("DISABLED");
  expect(row.disabledAt).not.toBeNull();
  expect(row.lastTestStatus).toBe("SUCCEEDED");

  await service.rotateCredentials(actor(), connectionId, orgId, { apiToken: `${SECRET}-rotated` });
  row = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
  expect(row.status).toBe("DISABLED");
  expect(row.disabledAt).not.toBeNull();
});

it("discards a test result in SQL when credentials rotate while the test is running", async () => {
  const connectionId = await createConnection(`cas-${randomUUID()}`);
  let release!: () => void;
  let entered!: () => void;
  const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const spy = vi.spyOn(syntheticEchoProvider, "testConnection").mockImplementation(async () => {
    entered();
    await gate;
    return { ok: false, message: "result computed with pre-rotation credentials" };
  });
  try {
    const pending = service.testConnection(actor(), connectionId, orgId);
    await providerEntered;
    await service.rotateCredentials(actor(), connectionId, orgId, { apiToken: `${SECRET}-next` });
    const rotated = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
    release();
    const result = await pending;

    expect(result.stale).toBe(true);
    const row = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
    expect(row.credentialFingerprint).toBe(rotated.credentialFingerprint);
    expect(row.lastTestStatus).toBe("NOT_TESTED");
    expect(row.lastTestMessage).toBe("Credentials rotated; run a connection test.");
    expect(row.status).toBe("ACTIVE");
  } finally {
    spy.mockRestore();
  }
});

it("stores and audits only scrubbed connection-test messages", async () => {
  const connectionId = await createConnection(`scrub-${randomUUID()}`, `label ${SECRET}`);
  const result = await service.testConnection(actor(), connectionId, orgId);

  expect(result.message).toContain("[redacted]");
  const row = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
  expect(row.lastTestMessage).not.toContain(SECRET);
  expect(row.credentialCiphertext).not.toContain(SECRET);
  expect(credentialEncryptionService.decrypt(row)).toEqual({ apiToken: SECRET });
  // The create audit legitimately records the (non-secret) config label; the test audit must not echo it back.
  const audits = await prisma.auditLog.findMany({ where: { entityId: connectionId, action: "integrationConnection.test" } });
  expect(audits).toHaveLength(1);
  expect(JSON.stringify(audits)).not.toContain(SECRET);
});
