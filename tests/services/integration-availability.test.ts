import { describe, it, expect, vi } from "vitest";
import { IntegrationConnectionStatus } from "@prisma/client";
import { IntegrationService } from "../../src/services/integration.service.js";
import { IntegrationResolverService } from "../../src/services/integration-resolver.service.js";
import { CredentialEncryptionService } from "../../src/services/credential-encryption.service.js";
import {
  evaluateBindingAvailability,
  IntegrationUnavailableError,
} from "../../src/integrations/availability.js";

const encryption = new CredentialEncryptionService("test-key-material-12345678901234567890", "v-test");
const envelope = encryption.encrypt({ apiToken: "secret-token" });
const past = new Date("2026-01-01T00:00:00Z");

interface Scenario {
  label: string;
  binding: null | {
    isEnabled: boolean;
    connection: {
      orgId: string;
      providerKey: string;
      status: IntegrationConnectionStatus;
      disabledAt: Date | null;
      deletedAt: Date | null;
    };
  };
  requirement: { key: string; providerKey: string; capabilityKey: string };
}

function scenarios(): Scenario[] {
  const out: Scenario[] = [];
  for (const isEnabled of [true, false])
    for (const orgId of ["org-1", "org-2"])
      for (const deletedAt of [null, past])
        for (const status of [IntegrationConnectionStatus.ACTIVE, IntegrationConnectionStatus.DISABLED, IntegrationConnectionStatus.CONFIG_ERROR])
          for (const disabledAt of [null, past])
            for (const providerKey of ["synthetic.echo", "ghost.provider"])
              for (const requirementProvider of ["synthetic.echo", "ghost.provider"])
                for (const capabilityKey of ["echo", "payment"]) {
                  out.push({
                    label: JSON.stringify({ isEnabled, orgId, deleted: !!deletedAt, status, disabled: !!disabledAt, providerKey, requirementProvider, capabilityKey }),
                    binding: { isEnabled, connection: { orgId, providerKey, status, disabledAt, deletedAt } },
                    requirement: { key: "syntheticEcho", providerKey: requirementProvider, capabilityKey },
                  });
                }
  out.push({ label: "no binding", binding: null, requirement: { key: "syntheticEcho", providerKey: "synthetic.echo", capabilityKey: "echo" } });
  return out;
}

async function gateStatus(scenario: Scenario) {
  const bindings = {
    listForWorkflow: vi.fn().mockResolvedValue(
      scenario.binding ? [{ requirementKey: scenario.requirement.key, ...scenario.binding, connection: { id: "conn-1", ...scenario.binding.connection } }] : []
    ),
  };
  const service = new IntegrationService(undefined as never, bindings as never);
  const [status] = await service.getRequirementStatuses("org-1", {
    id: "def-1",
    integrationRequirements: [{ ...scenario.requirement, label: "Synthetic", description: null, isRequired: true }],
  });
  return status;
}

async function resolverOutcome(scenario: Scenario, decrypt: ReturnType<typeof vi.spyOn>) {
  const bindings = {
    findForRequirement: vi.fn().mockResolvedValue(
      scenario.binding
        ? {
            isEnabled: scenario.binding.isEnabled,
            connection: { id: "conn-1", name: "Synthetic", config: {}, ...envelope, ...scenario.binding.connection },
            workflowDefinition: { integrationRequirements: [scenario.requirement] },
          }
        : null
    ),
  };
  const resolver = new IntegrationResolverService(bindings as never, encryption);
  decrypt.mockClear();
  try {
    await resolver.resolve({ orgId: "org-1", workflowDefinitionKey: "platform.test", requirementKey: scenario.requirement.key, providerKey: "synthetic.echo" });
    return { ok: true as const, decrypted: decrypt.mock.calls.length > 0 };
  } catch (error) {
    return { ok: false as const, error, decrypted: decrypt.mock.calls.length > 0 };
  }
}

describe("integration availability parity", () => {
  it("start gating and Activity resolution agree for every binding/connection state", async () => {
    const decrypt = vi.spyOn(encryption, "decrypt");
    let availableCount = 0;
    for (const scenario of scenarios()) {
      const gate = await gateStatus(scenario);
      const resolved = await resolverOutcome(scenario, decrypt);

      expect(resolved.ok, scenario.label).toBe(gate.available);
      if (resolved.ok) {
        availableCount += 1;
        continue;
      }
      expect(resolved.error, scenario.label).toBeInstanceOf(IntegrationUnavailableError);
      expect((resolved.error as IntegrationUnavailableError).availabilityStatus, scenario.label).toBe(gate.status);
      expect(resolved.decrypted, `${scenario.label} must reject before decrypting`).toBe(false);
    }
    // Exactly one combination is usable: enabled, same org, live, ACTIVE, matching registered provider, declared capability.
    expect(availableCount).toBe(1);
  });

  it("reports disabled connections as unavailable even when status was left ACTIVE", () => {
    const result = evaluateBindingAvailability(
      "org-1",
      { isEnabled: true, connection: { orgId: "org-1", providerKey: "synthetic.echo", status: IntegrationConnectionStatus.ACTIVE, disabledAt: past, deletedAt: null } },
      { providerKey: "synthetic.echo", capabilityKey: "echo" }
    );
    expect(result.status).toBe("CONNECTION_UNAVAILABLE");
  });

  it("reports a requirement that no longer exists for an existing binding", async () => {
    const resolver = new IntegrationResolverService({
      findForRequirement: vi.fn().mockResolvedValue({
        isEnabled: true,
        connection: { id: "conn-1", orgId: "org-1", providerKey: "synthetic.echo", status: IntegrationConnectionStatus.ACTIVE, config: {}, ...envelope },
        workflowDefinition: { integrationRequirements: [] },
      }),
    } as never, encryption);
    await expect(
      resolver.resolve({ orgId: "org-1", workflowDefinitionKey: "platform.test", requirementKey: "syntheticEcho", providerKey: "synthetic.echo" })
    ).rejects.toMatchObject({ availabilityStatus: "REQUIREMENT_MISSING", statusCode: 404 });
  });
});
