import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { reviewedHistories, digest, workflowTypes } from "../../scripts/lib/temporal-replay-contract.mjs";

it("inventories child exports and blocks the empty historical corpus", async () => {
  const types = workflowTypes(resolve("src/temporal/workflows/index.ts"));
  expect(types).toContain("underwritingRiskCheckChildWorkflow");
  expect(types).toContain("clientEngagementWorkstreamWorkflow");
  await expect(reviewedHistories(resolve("tests/temporal/replay/manifest.json"), types)).rejects.toThrow("BLOCKED");
});

it("requires integrity, type, child and reviewed branch coverage before any replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "bp-replay-contract-"));
  try {
    const bytes = JSON.stringify({ events: [{ workflowExecutionStartedEventAttributes: { workflowType: { name: "parent" } } }] });
    await writeFile(join(root, "parent.json"), bytes);
    const entry = { file: "parent.json", workflowId: "prior-parent-1", workflowType: "parent", sourceRelease: "previous", branch: "waiting", reviewed: true, synthetic: true, sha256: digest(bytes) };
    const manifest = { version: 1, supportedReleases: ["previous"], requiredCases: [{ workflowType: "parent", sourceRelease: "previous", branch: "waiting" }], histories: [entry] };
    const save = () => writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await save();
    await expect(reviewedHistories(join(root, "manifest.json"), ["parent", "child"])).rejects.toThrow("child");
    expect(await reviewedHistories(join(root, "manifest.json"), ["parent"])).toHaveLength(1);
    manifest.requiredCases[0].branch = "cancelled"; await save();
    await expect(reviewedHistories(join(root, "manifest.json"), ["parent"])).rejects.toThrow("branch");
    manifest.requiredCases[0].branch = "waiting"; entry.sha256 = "0".repeat(64); await save();
    await expect(reviewedHistories(join(root, "manifest.json"), ["parent"])).rejects.toThrow("digest");
  } finally { await rm(root, { recursive: true, force: true }); }
});
