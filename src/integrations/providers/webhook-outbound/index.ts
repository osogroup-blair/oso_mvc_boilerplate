import { randomUUID } from "node:crypto";
import { defineIntegrationProvider, type ProviderEgressPolicy } from "../../types.js";
import { ProviderHttpError } from "../../http.js";
import { createWebhookClient, createWebhookOutboundAdapter, webhookHeaders, type WebhookOutboundAdapter } from "./adapter.js";
import { webhookConfigSchema, webhookCredentialSchema, type WebhookConfig } from "./schemas.js";

export type { WebhookOutboundAdapter, WebhookDeliveryResult } from "./adapter.js";
export { signWebhookBody } from "./adapter.js";

const egress: ProviderEgressPolicy = { hosts: "config.baseUrl" };

/**
 * Reference provider for real outbound HTTP. Copy this one (not synthetic.echo)
 * for providers with side effects: egress policy, signed requests, provider
 * idempotency keys, ProviderHttpError + classifyProviderError, a test that
 * never throws, and config redaction.
 */
export const webhookOutboundProvider = defineIntegrationProvider<"webhook.outbound", WebhookOutboundAdapter, "deliver">({
  key: "webhook.outbound",
  label: "Outbound Webhook",
  description: "Signed HTTPS webhook (HMAC-SHA256) with Idempotency-Key on every delivery.",
  capabilities: ["deliver"],
  operations: {
    deliver: {
      description: "POST a signed JSON event; the Idempotency-Key lets the receiver drop retried duplicates.",
      retrySafe: true,
      supportsProviderIdempotencyKey: true,
      responseRetentionDays: 30,
      dataClasses: ["pii"],
    },
  },
  egress,
  credentialForm: {
    fields: [
      {
        key: "signingSecret",
        type: "text",
        label: "Signing Secret",
        required: true,
        helpText: "Shared HMAC-SHA256 secret (min 16 chars). Stored encrypted and never rendered back.",
      },
    ],
  },
  configForm: {
    fields: [
      { key: "baseUrl", type: "url", label: "Base URL", required: true, placeholder: "https://hooks.example.com", helpText: "https only in production; requests may only go to this host." },
      { key: "path", type: "text", label: "Delivery Path", placeholder: "/webhooks/events", defaultValue: "/" },
      { key: "testPath", type: "text", label: "Test Path", placeholder: "Defaults to the delivery path" },
      { key: "extraHeaders", type: "textarea", label: "Extra Headers", helpText: "Optional non-secret \"Name: value\" lines. Signature and idempotency headers are reserved." },
    ],
  },
  validateCredentials(input) {
    return webhookCredentialSchema.parse(input);
  },
  validateConfig(input) {
    return webhookConfigSchema.parse(input);
  },
  async testConnection({ credentials, config, signal, runtime }) {
    try {
      const { signingSecret } = webhookCredentialSchema.parse(credentials);
      const parsed = webhookConfigSchema.parse(config);
      const body = JSON.stringify({ event: "webhook.test", payload: {} });
      const response = await createWebhookClient(parsed, egress, runtime).request({
        method: "POST",
        path: parsed.testPath ?? parsed.path,
        headers: { ...webhookHeaders(signingSecret, "webhook.test", body, `test-${randomUUID()}`), "x-webhook-test": "1" },
        body,
        signal,
      });
      const ok = response.status >= 200 && response.status < 300;
      return { ok, message: `Webhook endpoint responded HTTP ${response.status}` };
    } catch (error) {
      if (error instanceof ProviderHttpError) return { ok: false, message: `Webhook test failed: ${error.message}` };
      return { ok: false, message: "Webhook test failed: invalid configuration or credentials" };
    }
  },
  createAdapter({ credentials, config, runtime }) {
    return createWebhookOutboundAdapter({
      signingSecret: webhookCredentialSchema.parse(credentials).signingSecret,
      config: config as WebhookConfig,
      egress,
      runtime,
    });
  },
  redactConfig(config) {
    const headers = (config.extraHeaders ?? {}) as Record<string, unknown>;
    return { ...config, extraHeaders: Object.fromEntries(Object.keys(headers).map((name) => [name, "[redacted]"])) };
  },
});
