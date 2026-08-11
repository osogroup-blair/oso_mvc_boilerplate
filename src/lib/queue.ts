/**
 * Shared Redis connection and Queue factory for BullMQ.
 *
 * The connection is created lazily: if Redis is unreachable the rest of the
 * app continues to work — email sends fall back to synchronous mode.
 */
import { Queue, QueueOptions } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config/index.js";
import { logger } from "./logger.js";

// A single shared connection reused across all queues and workers.
export let redisConnection: IORedis | null = null;
let redisAvailable = false;

export function getRedisConnection(): IORedis | null {
  return redisConnection;
}

export function isRedisAvailable(): boolean {
  return redisAvailable;
}

export async function initRedis(): Promise<void> {
  try {
    const conn = new IORedis(config.REDIS_URL, {
      maxRetriesPerRequest: null, // required by BullMQ
      enableReadyCheck: false,
      lazyConnect: true,
    });

    await conn.connect();
    redisConnection = conn;
    redisAvailable = true;
    logger.info({ url: config.REDIS_URL }, "Redis connected");

    conn.on("error", (err) => {
      logger.warn({ err }, "Redis connection error — falling back to synchronous mode");
      redisAvailable = false;
    });

    conn.on("reconnecting", () => {
      logger.info("Redis reconnecting...");
    });

    conn.on("ready", () => {
      redisAvailable = true;
      logger.info("Redis ready");
    });
  } catch (err) {
    logger.warn({ err }, "Could not connect to Redis — job queue disabled, emails will fire synchronously");
    redisAvailable = false;
  }
}

/**
 * Create a named BullMQ Queue. Returns null if Redis is unavailable.
 */
export function createQueue(name: string, options?: Omit<QueueOptions, "connection">): Queue | null {
  if (!redisConnection) return null;
  return new Queue(name, { connection: redisConnection, ...options });
}

// Named queues — created after initRedis() is called in server.ts
export let emailQueue: Queue | null = null;

export function initQueues() {
  emailQueue = createQueue("email", {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });
}
