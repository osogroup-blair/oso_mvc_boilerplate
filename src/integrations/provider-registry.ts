import { z } from "zod";
import type { FormDefinition } from "../temporal/forms.js";

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
}

export interface SyntheticEchoAdapter {
  echo(input: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface IntegrationProviderRegistration<TAdapter = unknown> {
  key: string;
  label: string;
  description?: string;
  capabilities: string[];
  credentialForm: FormDefinition;
  configForm: FormDefinition;
  validateCredentials(input: unknown): Record<string, unknown>;
  validateConfig(input: unknown): Record<string, unknown>;
  testConnection(input: {
    credentials: Record<string, unknown>;
    config: Record<string, unknown>;
  }): Promise<IntegrationTestResult>;
  createAdapter(input: {
    credentials: Record<string, unknown>;
    config: Record<string, unknown>;
    connectionId: string;
  }): TAdapter;
  redactConfig(config: Record<string, unknown>): Record<string, unknown>;
}

const syntheticCredentialSchema = z.object({
  apiToken: z.string().trim().min(8, "Synthetic API token must be at least 8 characters"),
});

const syntheticConfigSchema = z.object({
  endpointLabel: z.string().trim().max(120).optional().or(z.literal("")),
});

export const syntheticEchoProvider: IntegrationProviderRegistration<SyntheticEchoAdapter> = {
  key: "synthetic.echo",
  label: "Synthetic Echo",
  description: "Local no-network provider used to prove encrypted integration resolution.",
  capabilities: ["echo"],
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
        placeholder: "Local synthetic endpoint",
      },
    ],
  },
  validateCredentials(input) {
    return syntheticCredentialSchema.parse(input);
  },
  validateConfig(input) {
    const parsed = syntheticConfigSchema.parse(input);
    return { endpointLabel: parsed.endpointLabel || "Local synthetic endpoint" };
  },
  async testConnection({ credentials, config }) {
    const apiToken = String(credentials.apiToken ?? "");
    if (!apiToken || apiToken.length < 8) {
      return { ok: false, message: "Synthetic token is invalid" };
    }
    return { ok: true, message: `Synthetic echo ready: ${String(config.endpointLabel ?? "local")}` };
  },
  createAdapter({ credentials: _credentials, config, connectionId }) {
    return {
      async echo(input: Record<string, unknown>) {
        return {
          providerKey: "synthetic.echo",
          connectionId,
          endpointLabel: config.endpointLabel ?? "Local synthetic endpoint",
          echoed: input,
        };
      },
    };
  },
  redactConfig(config) {
    return config;
  },
};

export const integrationProviders = [syntheticEchoProvider] as const;

export function listIntegrationProviders() {
  return integrationProviders;
}

export function getIntegrationProvider(providerKey: string) {
  return integrationProviders.find((provider) => provider.key === providerKey) ?? null;
}
