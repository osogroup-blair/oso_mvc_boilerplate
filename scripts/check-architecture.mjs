import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Static checks cover literal imports/re-exports, require() and import(). */
export function checkSource(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const errors = [];
  const add = (node, message) => errors.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`);
  const isTypeOnly = node => {
    if (ts.isExportDeclaration(node)) return node.isTypeOnly;
    if (!ts.isImportDeclaration(node)) return false;
    const clause = node.importClause;
    return clause?.isTypeOnly || (!clause?.name && clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
      && clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every(item => item.isTypeOnly));
  };
  function inspectImport(node, specifier) {
    if (isTypeOnly(node)) return;
    const target = specifier.startsWith(".") ? path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier)) : specifier;
    const models = target.startsWith("src/models/");
    const services = target.startsWith("src/services/");
    const controllers = target.startsWith("src/controllers/");
    const routes = target.startsWith("src/routes/");
    if (file.startsWith("src/controllers/") && models) add(node, "Controllers call services, not models");
    if (file.startsWith("src/routes/") && (services || models)) add(node, "Routes call controllers/middleware, not services/models");
    if (file.startsWith("src/models/") && (services || controllers || routes)) add(node, "Models must not depend on services/controllers/routes");
    if (file.startsWith("src/temporal/activities/") && (models || controllers || routes)) add(node, "Activities call services/adapters, not models/controllers/routes");
    if (file.startsWith("src/views/helpers/") && (models || services || controllers || routes)) add(node, "View helpers receive data; they cannot fetch through application layers");
    if (file.startsWith("src/temporal/workflows/") && (models || services || controllers || routes || target.startsWith("src/config/") || specifier.startsWith("node:")
      || ["fs", "path", "crypto", "http", "https", "url", "os", "process"].includes(specifier))) add(node, "Workflow imports must be deterministic");
    if (file.startsWith("src/temporal/workflows/") && (target.startsWith("src/integrations/") || target.startsWith("src/temporal/workflow-registry")))
      add(node, "Workflows may import integration providers and the workflow registry as types only (import type); see skills/SKILL-temporal.md");
    if (file.startsWith("src/integrations/") && (models || services || controllers || routes || target.startsWith("src/config/") || target.startsWith("src/temporal/")
      || target === "src/lib/prisma.js" || target === "src/lib/prisma"))
      add(node, "Integration providers receive config/credentials from resolvers; they must not import application layers, config, or Temporal code");
    if (file.startsWith("src/integrations/providers/") && ["node:http", "node:https", "node:net", "node:dns", "http", "https", "net", "dns", "undici"].includes(specifier))
      add(node, "Providers make network calls only through src/integrations/http.ts (createProviderHttpClient)");
    if ((target === "src/lib/prisma.js" || target === "src/lib/prisma") && !file.startsWith("src/models/")) {
      const clause = ts.isImportDeclaration(node) ? node.importClause : undefined;
      const cleanupOnly = clause?.namedBindings && ts.isNamedImports(clause.namedBindings) && !clause.name
        && clause.namedBindings.elements.every(item => (item.propertyName ?? item.name).text === "closeDatabase");
      if (!cleanupOnly || !["src/server.ts", "src/services/worker-resources.service.ts"].includes(file)) add(node, "Only models may import the Prisma client; lifecycle owners may import closeDatabase only");
    }
    if (specifier === "@prisma/client" && !file.startsWith("src/models/") && file !== "src/lib/prisma.ts"
      && /\bPrismaClient\b/.test(node.getText(source))) add(node, "PrismaClient belongs only in the database seam/models");
    if (specifier.startsWith(".") && !specifier.endsWith(".js") && !specifier.endsWith(".json")) add(node, "Relative runtime imports require .js extensions");
  }
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) inspectImport(node, node.moduleSpecifier.text);
    if (file.startsWith("src/integrations/providers/") && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "fetch")
      add(node, "Providers make network calls only through src/integrations/http.ts (createProviderHttpClient)");
    if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === "require") && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) inspectImport(node, node.arguments[0].text);
    if (!file.startsWith("src/config/") && ((ts.isPropertyAccessExpression(node) && node.expression.getText(source) === "process" && node.name.text === "env")
      || (ts.isElementAccessExpression(node) && node.expression.getText(source) === "process" && node.argumentExpression && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "env"))) add(node, "Read environment only through typed config");
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}

async function walk(directory) {
  const files = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const name = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await walk(name));
    else if (name.endsWith(".ts")) files.push(name);
  }
  return files;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = [];
  for (const file of await walk("src")) errors.push(...checkSource(file.split(path.sep).join("/"), await fs.readFile(file, "utf8")));
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("Architecture boundaries: PASS");
}
