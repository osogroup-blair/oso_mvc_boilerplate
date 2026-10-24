/// <reference types="vite/client" />
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import type { IntegrationProviderRegistration } from "../../src/integrations/index.js";
import { providerDirectoryName, type ProviderContractFixture } from "../../src/integrations/contract.js";

type AnyFixture = ProviderContractFixture<never> & {
  operations: Record<string, (adapter: unknown, context: { operationKey: string }) => Promise<unknown>>;
};

type Mode = "ok" | "error" | "hang";
interface KitServer { baseUrl: string; requests: Array<{ method?: string; url?: string; headers: IncomingHttpHeaders }>; close(): Promise<void> }

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })));
});

async function kitServer(mode: Mode): Promise<KitServer> {
  const requests: KitServer["requests"] = [];
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      if (mode === "hang") return;
      res.writeHead(mode === "ok" ? 200 : 500).end(mode === "ok" ? "{}" : "upstream exploded");
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

function secretValues(value: unknown, out = new Set<string>()) {
  if (typeof value === "string" || typeof value === "number") { if (String(value).length >= 4) out.add(String(value)); }
  else if (value && typeof value === "object") for (const item of Object.values(value)) secretValues(item, out);
  return out;
}

function expectNoSecrets(value: unknown, secrets: Set<string>, label: string) {
  const text = JSON.stringify(value) ?? "";
  for (const secret of secrets) expect(text.includes(secret), `${label} must not contain credential value`).toBe(false);
}

// Discovered statically so Vite can bundle them; keyed by relative path.
const fixtureModules = import.meta.glob<{ contractFixture?: unknown }>("../../src/integrations/providers/*/contract.fixture.ts");

export async function loadContractFixture(providerKey: string): Promise<AnyFixture> {
  const directory = providerDirectoryName(providerKey);
  const relative = `src/integrations/providers/${directory}/contract.fixture.ts`;
  const loader = fixtureModules[`../../${relative}`];
  if (!existsSync(relative) || !loader) {
    throw new Error(
      `Provider "${providerKey}" has no contract fixture. Create ${relative} exporting ` +
      "`contractFixture = defineProviderContractFixture({...})` (copy providers/webhook-outbound/contract.fixture.ts)."
    );
  }
  const module = await loader();
  if (!module.contractFixture) throw new Error(`${relative} must export \`contractFixture\``);
  return module.contractFixture as AnyFixture;
}

/**
 * The contract every integration provider must satisfy. Runs against a local
 * HTTP server with private egress allowed, so no provider reaches the network.
 */
export function describeProviderContract(registration: IntegrationProviderRegistration) {
  describe(`provider contract: ${registration.key}`, () => {
    const runtime = { allowPrivateNetwork: true };
    let fixture: AnyFixture;
    const load = async () => (fixture ??= await loadContractFixture(registration.key));
    const setup = async (mode: Mode) => {
      const server = await kitServer(mode);
      const f = await load();
      const credentials = registration.validateCredentials(f.validCredentials);
      const config = registration.validateConfig(f.validConfig({ baseUrl: server.baseUrl }));
      return { server, credentials, config, secrets: secretValues(credentials) };
    };

    it("ships a contract fixture whose providerKey matches", async () => {
      expect((await load()).providerKey).toBe(registration.key);
    });

    it("declares unique capabilities and complete operation semantics", async () => {
      expect(registration.capabilities.length).toBeGreaterThan(0);
      expect(new Set(registration.capabilities).size).toBe(registration.capabilities.length);
      const operations = Object.entries(registration.operations);
      expect(operations.length).toBeGreaterThan(0);
      for (const [name, operation] of operations) {
        expect(typeof operation.retrySafe, `${name}.retrySafe`).toBe("boolean");
        expect(typeof operation.supportsProviderIdempotencyKey, `${name}.supportsProviderIdempotencyKey`).toBe("boolean");
        expect(operation.dataClasses.length, `${name}.dataClasses`).toBeGreaterThan(0);
        expect(operation.description.trim().length, `${name}.description`).toBeGreaterThan(0);
        if (operation.responseRetentionDays !== undefined) expect(Number.isInteger(operation.responseRetentionDays) && operation.responseRetentionDays > 0).toBe(true);
      }
      expect(Object.keys((await load()).operations).sort()).toEqual(operations.map(([name]) => name).sort());
    });

    it("rejects invalid credentials and config", async () => {
      const f = await load();
      for (const invalid of f.invalidCredentials) expect(() => registration.validateCredentials(invalid), JSON.stringify(invalid)).toThrow();
      for (const invalid of f.invalidConfig) expect(() => registration.validateConfig(invalid), JSON.stringify(invalid)).toThrow();
    });

    it("keeps credential values out of redacted config", async () => {
      const { config, secrets } = await setup("ok");
      expectNoSecrets(registration.redactConfig(config), secrets, "redactConfig output");
    });

    it("never throws from testConnection and never returns credential values", async () => {
      for (const mode of ["ok", "error"] as const) {
        const { server, credentials, config, secrets } = await setup(mode);
        const result = await registration.testConnection({ credentials, config, runtime });
        expect(typeof result.ok).toBe("boolean");
        expect(typeof result.message).toBe("string");
        if (mode === "error" && server.requests.length > 0) expect(result.ok, "a 500 response must not report ok").toBe(false);
        expectNoSecrets(result, secrets, `testConnection (${mode})`);
      }
      const { server, credentials, config, secrets } = await setup("ok");
      await server.close();
      const unreachable = await registration.testConnection({ credentials, config, runtime });
      expectNoSecrets(unreachable, secrets, "testConnection (unreachable)");
    });

    it("honours the abort signal in testConnection", async () => {
      const { credentials, config } = await setup("hang");
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 50);
      const started = Date.now();
      const result = await registration.testConnection({ credentials, config, runtime, signal: controller.signal });
      expect(Date.now() - started, "testConnection must stop soon after abort").toBeLessThan(2000);
      if (Date.now() - started >= 50) expect(result.ok).toBe(false);
    });

    it("runs every operation without leaking credentials, passing the operation key when supported, within declared egress", async () => {
      const { server, credentials, config, secrets } = await setup("ok");
      const adapter = registration.createAdapter({ credentials, config, connectionId: "contract-connection", runtime });
      const f = await load();
      for (const [name, operation] of Object.entries(registration.operations)) {
        const operationKey = `contract-op-${randomUUID()}`;
        const before = server.requests.length;
        const result = await f.operations[name](adapter, { operationKey });
        expectNoSecrets(result, secrets, `${name} result`);
        if (operation.supportsProviderIdempotencyKey) {
          const sent = server.requests.slice(before).some((request) => Object.values(request.headers).some((value) => String(value).includes(operationKey)));
          expect(sent, `${name} declares supportsProviderIdempotencyKey but did not send the operation key`).toBe(true);
        }
      }
      await registration.testConnection({ credentials, config, runtime });
      if (server.requests.length > 0) {
        expect(registration.egress, "providers that make network calls must declare egress").toBeDefined();
      } else {
        expect(registration.egress, "no-network providers should not declare egress").toBeUndefined();
      }
    });
  });
}
