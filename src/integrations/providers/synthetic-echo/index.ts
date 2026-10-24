import { defineIntegrationProvider } from "../../types.js";
import { createSyntheticEchoAdapter, type SyntheticEchoAdapter } from "./adapter.js";
import { DEFAULT_ENDPOINT_LABEL, syntheticConfigSchema, syntheticCredentialSchema } from "./schemas.js";

export type { SyntheticEchoAdapter } from "./adapter.js";

export const syntheticEchoProvider = defineIntegrationProvider<"synthetic.echo", SyntheticEchoAdapter, "echo">({
  key: "synthetic.echo",
  label: "Synthetic Echo",
  description: "Local no-network provider used to prove encrypted integration resolution.",
  capabilities: ["echo"],
  operations: {
    echo: {
      description: "Returns the payload with connection metadata; no external side effect.",
      retrySafe: true,
      supportsProviderIdempotencyKey: false,
      dataClasses: ["none"],
    },
  },
  credentialForm: {
    fields: [
      {
        key: "apiToken",
        type: "text",
        label: "API Token",
        required: true,
        helpText: "Development-only synthetic secret. Stored encrypted and never rendered back.",
      },
    ],
  },
  configForm: {
    fields: [
      {
        key: "endpointLabel",
        type: "text",
        label: "Endpoint Label",
        placeholder: DEFAULT_ENDPOINT_LABEL,
      },
    ],
  },
  validateCredentials(input) {
    return syntheticCredentialSchema.parse(input);
  },
  validateConfig(input) {
    const parsed = syntheticConfigSchema.parse(input);
    return { endpointLabel: parsed.endpointLabel || DEFAULT_ENDPOINT_LABEL };
  },
  async testConnection({ credentials, config }) {
    const apiToken = String(credentials.apiToken ?? "");
    if (!apiToken || apiToken.length < 8) {
      return { ok: false, message: "Synthetic token is invalid" };
    }
    return { ok: true, message: `Synthetic echo ready: ${String(config.endpointLabel ?? "local")}` };
  },
  createAdapter({ config, connectionId }) {
    return createSyntheticEchoAdapter({ config, connectionId });
  },
  redactConfig(config) {
    return config;
  },
});
