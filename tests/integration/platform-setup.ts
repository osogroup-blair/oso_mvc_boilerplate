import { readFileSync } from "node:fs";
import { validatePlatformRuntime } from "../helpers/platform-runtime.js";

// No dotenv, default destination, migration, seed, reset or cleanup here.
const manifestPath = process.env.PLATFORM_TEST_MANIFEST;
if (!manifestPath) throw new Error("PLATFORM_TEST_MANIFEST is required");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const owned = validatePlatformRuntime(manifest, process.env.PLATFORM_TEST_DATABASE_URL, process.env.DATABASE_URL);
process.env.DATABASE_URL = process.env.PLATFORM_TEST_DATABASE_URL;
process.env.NODE_ENV = "test";
process.env.TEMPORAL_ADDRESS = `${owned.temporal.host}:${owned.temporal.port}`;
process.env.TEMPORAL_NAMESPACE = owned.temporal.namespace;
process.env.TEMPORAL_TASK_QUEUE = owned.temporal.taskQueue;
process.env.REDIS_URL = `redis://${owned.redis.host}:${owned.redis.port}/${owned.redis.database}`;
process.env.PORT = String(owned.appPort);

// Destination names alone do not establish ownership. This read is the first
// database operation; an unknown/missing sentinel aborts before tests mutate.
const { prisma } = await import("../../src/lib/prisma.js");
const rows = await prisma.$queryRaw<Array<{ run_id: string }>>`SELECT run_id FROM platform_test.ownership`;
if (rows.length !== 1 || rows[0].run_id !== owned.runId) throw new Error("Database ownership sentinel mismatch");
