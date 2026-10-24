import { describe, it, expect, vi } from "vitest";
import { IntegrationConnectionStatus } from "@prisma/client";
import { CredentialEncryptionService } from "../../src/services/credential-encryption.service.js";
import { IntegrationResolverService } from "../../src/services/integration-resolver.service.js";

describe("IntegrationResolverService", () => {
  it("resolves a bound connection and exposes decrypted credentials only to the adapter factory path", async () => {
    const encryption = new CredentialEncryptionService("test-key-material-12345678901234567890", "v-test");
    const bindings = {
      findForRequirement: vi.fn().mockResolvedValue({
        isEnabled: true,
        connection: {
          id: "conn-1",
          orgId: "org-1",
          name: "Synthetic",
          providerKey: "synthetic.echo",
          status: IntegrationConnectionStatus.ACTIVE,
          config: { endpointLabel: "Local" },
          ...encryption.encrypt({ apiToken: "secret-token" }),
        },
        workflowDefinition: {
          integrationRequirements: [
            {
              key: "syntheticEcho",
              providerKey: "synthetic.echo",
              capabilityKey: "echo",
            },
          ],
        },
      }),
    };
    const service = new IntegrationResolverService(bindings as never, encryption);

    const resolved = await service.resolve({
      orgId: "org-1",
      workflowDefinitionKey: "platform.test",
      requirementKey: "syntheticEcho",
      providerKey: "synthetic.echo",
    });
    const echoed = await resolved.adapter.echo({ hello: "world" });

    expect(echoed).toMatchObject({
      connectionId: "conn-1",
      echoed: { hello: "world" },
    });
    expect(JSON.stringify(echoed)).not.toContain("sec");
    expect(JSON.stringify(resolved.connection)).not.toContain("secret-token");
  });

  it("rejects an Activity written for a different provider than the requirement declares", async () => {
    const encryption = new CredentialEncryptionService("test-key-material-12345678901234567890", "v-test");
    const decrypt = vi.spyOn(encryption, "decrypt");
    const service = new IntegrationResolverService({
      findForRequirement: vi.fn().mockResolvedValue({
        isEnabled: true,
        connection: { id: "conn-1", orgId: "org-1", name: "Synthetic", providerKey: "synthetic.echo", status: IntegrationConnectionStatus.ACTIVE, config: {}, ...encryption.encrypt({ apiToken: "secret-token" }) },
        workflowDefinition: { integrationRequirements: [{ key: "syntheticEcho", providerKey: "synthetic.echo", capabilityKey: "echo" }] },
      }),
    } as never, encryption);

    await expect(service.resolve({
      orgId: "org-1",
      workflowDefinitionKey: "platform.test",
      requirementKey: "syntheticEcho",
      providerKey: "webhook.outbound" as never,
    })).rejects.toMatchObject({ availabilityStatus: "PROVIDER_MISMATCH" });
    expect(decrypt).not.toHaveBeenCalled();
  });
});
