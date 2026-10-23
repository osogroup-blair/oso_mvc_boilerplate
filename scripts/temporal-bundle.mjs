import { bundleWorkflowCode } from "@temporalio/worker";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { digest, workflowTypes } from "./lib/temporal-replay-contract.mjs";

const output = resolve(process.argv[2] ?? "artifacts/temporal-release/workflows.js");
const workflowsPath = resolve("dist/temporal/workflows/index.js");
const types = workflowTypes(workflowsPath);
const { code } = await bundleWorkflowCode({ workflowsPath });
await mkdir(dirname(output), { recursive: true });
await writeFile(output, code);
const manifest = { version: 1, sha256: digest(code), lockfileSha256: digest(await readFile("package-lock.json")), workflowTypes: types };
await writeFile(`${output}.manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify({ bundle: output, ...manifest }));
