import { defineProviderContractFixture } from "../../contract.js";

export const contractFixture = defineProviderContractFixture({
  providerKey: "webhook.outbound",
  validCredentials: { signingSecret: "contract-webhook-signing-secret" },
  invalidCredentials: [{}, { signingSecret: "too-short" }],
  validConfig: ({ baseUrl }) => ({ baseUrl, path: "/contract/deliver", testPath: "/contract/test", extraHeaders: { "X-Contract": "1" } }),
  invalidConfig: [
    {},
    { baseUrl: "not a url" },
    { baseUrl: "https://user:pw@hooks.example.com" },
    { baseUrl: "https://hooks.example.com", extraHeaders: { "Idempotency-Key": "override" } },
  ],
  operations: {
    deliver: (adapter, { operationKey }) => adapter.deliver({ event: "contract.event", payload: { id: "contract-1" }, operationKey }),
  },
});
