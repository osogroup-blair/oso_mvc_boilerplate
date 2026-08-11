// Typed, validated environment config.
// Reading process.env anywhere else in the app is discouraged — import from here.
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 chars"),
  SESSION_TTL_HOURS: z.coerce.number().default(24),
  REDIS_URL: z.string().default("redis://localhost:6380"),
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
