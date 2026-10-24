import { request as httpRequest, type IncomingHttpHeaders, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP } from "node:net";

/**
 * Shared egress client for integration providers. Providers must make every
 * outbound call through createProviderHttpClient (enforced by the provider
 * contract suite) so host policy, private-network blocking, timeouts, response
 * limits, safe logging, and retry classification are identical everywhere.
 *
 * It is built on node:http(s) rather than fetch so the private-address check
 * runs inside the socket's DNS lookup: a hostname that resolves (or rebinds)
 * to a private address is refused at connect time, not just at validation.
 */

/** Where a provider may send requests. "config.baseUrl" = only the admin-configured base URL's host. */
export interface ProviderEgressPolicy {
  hosts: readonly string[] | "config.baseUrl";
}

/** Platform-supplied runtime options, injected by services (providers never read config). */
export interface ProviderRuntime {
  /** INTEGRATION_ALLOW_PRIVATE_EGRESS: permit loopback/private hosts and plain http (dev/test only). */
  allowPrivateNetwork: boolean;
  /** Optional structured logger; receives method, host, path, status and timing only. */
  log?: { info(details: Record<string, unknown>, message: string): void };
}

export type ProviderHttpErrorCode = "EGRESS_DENIED" | "HTTP_STATUS" | "NETWORK" | "TIMEOUT" | "RESPONSE_TOO_LARGE";

/** Safe-to-store error: carries codes and status, never request/response bodies or headers. */
export class ProviderHttpError extends Error {
  constructor(
    public readonly code: ProviderHttpErrorCode,
    message: string,
    public readonly details: { status?: number; sent: boolean }
  ) {
    super(message);
    this.name = "ProviderHttpError";
  }

  get status() {
    return this.details.status;
  }

  static fromStatus(status: number) {
    return new ProviderHttpError("HTTP_STATUS", `Provider responded with HTTP ${status}`, { status, sent: true });
  }
}

/**
 * Maps provider errors to ActivityOperationPolicy.classifyError results:
 * - 429/5xx and failures before the request was sent are retryable;
 * - other 4xx and egress-policy denials are terminal (retrying cannot help);
 * - timeouts or connection loss after the request was sent are uncertain (the
 *   provider may have acted; retry only with the same idempotency key).
 */
export function classifyProviderError(error: unknown): "retryable" | "terminal" | "uncertain" {
  if (!(error instanceof ProviderHttpError)) return "uncertain";
  switch (error.code) {
    case "HTTP_STATUS": {
      const status = error.details.status ?? 0;
      return status === 429 || status >= 500 ? "retryable" : "terminal";
    }
    case "EGRESS_DENIED":
      return "terminal";
    case "RESPONSE_TOO_LARGE":
      return "uncertain";
    case "NETWORK":
    case "TIMEOUT":
      return error.details.sent ? "uncertain" : "retryable";
  }
}

