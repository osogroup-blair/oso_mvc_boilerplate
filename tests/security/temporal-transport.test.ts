import { it, expect } from "vitest";
import { temporalConnectionOptions } from "../../src/lib/temporalTransport.js";

const local = { NODE_ENV: "test", TEMPORAL_ADDRESS: "127.0.0.1:17243", TEMPORAL_TLS_ENABLED: false };
it("permits explicit local plaintext and prohibits production or credential downgrade", async () => {
  expect(await temporalConnectionOptions(local)).toEqual({ address: local.TEMPORAL_ADDRESS, tls: undefined, apiKey: undefined });
  for (const input of [{ ...local, NODE_ENV: "production" }, { ...local, TEMPORAL_API_KEY: "PRIVATE TOKEN" }, { ...local, TEMPORAL_TLS_CA_PATH: "/private-ca" }]) {
    await expect(temporalConnectionOptions(input)).rejects.toThrow("TLS is required");
  }
});
it("uses identical TLS options for client/Worker and rejects incomplete material safely", async () => {
  expect(await temporalConnectionOptions({ ...local, TEMPORAL_TLS_ENABLED: true, TEMPORAL_API_KEY: "synthetic-key", TEMPORAL_TLS_SERVER_NAME: "test.invalid" })).toMatchObject({
    apiKey: "synthetic-key", tls: { serverNameOverride: "test.invalid" },
  });
  await expect(temporalConnectionOptions({ ...local, TEMPORAL_TLS_ENABLED: true, TEMPORAL_TLS_CLIENT_CERT_PATH: "/missing" })).rejects.toThrow("together");
  await expect(temporalConnectionOptions({ ...local, TEMPORAL_TLS_ENABLED: true, TEMPORAL_TLS_CA_PATH: "/private-canary-path" })).rejects.toThrow(/^Unable to load valid Temporal TLS material$/);
});
