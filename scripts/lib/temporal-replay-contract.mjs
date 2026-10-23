import { readFile, realpath } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";

export const digest = bytes => createHash("sha256").update(bytes).digest("hex");

/** Read function exports without executing Workflow code outside its sandbox. */
export function workflowTypes(entry) {
  const program = ts.createProgram([entry], { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler, module: ts.ModuleKind.ESNext, skipLibCheck: true });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const module = source && checker.getSymbolAtLocation(source);
  if (!module) throw Error("Cannot inspect Workflow entry point");
  const names = checker.getExportsOfModule(module).filter(symbol => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    return target.declarations?.some(node => ts.isFunctionDeclaration(node)
      || ts.isVariableDeclaration(node) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)));
  }).map(symbol => symbol.name).sort();
  if (!names.length) throw Error("BLOCKED: no Workflow function exports inventoried");
  return names;
}

export async function reviewedHistories(manifestPath, requiredTypes) {
  const root = await realpath(dirname(manifestPath));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== 1 || !manifest.histories?.length || !manifest.supportedReleases?.length || !manifest.requiredCases?.length) {
    throw Error("BLOCKED: reviewed prior releases, branch requirements and histories are required");
  }
  const required = new Set(requiredTypes);
  const covered = new Set();
  const releases = new Set();
  const cases = new Set();
  const result = [];
  for (const entry of manifest.histories) {
    if (!entry.file || typeof entry.workflowId !== "string" || !entry.workflowId || !required.has(entry.workflowType) || !manifest.supportedReleases.includes(entry.sourceRelease)
      || !entry.branch || entry.synthetic !== true || entry.reviewed !== true || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? "")) throw Error("Invalid or unreviewed history metadata");
    const file = await realpath(resolve(root, entry.file));
    if (!file.startsWith(root + sep)) throw Error("History path escapes fixture root");
    const bytes = await readFile(file);
    if (digest(bytes) !== entry.sha256) throw Error(`History digest mismatch: ${entry.file}`);
    const parsed = JSON.parse(bytes.toString());
    if (entry.historyFormat && !["protobuf-json", "temporal-json"].includes(entry.historyFormat)) throw Error("Unsupported history format");
    const { default: proto } = await import("@temporalio/proto");
    const history = entry.historyFormat === "protobuf-json" ? proto.temporal.api.history.v1.History.fromObject(parsed) : parsed;
    const started = history.events?.find(event => event.workflowExecutionStartedEventAttributes)?.workflowExecutionStartedEventAttributes;
    if (started?.workflowType?.name !== entry.workflowType) throw Error(`History type mismatch: ${entry.file}`);
    covered.add(entry.workflowType); releases.add(entry.sourceRelease);
    cases.add(JSON.stringify([entry.workflowType, entry.sourceRelease, entry.branch]));
    result.push({ entry, history });
  }
  for (const type of required) if (!covered.has(type)) throw Error(`BLOCKED: missing Workflow history: ${type}`);
  for (const release of manifest.supportedReleases) if (!releases.has(release)) throw Error(`BLOCKED: missing supported release: ${release}`);
  for (const item of manifest.requiredCases) {
    if (!required.has(item.workflowType) || !manifest.supportedReleases.includes(item.sourceRelease) || !item.branch
      || !cases.has(JSON.stringify([item.workflowType, item.sourceRelease, item.branch]))) throw Error("BLOCKED: missing required release/branch history");
  }
  return result;
}
