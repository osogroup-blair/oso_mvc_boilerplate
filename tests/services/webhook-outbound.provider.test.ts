import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyProviderError, ProviderHttpError, webhookOutboundProvider } from "../../src/integrations/index.js";
// @ts-expect-error untyped .mjs test fixture
import { startMockWebhookServer } from "../fixtures/mock-webhook-server.mjs";

const SECRET = "unit-webhook-signing-secret";
const runtime = { allowPrivateNetwork: true };
let mock: Awaited<ReturnType<typeof startMockWebhookServer>>;

beforeEach(async () => { mock = await startMockWebhookServer({ signingSecret: SECRET }); });
afterEach(async () => { await mock.close(); });

const adapterFor = (overrides: Record<string, unknown> = {}, secret = SECRET, rt = runtime) => {
  const config = webhookOutboundProvider.validateConfig({ baseUrl: mock.url, path: "/hooks/billing", extraHeaders: "X-Tenant: acme", ...overrides });
  return webhookOutboundProvider.createAdapter({ credentials: { signingSecret: secret }, config, connectionId: "conn-1", runtime: rt });
};

describe("webhook.outbound provider", () => {
  it("delivers a signed event with the operation key as Idempotency-Key and admin extra headers", async () => {
    const result = await adapterFor().deliver({ event: "customer.synced", payload: { id: "c-1" }, operationKey: "op-1" });

    expect(result).toMatchObject({ status: 200, duplicate: false, deliveryId: expect.any(String) });
    const delivery = mock.deliveries.get("op-1");
    expect(delivery.body).toEqual({ event: "customer.synced", payload: { id: "c-1" } });
    expect(delivery.headers["x-tenant"]).toBe("acme");
    expect(delivery.headers["x-webhook-signature"]).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("lets the receiver recognise a retried delivery", async () => {
    const adapter = adapterFor();
    const first = await adapter.deliver({ event: "e", payload: {}, operationKey: "op-dup" });
    const second = await adapter.deliver({ event: "e", payload: {}, operationKey: "op-dup" });

    expect(second).toMatchObject({ duplicate: true, deliveryId: first.deliveryId });
    expect(mock.deliveries.size).toBe(1);
  });

  it("raises classified provider errors for retryable and terminal responses", async () => {
    mock.injectFaults("503");
    const unavailable = await adapterFor().deliver({ event: "e", payload: {}, operationKey: "op-503" }).catch((err: unknown) => err);
    expect(unavailable).toBeInstanceOf(ProviderHttpError);
    expect(classifyProviderError(unavailable)).toBe("retryable");

    const badSignature = await adapterFor({}, "wrong-signing-secret-000").deliver({ event: "e", payload: {}, operationKey: "op-401" }).catch((err: unknown) => err);
    expect((badSignature as ProviderHttpError).status).toBe(401);
    expect(classifyProviderError(badSignature)).toBe("terminal");
    expect(mock.deliveries.size).toBe(0);
  });

  it("refuses loopback/plain-http egress unless the platform allows private networks", async () => {
    const error = await adapterFor({}, SECRET, { allowPrivateNetwork: false }).deliver({ event: "e", payload: {}, operationKey: "op-x" }).catch((err: unknown) => err);
    expect(error).toMatchObject({ code: "EGRESS_DENIED" });
    expect(mock.requests).toHaveLength(0);
  });

  it("tests the connection with a signed request and never throws", async () => {
    const config = webhookOutboundProvider.validateConfig({ baseUrl: mock.url, path: "/hooks", testPath: "/hooks/test" });
    const ok = await webhookOutboundProvider.testConnection({ credentials: { signingSecret: SECRET }, config, runtime });
    expect(ok).toEqual({ ok: true, message: "Webhook endpoint responded HTTP 200" });
    expect(mock.requests.at(-1)).toMatchObject({ path: "/hooks/test", test: true, outcome: "test" });

    const rejected = await webhookOutboundProvider.testConnection({ credentials: { signingSecret: "wrong-signing-secret-000" }, config, runtime });
    expect(rejected).toEqual({ ok: false, message: "Webhook endpoint responded HTTP 401" });

    await mock.close();
    const down = await webhookOutboundProvider.testConnection({ credentials: { signingSecret: SECRET }, config, runtime });
    expect(down.ok).toBe(false);
    expect(down.message).not.toContain(SECRET);
    mock = await startMockWebhookServer({ signingSecret: SECRET });
  });

  it("validates config: reserved headers, URL credentials, paths", () => {
    expect(() => webhookOutboundProvider.validateConfig({ baseUrl: "https://hooks.example.com", extraHeaders: { Authorization: "Bearer x" } })).toThrow("reserved");
    expect(() => webhookOutboundProvider.validateConfig({ baseUrl: "https://user:pw@hooks.example.com" })).toThrow();
    expect(() => webhookOutboundProvider.validateConfig({ baseUrl: "ftp://hooks.example.com" })).toThrow();
    expect(() => webhookOutboundProvider.validateConfig({ baseUrl: "https://hooks.example.com", path: "hooks?x=1" })).toThrow();
    expect(webhookOutboundProvider.validateConfig({ baseUrl: "https://hooks.example.com", extraHeaders: "X-A: 1\nX-B: two" }))
      .toMatchObject({ path: "/", extraHeaders: { "X-A": "1", "X-B": "two" } });
    expect(() => webhookOutboundProvider.validateCredentials({ signingSecret: "short" })).toThrow();
  });

  it("redacts extra header values from audited config", () => {
    const config = webhookOutboundProvider.validateConfig({ baseUrl: "https://hooks.example.com", extraHeaders: { "X-Tenant": "acme-private" } });
    expect(JSON.stringify(webhookOutboundProvider.redactConfig(config))).not.toContain("acme-private");
  });
});
