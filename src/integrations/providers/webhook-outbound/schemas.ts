import { z } from "zod";

/** Headers the provider owns; admins may not override them through extraHeaders. */
export const RESERVED_WEBHOOK_HEADERS = new Set([
  "authorization", "cookie", "host", "content-type", "content-length", "idempotency-key",
  "x-webhook-event", "x-webhook-timestamp", "x-webhook-signature", "x-webhook-test",
]);

export const webhookCredentialSchema = z.object({
  signingSecret: z.string().min(16, "Signing secret must be at least 16 characters"),
});

const pathSchema = z.string().trim().regex(/^\/[^\s?#]*$/, "Path must start with / and contain no query or fragment");

/** Accepts a record or the admin form's "Name: value" lines. */
const extraHeadersSchema = z.preprocess((value) => {
  if (typeof value !== "string") return value ?? {};
  return Object.fromEntries(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const index = line.indexOf(":");
    return index < 0 ? [line, ""] : [line.slice(0, index).trim(), line.slice(index + 1).trim()];
  }));
}, z.record(z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Header names may contain letters, digits and dashes"), z.string().min(1).max(500))
  .refine((headers) => Object.keys(headers).every((name) => !RESERVED_WEBHOOK_HEADERS.has(name.toLowerCase())), "extraHeaders may not set reserved headers")
  .refine((headers) => Object.keys(headers).length <= 10, "At most 10 extra headers"));

export const webhookConfigSchema = z.object({
  baseUrl: z.string().trim().url("Base URL must be a URL").refine((value) => {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.hash && !url.search;
  }, "Base URL must be http(s) without credentials, query or fragment"),
  path: pathSchema.default("/"),
  testPath: pathSchema.optional().or(z.literal("").transform(() => undefined)),
  extraHeaders: extraHeadersSchema.default({}),
});

export type WebhookConfig = z.infer<typeof webhookConfigSchema>;
