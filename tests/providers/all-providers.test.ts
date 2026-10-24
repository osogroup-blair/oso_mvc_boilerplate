// Every registered provider runs the shared contract automatically; adding a
// provider to src/integrations/index.ts without a contract fixture fails here.
import { expect, it } from "vitest";
import { integrationProviders } from "../../src/integrations/index.js";
import { describeProviderContract, loadContractFixture } from "./provider-contract.js";

for (const provider of integrationProviders) describeProviderContract(provider);

it("tells provider authors exactly which fixture file to add", async () => {
  await expect(loadContractFixture("acme.crm")).rejects.toThrow("src/integrations/providers/acme-crm/contract.fixture.ts");
});
