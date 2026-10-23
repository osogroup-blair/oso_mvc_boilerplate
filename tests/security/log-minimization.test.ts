import express from "express";
import { it, expect } from "vitest";
import { logger, logRingBuffer } from "../../src/lib/logger.js";
import { requestLogger } from "../../src/middleware/requestLogger.js";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import { requestId } from "../../src/middleware/requestId.js";

it("excludes token paths, headers, error payloads and common secret fields from general logs", async () => {
  const canary = "PRIVATE-SYNTHETIC-LOG-CANARY";
  logger.error({ err: new Error(canary), token: canary, credentials: { secret: canary }, nested: { password: canary } }, "Synthetic failure");
  const app = express(); app.use(requestId); app.use(requestLogger);
  app.get("/workflow-task-tokens/:token", (_req, _res, next) => next(new Error(canary)));
  app.use(errorHandler);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  try {
    const address = server.address(); if (!address || typeof address === "string") throw Error("Missing owned listener");
    const response = await fetch(`http://127.0.0.1:${address.port}/workflow-task-tokens/${canary}?token=${canary}`, {
      headers: { authorization: `Bearer ${canary}`, cookie: `session=${canary}`, "x-request-id": canary, accept: "application/json" },
    });
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain(canary);
    const logs = logRingBuffer.getAll().join("");
    expect(logs).not.toContain(canary);
    expect(logs).toContain("INTERNAL_ERROR");
    expect(logs).toContain("/workflow-task-tokens/:token");
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
