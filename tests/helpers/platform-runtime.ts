import { z } from "zod";

const endpoint = z.object({ host: z.string().min(1), port: z.number().int().min(1).max(65535) }).strict();
const manifestSchema = z.object({
  owner: z.literal("mvc-boilerplate-platform-tests"),
  runId: z.string().uuid(),
  database: endpoint.extend({ name: z.string().min(1) }),
  temporal: endpoint.extend({ namespace: z.string().min(1), taskQueue: z.string().min(1) }),
  redis: endpoint.extend({ database: z.number().int().min(1).max(15) }),
  mail: endpoint,
  appPort: z.number().int().min(1024).max(65535),
  browserPort: z.number().int().min(1024).max(65535),
  artifactDirectory: z.string().min(1),
  appPid: z.number().int().min(2).optional(),
  browserPid: z.number().int().min(2).optional(),
}).strict();

/** Validation is deliberately pure and performs no connection/migration. */
export function validatePlatformRuntime(raw: unknown, databaseUrl: string | undefined, applicationDatabaseUrl?: string) {
  const fail = () => { throw new Error("Platform tests require an explicit owned runtime manifest and matching database destination"); };
  if (!databaseUrl) return fail();
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) return fail();
  const manifest = parsed.data;
  const suffix = manifest.runId.replaceAll("-", "");
  let url: URL;
  try { url = new URL(databaseUrl); } catch { return fail(); }
  if (!["postgresql:", "postgres:"].includes(url.protocol) || url.hostname !== manifest.database.host || Number(url.port || "5432") !== manifest.database.port
    || decodeURIComponent(url.pathname.slice(1)) !== manifest.database.name || manifest.database.name !== `bp_platform_${suffix}`
    || manifest.temporal.namespace !== `bp-platform-${manifest.runId}` || manifest.temporal.taskQueue !== `bp-platform-${manifest.runId}`
    || !manifest.artifactDirectory.endsWith(`/platform-${manifest.runId}`)) return fail();
  if (applicationDatabaseUrl) {
    let app: URL;
    try { app = new URL(applicationDatabaseUrl); } catch { return fail(); }
    if (app.hostname === url.hostname && Number(app.port || "5432") === Number(url.port || "5432") && app.pathname === url.pathname) return fail();
  }
  return manifest;
}
