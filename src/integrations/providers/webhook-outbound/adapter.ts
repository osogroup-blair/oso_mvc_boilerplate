import { createHmac } from "node:crypto";
import { createProviderHttpClient, ProviderHttpError, type ProviderEgressPolicy, type ProviderRuntime } from "../../http.js";
import type { WebhookConfig } from "./schemas.js";

export interface WebhookDeliveryResult {
  status: number;
  /** Receiver-assigned id from the X-Delivery-Id response header, if any. */
  deliveryId: string | null;
  /** Receiver reported it had already processed this Idempotency-Key. */
  duplicate: boolean;
}

export interface WebhookOutboundAdapter {
  /**
   * POSTs `{ event, payload }` signed with HMAC-SHA256. `operationKey` is sent
   * as Idempotency-Key so a retried delivery is recognised by the receiver.
   */
  deliver(input: { event: string; payload: Record<string, unknown>; operationKey: string; signal?: AbortSignal }): Promise<WebhookDeliveryResult>;
}

/** Signature over `${timestamp}.${body}`; receivers recompute it with the shared signing secret. */
export function signWebhookBody(signingSecret: string, timestamp: string, body: string) {
  return `v1=${createHmac("sha256", signingSecret).update(`${timestamp}.${body}`).digest("hex")}`;
}

export function webhookHeaders(signingSecret: string, event: string, body: string, idempotencyKey: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "content-type": "application/json",
    "idempotency-key": idempotencyKey,
    "x-webhook-event": event,
    "x-webhook-timestamp": timestamp,
    "x-webhook-signature": signWebhookBody(signingSecret, timestamp, body),
  };
}

export function createWebhookClient(config: WebhookConfig, egress: ProviderEgressPolicy, runtime: ProviderRuntime) {
  return createProviderHttpClient({ baseUrl: config.baseUrl, egress, runtime, defaultHeaders: config.extraHeaders });
}

export function createWebhookOutboundAdapter(input: {
  signingSecret: string;
  config: WebhookConfig;
  egress: ProviderEgressPolicy;
  runtime: ProviderRuntime;
}): WebhookOutboundAdapter {
  const client = createWebhookClient(input.config, input.egress, input.runtime);
  return {
    async deliver({ event, payload, operationKey, signal }) {
      const body = JSON.stringify({ event, payload });
      const response = await client.request({
        method: "POST",
        path: input.config.path,
        headers: webhookHeaders(input.signingSecret, event, body, operationKey),
        body,
        signal,
      });
      if (response.status < 200 || response.status >= 300) throw ProviderHttpError.fromStatus(response.status);
      const deliveryId = response.headers["x-delivery-id"];
      return {
        status: response.status,
        deliveryId: typeof deliveryId === "string" ? deliveryId.slice(0, 200) : null,
        duplicate: response.headers["x-webhook-duplicate"] === "1",
      };
    },
  };
}
