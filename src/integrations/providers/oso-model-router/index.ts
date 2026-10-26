import { defineIntegrationProvider, type ProviderEgressPolicy } from "../../types.js";
import { classifyProviderError, ProviderHttpError } from "../../http.js";
import { createModelRouterClient, createOsoModelRouterAdapter, type OsoModelRouterAdapter } from "./adapter.js";
import { DEFAULT_MODEL_ROUTER_BASE_URL, modelRouterConfigSchema, modelRouterCredentialSchema } from "./schemas.js";

export type { OsoModelRouterAdapter, ModelRouterChatCompletion } from "./adapter.js";

const egress: ProviderEgressPolicy = { hosts: "config.baseUrl" };
const DEFAULT_BASE_URL = DEFAULT_MODEL_ROUTER_BASE_URL;

export const osoModelRouterProvider = defineIntegrationProvider<"oso.model-router", OsoModelRouterAdapter, "complete">({
  key: "oso.model-router",
  label: "Oso Model Router",
  description: "OpenAI-compatible chat completions through the internal Oso model router, including function calling and Oso routing options.",
  capabilities: ["chat.completions", "tool-calling", "json-output"],
  operations: {
    complete: {
      description: "Create a non-streaming chat completion. Tool definitions and Oso routing options are supported.",
      retrySafe: false,
      supportsProviderIdempotencyKey: false,
      dataClasses: ["pii"],
    },
  },
  egress,
  credentialForm: {
    fields: [{
      key: "apiKey",
      type: "text",
      label: "Model Router API Key",
      required: true,
      placeholder: "Paste an Oso model-router API key",
      helpText: "Sent as a Bearer token. Stored encrypted and never displayed again.",
    }],
  },
  configForm: {
    fields: [{
      key: "baseUrl",
      type: "url",
      label: "Router Base URL",
      required: true,
      defaultValue: DEFAULT_BASE_URL,
      placeholder: DEFAULT_BASE_URL,
      helpText: "Use the router origin, for example https://models.oso.group.",
    }],
  },
  validateCredentials(input) {
    return modelRouterCredentialSchema.parse(input);
  },
  validateConfig(input) {
    return modelRouterConfigSchema.parse(input);
  },
  async testConnection({ credentials, config, signal, runtime }) {
    try {
      const { apiKey } = modelRouterCredentialSchema.parse(credentials);
      const parsed = modelRouterConfigSchema.parse(config);
      const response = await createModelRouterClient({ apiKey, config: parsed, egress, runtime }).request({
        method: "GET",
        path: "/v1/models",
        signal,
      });
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, message: `Model router authentication check failed with HTTP ${response.status}` };
      }
      return { ok: true, message: "Model router API key accepted; model catalog endpoint is available" };
    } catch (error) {
      if (error instanceof ProviderHttpError) {
        const classification = classifyProviderError(error);
        return { ok: false, message: classification === "terminal" ? error.message : "Model router connection failed; check the router URL and network" };
      }
      return { ok: false, message: "Model router test failed: invalid configuration or credentials" };
    }
  },
  createAdapter({ credentials, config, runtime }) {
    return createOsoModelRouterAdapter({
      apiKey: modelRouterCredentialSchema.parse(credentials).apiKey,
      config: modelRouterConfigSchema.parse(config),
      egress,
      runtime,
    });
  },
  redactConfig(config) {
    return config;
  },
});
