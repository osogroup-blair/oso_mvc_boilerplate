import { expect, it, vi } from "vitest";
import { IntegrationConnectionResolverService } from "../../src/services/integration-connection-resolver.service.js";
import { CredentialEncryptionService } from "../../src/services/credential-encryption.service.js";

it("shares safe org/capability checks for direct and already-loaded binding connections", async () => {
  const encryption = new CredentialEncryptionService("synthetic-key-material-00000000000000000000", "unit");
  const row = { id: "connection", orgId: "org", name: "Synthetic", providerKey: "synthetic.echo", status: "ACTIVE", deletedAt: null, disabledAt: null,
    config: {}, ...encryption.encrypt({ apiToken: "private-synthetic-token" }) };
  const model = { findSecretByIdInOrg: vi.fn().mockResolvedValue(row) };
  const resolver = new IntegrationConnectionResolverService(model as never, encryption);
  const result = await resolver.resolve("connection", { orgId: "org", capabilityKey: "echo" });
  expect(model.findSecretByIdInOrg).toHaveBeenCalledWith("connection", "org");
  expect(JSON.stringify(result.connection)).not.toContain("private-synthetic-token");
  const decrypt = vi.spyOn(encryption, "decrypt"); decrypt.mockClear();
  for (const invalid of [{ ...row, orgId: "other" }, { ...row, deletedAt: new Date() }, { ...row, disabledAt: new Date() }]) {
    expect(() => resolver.fromConnection(invalid as never, { orgId: "org" })).toThrow();
  }
  expect(() => resolver.fromConnection(row as never, { orgId: "org", capabilityKey: "payment" })).toThrow("capability");
  expect(decrypt).not.toHaveBeenCalled();
});
