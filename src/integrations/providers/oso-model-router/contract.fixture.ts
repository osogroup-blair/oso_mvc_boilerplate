import { defineProviderContractFixture } from "../../contract.js";

export const contractFixture = defineProviderContractFixture({
  providerKey: "oso.model-router",
  validCredentials: { apiKey: "contract-model-router-key" },
  invalidCredentials: [{}, { apiKey: "" }, { apiKey: 12345 }],
  validConfig: ({ baseUrl }) => ({ baseUrl }),
  invalidConfig: [
    { baseUrl: "not a url" },
    { baseUrl: "https://user:pw@models.example.com" },
    { baseUrl: "https://models.example.com/path" },
  ],
  operations: {
    complete: (adapter) => adapter.complete({
      model: "oso/fast",
      messages: [{ role: "user", content: "contract request" }],
    }),
  },
});
