// Typed, validated environment config.
// Reading process.env anywhere else in the app is discouraged — import from here.
import dotenv from "dotenv";
import { z } from "zod";

// Owned test setup supplies explicit infrastructure. Never import app secrets
// from a checkout's .env into unit or owned integration/process tests.
if (process.env.NODE_ENV !== "test") dotenv.config();

const credentialKeyRingSchema = z
  .string()
  .default("{}")
  .transform((rawValue, ctx): Record<string, string> => {
    const value = rawValue.trim();
    if (!value) return {};

    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "INTEGRATION_CREDENTIAL_KEY_RING must be a JSON object of version-to-secret entries",
      });
      return {};
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "INTEGRATION_CREDENTIAL_KEY_RING must be a JSON object of version-to-secret entries",
      });
      return {};
    }

    const keyRing: Record<string, string> = {};
    for (const [version, keyMaterial] of Object.entries(parsed)) {
      if (!version.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "INTEGRATION_CREDENTIAL_KEY_RING contains an empty key version",
        });
        continue;
      }
      if (typeof keyMaterial !== "string" || keyMaterial.length < 32) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `INTEGRATION_CREDENTIAL_KEY_RING entry ${version} must be at least 32 characters`,
        });
        continue;
      }
      keyRing[version] = keyMaterial;
    }

    return keyRing;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  SESSION_TTL_HOURS: z.coerce.number().default(24),
  REDIS_URL: z.string().default("redis://localhost:6380"),
  PRIVATE_ASSET_ROOT: z.string().min(1).optional(),
  PRIVATE_ASSET_STORE_ID: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).default("local-private-v1"),
  TEMPORAL_PAYLOAD_ENCRYPTION_ENABLED: z.enum(["true", "false"]).default("false").transform(value => value === "true"),
  TEMPORAL_ALLOW_LEGACY_PLAINTEXT: z.enum(["true", "false"]).default("true").transform(value => value === "true"),
  TEMPORAL_ADDRESS: z.string().default("localhost:7243"),
  TEMPORAL_NAMESPACE: z.string().default("default"),
  TEMPORAL_TASK_QUEUE: z.string().default("oso-workflows"),
  TEMPORAL_WORKER_IDENTITY: z.string().default("oso-temporal-worker"),
  TEMPORAL_RESOURCE_CLOSE_MS: z.coerce.number().int().positive().default(5000),
  TEMPORAL_SHUTDOWN_GRACE_MS: z.coerce.number().int().positive().default(10000),
  TEMPORAL_SHUTDOWN_FORCE_MS: z.coerce.number().int().positive().default(30000),
  TEMPORAL_WORKFLOW_BUNDLE_PATH: z.string().min(1).optional(),
  TEMPORAL_WORKFLOW_BUNDLE_SHA256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  TEMPORAL_TLS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  TEMPORAL_TLS_CA_PATH: z.string().min(1).optional(),
  TEMPORAL_TLS_CLIENT_CERT_PATH: z.string().min(1).optional(),
  TEMPORAL_TLS_CLIENT_KEY_PATH: z.string().min(1).optional(),
  TEMPORAL_TLS_SERVER_NAME: z.string().min(1).optional(),
  TEMPORAL_API_KEY: z.string().min(1).optional(),
  TEMPORAL_UI_BASE_URL: z.string().url().default("http://localhost:8243"),
  INTEGRATION_CREDENTIAL_KEY_VERSION: z.string().min(1).default("dev-v1"),
  INTEGRATION_CREDENTIAL_KEY: z.string().min(32).default("dev-only-integration-credential-key-00000000"),
  INTEGRATION_CREDENTIAL_KEY_RING: credentialKeyRingSchema,
}).superRefine((value, ctx) => {
  if (value.NODE_ENV === "production" && (!value.TEMPORAL_PAYLOAD_ENCRYPTION_ENABLED || value.INTEGRATION_CREDENTIAL_KEY.startsWith("dev-only-"))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["TEMPORAL_PAYLOAD_ENCRYPTION_ENABLED"], message: "Production requires payload encryption and a non-development master key" });
  }
  if (Boolean(value.TEMPORAL_TLS_CLIENT_CERT_PATH) !== Boolean(value.TEMPORAL_TLS_CLIENT_KEY_PATH)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["TEMPORAL_TLS_CLIENT_CERT_PATH"], message: "Temporal client certificate and key must be supplied together" });
  }
  if (!value.TEMPORAL_TLS_ENABLED && (value.NODE_ENV === "production" || value.TEMPORAL_API_KEY || value.TEMPORAL_TLS_CA_PATH
    || value.TEMPORAL_TLS_CLIENT_CERT_PATH || value.TEMPORAL_TLS_CLIENT_KEY_PATH || value.TEMPORAL_TLS_SERVER_NAME)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["TEMPORAL_TLS_ENABLED"], message: "TLS is required in production and for configured transport credentials" });
  }
  if (Boolean(value.TEMPORAL_WORKFLOW_BUNDLE_PATH) !== Boolean(value.TEMPORAL_WORKFLOW_BUNDLE_SHA256)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["TEMPORAL_WORKFLOW_BUNDLE_PATH"], message: "Workflow bundle path and SHA-256 must be supplied together" });
  }
  if (value.TEMPORAL_SHUTDOWN_FORCE_MS <= value.TEMPORAL_SHUTDOWN_GRACE_MS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["TEMPORAL_SHUTDOWN_FORCE_MS"], message: "Force deadline must exceed graceful drain time" });
  }
  const configuredActiveKey = value.INTEGRATION_CREDENTIAL_KEY_RING[value.INTEGRATION_CREDENTIAL_KEY_VERSION];
  if (configuredActiveKey && configuredActiveKey !== value.INTEGRATION_CREDENTIAL_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["INTEGRATION_CREDENTIAL_KEY_RING"],
      message: "INTEGRATION_CREDENTIAL_KEY_RING active version must match INTEGRATION_CREDENTIAL_KEY",
    });
  }
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail loudly at startup rather than silently at runtime.
  console.error("❌ Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = {
  ...parsed.data,
  isDev: parsed.data.NODE_ENV === "development",
  isProd: parsed.data.NODE_ENV === "production",
  isTest: parsed.data.NODE_ENV === "test",
} as const;

export type Config = typeof config;
