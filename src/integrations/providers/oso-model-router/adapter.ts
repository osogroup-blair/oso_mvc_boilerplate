import { createProviderHttpClient, ProviderHttpError, type ProviderEgressPolicy, type ProviderRuntime } from "../../http.js";
import { modelRouterChatRequestSchema, type ModelRouterChatRequest, type ModelRouterConfig } from "./schemas.js";

export interface ModelRouterChatCompletion {
  id: string | null;
  model: string | null;
  choices: Array<Record<string, unknown>>;
  usage: Record<string, unknown> | null;
}

export interface OsoModelRouterAdapter {
  complete(input: ModelRouterChatRequest, signal?: AbortSignal): Promise<ModelRouterChatCompletion>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeCompletion(value: unknown): ModelRouterChatCompletion {
  if (!isRecord(value)) {
    throw new ProviderHttpError("NETWORK", "Model router returned an invalid response", { sent: true });
  }
  const choices = Array.isArray(value.choices)
    ? value.choices.filter(isRecord).map((choice) => ({
        ...(typeof choice.index === "number" ? { index: choice.index } : {}),
        ...(isRecord(choice.message) ? { message: choice.message } : {}),
        ...(typeof choice.finish_reason === "string" || choice.finish_reason === null ? { finish_reason: choice.finish_reason } : {}),
      }))
    : [];
  return {
    id: typeof value.id === "string" ? value.id.slice(0, 200) : null,
    model: typeof value.model === "string" ? value.model.slice(0, 200) : null,
    choices,
    usage: isRecord(value.usage) ? value.usage : null,
  };
}

export function createOsoModelRouterAdapter(input: {
  apiKey: string;
  config: ModelRouterConfig;
  egress: ProviderEgressPolicy;
  runtime: ProviderRuntime;
}): OsoModelRouterAdapter {
  const client = createProviderHttpClient({
    baseUrl: input.config.baseUrl,
    egress: input.egress,
    runtime: input.runtime,
    timeoutMs: 120_000,
    maxResponseBytes: 1_000_000,
  });

  return {
    async complete(unparsed, signal) {
      const request = JSON.stringify({ ...modelRouterChatRequestSchema.parse(unparsed), stream: false });
      const response = await client.request({
        method: "POST",
        path: "/v1/chat/completions",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "content-type": "application/json",
        },
        body: request,
        signal,
      });
      if (response.status < 200 || response.status >= 300) throw ProviderHttpError.fromStatus(response.status);
      try {
        return normalizeCompletion(JSON.parse(response.body) as unknown);
      } catch (error) {
        if (error instanceof ProviderHttpError) throw error;
        throw new ProviderHttpError("NETWORK", "Model router returned an invalid response", { sent: true });
      }
    },
  };
}

export function createModelRouterClient(input: {
  apiKey: string;
  config: ModelRouterConfig;
  egress: ProviderEgressPolicy;
  runtime: ProviderRuntime;
}) {
  return createProviderHttpClient({
    baseUrl: input.config.baseUrl,
    egress: input.egress,
    runtime: input.runtime,
    timeoutMs: 15_000,
    maxResponseBytes: 256_000,
    defaultHeaders: { authorization: `Bearer ${input.apiKey}` },
  });
}
