import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function verifiedWorkflowBundle(path: string, expectedSha256: string) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw Error("Invalid Workflow bundle digest");
  const bytes = await readFile(path);
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha256) throw Error("Workflow bundle digest mismatch");
  return { code: bytes.toString("utf8") };
}
