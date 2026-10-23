import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { verifiedWorkflowBundle } from "../../src/temporal/workflow-bundle.js";

it("loads only the release bytes matching the configured replay artifact digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "bp-release-bundle-"));
  try {
    const code = "synthetic release bundle";
    const file = join(root, "workflows.js"); await writeFile(file, code);
    const hash = createHash("sha256").update(code).digest("hex");
    expect(await verifiedWorkflowBundle(file, hash)).toEqual({ code });
    await writeFile(file, `${code} changed`);
    await expect(verifiedWorkflowBundle(file, hash)).rejects.toThrow("mismatch");
    await expect(verifiedWorkflowBundle(file, "missing")).rejects.toThrow("Invalid");
  } finally { await rm(root, { recursive: true, force: true }); }
});
