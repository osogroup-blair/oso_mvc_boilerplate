import { z } from "zod";

export const DEFAULT_MODEL_ROUTER_BASE_URL = "https://models.oso.group";

export const modelRouterCredentialSchema = z.object({
  apiKey: z.string().trim().min(1, "API key is required").max(2_000),
});

export const modelRouterConfigSchema = z.object({
  baseUrl: z.string().trim().url("Base URL must be a URL").default(DEFAULT_MODEL_ROUTER_BASE_URL).refine((value) => {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:")
      && !url.username && !url.password && !url.search && !url.hash
      && (url.pathname === "/" || url.pathname === "");
  }, "Base URL must be an http(s) origin without credentials, path, query or fragment"),
});

const chatMessageSchema = z.record(z.unknown()).refine((message) =>
  typeof message.role === "string" && message.role.length > 0,
  "Each message must include a role"
);

/**
 * OpenAI-compatible non-streaming request shape. passthrough keeps Oso router
 * extensions (such as `routing`) and current OpenAI request options intact.
 */
export const modelRouterChatRequestSchema = z.object({
  model: z.string().trim().min(1).max(200),
  messages: z.array(chatMessageSchema).min(1).max(500),
  stream: z.literal(false).optional(),
}).passthrough();

export type ModelRouterConfig = z.infer<typeof modelRouterConfigSchema>;
export type ModelRouterChatRequest = z.infer<typeof modelRouterChatRequestSchema>;
