// Single Prisma client instance, reused across the app.
import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";

export const prisma = new PrismaClient({
  log: config.isDev ? ["warn", "error"] : ["error"],
});
