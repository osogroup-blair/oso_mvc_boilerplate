import { defineProviderContractFixture } from "../../contract.js";

export const contractFixture = defineProviderContractFixture({
  providerKey: "synthetic.echo",
  validCredentials: { apiToken: "contract-synthetic-token" },
  invalidCredentials: [{}, { apiToken: "short" }, { apiToken: 12345678 }],
  validConfig: () => ({ endpointLabel: "Contract endpoint" }),
  invalidConfig: [{ endpointLabel: "x".repeat(200) }],
  operations: {
    echo: (adapter) => adapter.echo({ contract: true }),
  },
});
