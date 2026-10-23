// Single Prisma client instance, reused across the app.
import { PrismaClient } from "@prisma/client";
import { logger } from "./logger.js";

export const prisma = new PrismaClient({
  // Raw driver messages can contain SQL values or provider-supplied content.
  log: [{ emit: "event", level: "warn" }, { emit: "event", level: "error" }],
});
prisma.$on("error", () => logger.error({ code: "DATABASE_QUERY_FAILED" }, "Database query failed"));
prisma.$on("warn", () => logger.warn({ code: "DATABASE_WARNING" }, "Database warning"));

/** Process lifecycle only; application queries stay in models. */
export async function closeDatabase() { await prisma.$disconnect(); }
