import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { config } from "../config/index.js";

export interface CommandMetadata { operationId: string; requestHash: string }

/** A keyed request fingerprint cannot be used as an offline password verifier. */
export function commandMetadata(input: unknown, operationId: string = randomUUID()): CommandMetadata {
  z.string().uuid().parse(operationId);
  const canonical = JSON.stringify(input, (_key, value) => value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]])) : value);
  return { operationId, requestHash: createHmac("sha256", config.JWT_SECRET).update("model-command-v1\0").update(canonical ?? "null").digest("hex") };
}
