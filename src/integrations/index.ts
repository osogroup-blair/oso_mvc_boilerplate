import type { IntegrationProviderRegistration } from "./types.js";
import { syntheticEchoProvider } from "./providers/synthetic-echo/index.js";
import { webhookOutboundProvider } from "./providers/webhook-outbound/index.js";

export * from "./types.js";
export {
  assertEgressAllowed,
  classifyProviderError,
  createProviderHttpClient,
  isPrivateAddress,
  ProviderHttpError,
  type ProviderHttpClient,
} from "./http.js";
export { syntheticEchoProvider } from "./providers/synthetic-echo/index.js";
export type { SyntheticEchoAdapter } from "./providers/synthetic-echo/index.js";
export { webhookOutboundProvider, signWebhookBody } from "./providers/webhook-outbound/index.js";
export type { WebhookDeliveryResult, WebhookOutboundAdapter } from "./providers/webhook-outbound/index.js";

/**
 * Code-owned provider registry. Add a provider by creating
 * providers/<name>/{schemas,adapter,index}.ts + README.md and listing it here;
 * the literal tuple keeps provider keys, adapters and operations typed.
 */
export const integrationProviders = [syntheticEchoProvider, webhookOutboundProvider] as const;

type RegisteredProvider = (typeof integrationProviders)[number];
export type IntegrationProviderKey = RegisteredProvider["key"];
export type ProviderFor<K extends IntegrationProviderKey> = Extract<RegisteredProvider, { key: K }>;
export type AdapterFor<K extends IntegrationProviderKey> = ReturnType<ProviderFor<K>["createAdapter"]>;
export type OperationFor<K extends IntegrationProviderKey> = keyof ProviderFor<K>["operations"] & string;

export function listIntegrationProviders(): readonly IntegrationProviderRegistration[] {
  return integrationProviders;
}

export function getIntegrationProvider(providerKey: string): IntegrationProviderRegistration | null {
  return integrationProviders.find((provider) => provider.key === providerKey) ?? null;
}

export function isIntegrationProviderKey(providerKey: string): providerKey is IntegrationProviderKey {
  return integrationProviders.some((provider) => provider.key === providerKey);
}
