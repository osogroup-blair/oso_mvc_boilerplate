import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest, reviewedHistories, workflowTypes } from "./lib/temporal-replay-contract.mjs";

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const separator = arg.indexOf("=");
  if (!arg.startsWith("--") || separator < 3) throw Error("Use --name=value arguments");
  return [arg.slice(2, separator), arg.slice(separator + 1)];
}));
const manifestPath = resolve(args.manifest ?? "tests/temporal/replay/manifest.json");
const types = workflowTypes(resolve("dist/temporal/workflows/index.js"));
// Validate corpus before native SDK startup. An empty corpus is never a pass.
const histories = await reviewedHistories(manifestPath, types);
if (!args.bundle || !/^[a-f0-9]{64}$/.test(args["bundle-sha256"] ?? "")) throw Error("Require release --bundle and --bundle-sha256");
const bundle = await readFile(args.bundle);
if (digest(bundle) !== args["bundle-sha256"]) throw Error("Release bundle digest mismatch");
const metadata = JSON.parse(await readFile(`${args.bundle}.manifest.json`, "utf8"));
if (metadata.sha256 !== digest(bundle) || metadata.lockfileSha256 !== digest(await readFile("package-lock.json"))
  || JSON.stringify(metadata.workflowTypes) !== JSON.stringify(types)) throw Error("Release bundle metadata mismatch");
const { temporalDataConverter } = await import("../dist/lib/temporalPayload.js");
const { Worker } = await import("@temporalio/worker");
for (const { entry, history } of histories) {
  await Worker.runReplayHistory({ workflowBundle: { code: bundle.toString() }, dataConverter: temporalDataConverter }, history, entry.workflowId);
  console.log(`PASS ${entry.workflowType} / ${entry.branch} from ${entry.sourceRelease}`);
}
