import { resolve, relative, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config/index.js";
import { AppError } from "./AppError.js";
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const reserved = new Set(["admin", "api", "css", "js", "fonts", "health", "pages", "projects", "workflows", "workflow-tasks", "workflow-task-tokens", "auth", "getting-started"]);
export function publicStorageLocation(directory: string, prefix: string) {
  const root = resolve(rootDir, directory);
  const publicRelative = relative(resolve(rootDir, "public"), root);
  const privateRoot = resolve(rootDir, config.PRIVATE_ASSET_ROOT ?? "var/private-assets");
  if (root === rootDir || root === privateRoot || root.startsWith(privateRoot + "/") || privateRoot.startsWith(root + "/")
    || !publicRelative || !publicRelative.startsWith("..") && /^(css|js|fonts)(?:[/\\]|$)/i.test(publicRelative)
    || publicRelative.startsWith("..") && !["uploads", "public-assets"].includes(basename(root))) throw AppError.badRequest("Uploads require a dedicated public storage directory");
  if (!/^\/[a-zA-Z0-9_/-]+$/.test(prefix) || prefix.includes("//") || prefix.endsWith("/") || reserved.has(prefix.split("/")[1].toLowerCase())) throw AppError.badRequest("Invalid public upload prefix");
  return { directory: root, prefix };
}