const privateRanges = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 3],
] as const) privateRanges.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) {
  privateRanges.addSubnet(network, prefix, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return privateRanges.check(mapped[1], "ipv4");
  const family = isIP(address);
  if (family === 4) return privateRanges.check(address, "ipv4");
  if (family === 6) return privateRanges.check(address, "ipv6");
  return true; // not an IP: never treat as public
}

function hostMatches(hostname: string, pattern: string) {
  const host = hostname.toLowerCase();
  const rule = pattern.toLowerCase();
  return rule.startsWith("*.") ? host.endsWith(rule.slice(1)) && host.length > rule.length - 1 : host === rule;
}

/**
 * Validates a URL against the provider's egress policy before any network I/O.
 * Used by provider config validation and by every request.
 */
export function assertEgressAllowed(url: URL, policy: ProviderEgressPolicy, runtime: ProviderRuntime, configuredBaseUrl?: string) {
  const deny = (reason: string) => new ProviderHttpError("EGRESS_DENIED", `Egress denied: ${reason}`, { sent: false });
  if (url.protocol !== "https:" && !(url.protocol === "http:" && runtime.allowPrivateNetwork)) {
    throw deny(`${url.protocol} is not allowed`);
  }
  if (url.username || url.password) throw deny("URL credentials are not allowed");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (policy.hosts === "config.baseUrl") {
    if (!configuredBaseUrl) throw deny("no configured base URL");
    if (new URL(configuredBaseUrl).host !== url.host) throw deny(`host ${url.host} is outside the configured base URL`);
  } else if (!policy.hosts.some((pattern) => hostMatches(hostname, pattern))) {
    throw deny(`host ${hostname} is not in the provider allowlist`);
  }
  if (!runtime.allowPrivateNetwork && (hostname === "localhost" || hostname.endsWith(".localhost") || (isIP(hostname) && isPrivateAddress(hostname)))) {
    throw deny(`host ${hostname} is a private or loopback address`);
  }
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup used for every provider socket; refuses private answers unless the runtime allows them. */
export function guardedLookup(runtime: ProviderRuntime) {
  return (hostname: string, options: { all?: boolean; family?: number | string }, callback: LookupCallback) => {
    dnsLookup(hostname, { all: true, family: Number(options?.family) || 0 }, (error, addresses) => {
      if (error) return callback(error, []);
      const usable = runtime.allowPrivateNetwork ? addresses : addresses.filter((entry) => !isPrivateAddress(entry.address));
      if (!usable.length) {
        const denied = new ProviderHttpError("EGRESS_DENIED", `Egress denied: ${hostname} resolves to a private address`, { sent: false });
        return callback(denied as unknown as NodeJS.ErrnoException, []);
      }
      if (options?.all) return callback(null, usable);
      return callback(null, usable[0].address, usable[0].family);
    });
  };
}

export interface ProviderHttpRequest {
  method: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path (and query) relative to baseUrl. */
  path: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export interface ProviderHttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface ProviderHttpClientOptions {
  baseUrl: string;
  egress: ProviderEgressPolicy;
  runtime: ProviderRuntime;
  timeoutMs?: number;
  maxResponseBytes?: number;
  defaultHeaders?: Record<string, string>;
}

export function createProviderHttpClient(options: ProviderHttpClientOptions) {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxResponseBytes = options.maxResponseBytes ?? 64 * 1024;

  return {
    /** Resolves for any HTTP status; use ProviderHttpError.fromStatus for non-2xx handling. */
    async request(input: ProviderHttpRequest): Promise<ProviderHttpResponse> {
      const url = new URL(input.path, options.baseUrl);
      assertEgressAllowed(url, options.egress, options.runtime, options.baseUrl);
      const signals = [AbortSignal.timeout(timeoutMs), ...(input.signal ? [input.signal] : [])];
      const signal = AbortSignal.any(signals);
      const started = Date.now();
      const requestOptions: RequestOptions = {
        method: input.method,
        headers: { ...options.defaultHeaders, ...input.headers, ...(input.body !== undefined ? { "content-length": String(Buffer.byteLength(input.body)) } : {}) },
        lookup: guardedLookup(options.runtime) as RequestOptions["lookup"],
        signal,
      };

      return new Promise<ProviderHttpResponse>((resolve, reject) => {
        let sent = false;
        let settled = false;
        const fail = (error: ProviderHttpError) => { if (!settled) { settled = true; reject(error); } };
        const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, requestOptions, (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maxResponseBytes) {
              req.destroy();
              fail(new ProviderHttpError("RESPONSE_TOO_LARGE", `Provider response exceeded ${maxResponseBytes} bytes`, { status: res.statusCode, sent: true }));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            if (settled) return;
            settled = true;
            options.runtime.log?.info({ method: input.method, host: url.host, path: url.pathname, status: res.statusCode, durationMs: Date.now() - started }, "Provider HTTP request");
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") });
          });
          res.on("error", () => fail(new ProviderHttpError("NETWORK", "Provider response stream failed", { status: res.statusCode, sent: true })));
        });
        req.on("finish", () => { sent = true; });
        req.on("error", (error) => {
          if (error instanceof ProviderHttpError) return fail(error);
          if (signal.aborted) {
            return fail(new ProviderHttpError("TIMEOUT", `Provider request aborted or timed out after ${timeoutMs}ms`, { sent }));
          }
          fail(new ProviderHttpError("NETWORK", `Provider request failed (${(error as NodeJS.ErrnoException).code ?? "network error"})`, { sent }));
        });
        if (input.body !== undefined) req.write(input.body);
        req.end();
      });
    },
  };
}

export type ProviderHttpClient = ReturnType<typeof createProviderHttpClient>;
