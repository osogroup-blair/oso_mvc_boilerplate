/**
 * Guards for calling provider code from admin surfaces. Provider messages are
 * stored, audited, and shown in redirects, so they are scrubbed of every
 * credential value before they leave the service layer.
 */
export const MAX_INTEGRATION_MESSAGE_LENGTH = 300;
const MIN_SCRUBBED_SECRET_LENGTH = 4;

export class IntegrationTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Integration call timed out after ${Math.round(timeoutMs / 1000)}s`);
    this.name = "IntegrationTimeoutError";
  }
}

export async function runWithTimeout<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // Settle the timeout first: an operation that resolves on abort must not win the race.
      reject(new IntegrationTimeoutError(timeoutMs));
      controller.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function collectSecretStrings(value: unknown, out: Set<string>) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint") {
    const text = String(value);
    if (text.length >= MIN_SCRUBBED_SECRET_LENGTH) out.add(text);
  } else if (Array.isArray(value)) {
    for (const item of value) collectSecretStrings(item, out);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectSecretStrings(item, out);
  }
}

export function scrubIntegrationMessage(
  message: unknown,
  credentials: Record<string, unknown>,
  redactMessage?: (message: string) => string
) {
  let text = typeof message === "string" ? message : String(message ?? "");
  const secrets = new Set<string>();
  collectSecretStrings(credentials, secrets);
  // Longest first so a secret containing another secret is removed whole.
  for (const secret of [...secrets].sort((a, b) => b.length - a.length)) {
    text = text.split(secret).join("[redacted]");
  }
  if (redactMessage) text = redactMessage(text);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > MAX_INTEGRATION_MESSAGE_LENGTH ? `${text.slice(0, MAX_INTEGRATION_MESSAGE_LENGTH - 1)}…` : text;
}
