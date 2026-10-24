import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  assertEgressAllowed,
  classifyProviderError,
  createProviderHttpClient,
  guardedLookup,
  isPrivateAddress,
  ProviderHttpError,
} from "../../src/integrations/http.js";

const devRuntime = { allowPrivateNetwork: true };
const prodRuntime = { allowPrivateNetwork: false };
let server: Server | undefined;

async function listen(handler: Parameters<typeof createServer>[1]) {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

afterEach(async () => {
  if (server) await new Promise((resolve) => server!.close(resolve));
  server = undefined;
});

const denied = (fn: () => unknown) => {
  try { fn(); } catch (error) { return error instanceof ProviderHttpError && error.code === "EGRESS_DENIED"; }
  return false;
};

describe("provider egress policy", () => {
  it("classifies private, loopback, link-local and mapped addresses", () => {
    for (const address of ["10.1.2.3", "127.0.0.1", "169.254.169.254", "172.20.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "not-an-ip"]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });

  it("enforces scheme, credentials, host policy and private literals before any I/O", () => {
    const base = "https://hooks.example.com/api";
    const policy = { hosts: "config.baseUrl" as const };
    expect(() => assertEgressAllowed(new URL("https://hooks.example.com/x"), policy, prodRuntime, base)).not.toThrow();
    expect(denied(() => assertEgressAllowed(new URL("http://hooks.example.com/x"), policy, prodRuntime, base))).toBe(true);
    expect(denied(() => assertEgressAllowed(new URL("https://user:pw@hooks.example.com/x"), policy, prodRuntime, base))).toBe(true);
    expect(denied(() => assertEgressAllowed(new URL("//evil.example.net/x", base), policy, prodRuntime, base))).toBe(true);
    expect(denied(() => assertEgressAllowed(new URL("https://169.254.169.254/latest"), { hosts: ["169.254.169.254"] }, prodRuntime))).toBe(true);
    expect(denied(() => assertEgressAllowed(new URL("https://localhost/x"), { hosts: ["localhost"] }, prodRuntime))).toBe(true);
    expect(() => assertEgressAllowed(new URL("https://api.vendor.com/v1"), { hosts: ["*.vendor.com"] }, prodRuntime)).not.toThrow();
    expect(denied(() => assertEgressAllowed(new URL("https://vendor.com.evil.net/v1"), { hosts: ["*.vendor.com"] }, prodRuntime))).toBe(true);
    expect(() => assertEgressAllowed(new URL("http://127.0.0.1:4010/x"), { hosts: ["127.0.0.1"] }, devRuntime)).not.toThrow();
  });

  it("refuses DNS answers that resolve to private addresses at connect time", async () => {
    const lookup = (runtime: { allowPrivateNetwork: boolean }) => new Promise<{ error: unknown; address: unknown }>((resolve) =>
      guardedLookup(runtime)("localhost", {}, (error, address) => resolve({ error, address })));
    const blocked = await lookup(prodRuntime);
    expect(blocked.error).toBeInstanceOf(ProviderHttpError);
    expect((blocked.error as ProviderHttpError).code).toBe("EGRESS_DENIED");
    const allowed = await lookup(devRuntime);
    expect(allowed.error).toBeNull();
    expect(typeof allowed.address).toBe("string");
  });
});

describe("classifyProviderError", () => {
  it("maps provider failures to idempotency classifications", () => {
    expect(classifyProviderError(ProviderHttpError.fromStatus(503))).toBe("retryable");
    expect(classifyProviderError(ProviderHttpError.fromStatus(429))).toBe("retryable");
    expect(classifyProviderError(ProviderHttpError.fromStatus(400))).toBe("terminal");
    expect(classifyProviderError(new ProviderHttpError("EGRESS_DENIED", "x", { sent: false }))).toBe("terminal");
    expect(classifyProviderError(new ProviderHttpError("NETWORK", "x", { sent: false }))).toBe("retryable");
    expect(classifyProviderError(new ProviderHttpError("NETWORK", "x", { sent: true }))).toBe("uncertain");
    expect(classifyProviderError(new ProviderHttpError("TIMEOUT", "x", { sent: true }))).toBe("uncertain");
    expect(classifyProviderError(new Error("unknown"))).toBe("uncertain");
  });
});

describe("createProviderHttpClient", () => {
  it("sends requests and returns status/body for any HTTP status, logging no headers or bodies", async () => {
    const seen: Array<{ method?: string; url?: string; body: string; auth?: string }> = [];
    const baseUrl = await listen((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        seen.push({ method: req.method, url: req.url, body, auth: req.headers["x-signature"] as string });
        res.statusCode = req.url === "/missing" ? 404 : 200;
        res.end(JSON.stringify({ ok: true }));
      });
    });
    const logs: Array<Record<string, unknown>> = [];
    const client = createProviderHttpClient({
      baseUrl, egress: { hosts: "config.baseUrl" },
      runtime: { allowPrivateNetwork: true, log: { info: (details) => logs.push(details) } },
    });

    const ok = await client.request({ method: "POST", path: "/hook?token=abc", headers: { "x-signature": "secret-signature" }, body: "{\"a\":1}" });
    const missing = await client.request({ method: "GET", path: "/missing" });

    expect(ok).toMatchObject({ status: 200, body: "{\"ok\":true}" });
    expect(missing.status).toBe(404);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/hook?token=abc", body: "{\"a\":1}", auth: "secret-signature" });
    expect(JSON.stringify(logs)).not.toMatch(/secret-signature|token=abc|"a":1/);
    expect(logs[0]).toMatchObject({ method: "POST", path: "/hook", status: 200 });
  });

  it("reports a timeout after the request was sent as uncertain", async () => {
    const baseUrl = await listen(() => { /* never responds */ });
    const client = createProviderHttpClient({ baseUrl, egress: { hosts: "config.baseUrl" }, runtime: devRuntime, timeoutMs: 100 });

    const error = await client.request({ method: "POST", path: "/slow", body: "{}" }).catch((err: unknown) => err);

    expect(error).toMatchObject({ code: "TIMEOUT", details: { sent: true } });
    expect(classifyProviderError(error)).toBe("uncertain");
  });

  it("aborts oversized responses and refused connections with safe errors", async () => {
    const baseUrl = await listen((_req, res) => res.end("x".repeat(2048)));
    const client = createProviderHttpClient({ baseUrl, egress: { hosts: "config.baseUrl" }, runtime: devRuntime, maxResponseBytes: 1024 });
    await expect(client.request({ method: "GET", path: "/big" })).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });

    await new Promise((resolve) => server!.close(resolve));
    server = undefined;
    const refused = await client.request({ method: "GET", path: "/gone" }).catch((err: unknown) => err);
    expect(refused).toMatchObject({ code: "NETWORK" });
    expect(classifyProviderError(refused)).toBe("retryable");
  });

  it("denies plain http and loopback when private egress is not allowed", async () => {
    const baseUrl = await listen((_req, res) => res.end("ok"));
    const client = createProviderHttpClient({ baseUrl, egress: { hosts: "config.baseUrl" }, runtime: prodRuntime });
    await expect(client.request({ method: "GET", path: "/" })).rejects.toMatchObject({ code: "EGRESS_DENIED" });
  });
});
