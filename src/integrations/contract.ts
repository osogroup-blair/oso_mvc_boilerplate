import type { AdapterFor, IntegrationProviderKey, OperationFor } from "./index.js";

/**
 * Per-provider inputs for the provider contract suite
 * (tests/providers/all-providers.test.ts). Every registered provider must ship
 * one as providers/<key with "." → "-">/contract.fixture.ts exporting
 * `contractFixture`; the suite fails with instructions when it is missing.
 * Use only synthetic, obviously fake secrets.
 */
export interface ProviderContractFixture<K extends IntegrationProviderKey> {
  providerKey: K;
  validCredentials: Record<string, unknown>;
  invalidCredentials: readonly unknown[];
  /** Valid config pointing at the suite's local HTTP endpoint (ignored by no-network providers). */
  validConfig(endpoint: { baseUrl: string }): Record<string, unknown>;
  invalidConfig: readonly unknown[];
  /** Calls each declared operation once through the adapter; every declared operation is required. */
  operations: { [Operation in OperationFor<K>]: (adapter: AdapterFor<K>, context: { operationKey: string }) => Promise<unknown> };
}

export function defineProviderContractFixture<K extends IntegrationProviderKey>(fixture: ProviderContractFixture<K>) {
  return fixture;
}

/** Directory convention for provider modules: "webhook.outbound" → "webhook-outbound". */
export function providerDirectoryName(providerKey: string) {
  return providerKey.replaceAll(".", "-");
}
