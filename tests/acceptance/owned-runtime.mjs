import assert from "node:assert/strict";
import { readFile, realpath, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

/** Linux acceptance harness: prove an owned app/profile before HTTP or CDP. */
let checkpoint="manifest";
async function verifyOwnedAcceptance(browser = false) {
  if (!process.env.PLATFORM_TEST_MANIFEST || !process.env.PLATFORM_TEST_DATABASE_URL || !process.env.APP_BASE_URL) {
    throw Error("Acceptance requires an owned manifest, explicit database URL and APP_BASE_URL; no existing app/browser fallback");
  }
  const manifest = JSON.parse(await readFile(process.env.PLATFORM_TEST_MANIFEST, "utf8"));
  assert.equal(manifest.owner, "mvc-boilerplate-platform-tests");
  assert.match(manifest.runId, /^[a-f0-9-]{36}$/);
  assert.equal(manifest.database.name, `bp_platform_${manifest.runId.replaceAll("-", "")}`);
  const database = new URL(process.env.PLATFORM_TEST_DATABASE_URL);
  assert.equal(database.hostname, manifest.database.host); assert.equal(Number(database.port), manifest.database.port);
  assert.equal(database.pathname, `/${manifest.database.name}`);
  assert.equal(manifest.artifactDirectory.endsWith(`/platform-${manifest.runId}`), true);
  checkpoint="application URL";
  const app = new URL(process.env.APP_BASE_URL);
  assert.equal(app.protocol, "http:"); assert.equal(app.hostname, "127.0.0.1"); assert.equal(Number(app.port), manifest.appPort);
  assert(Number.isSafeInteger(manifest.appPid) && manifest.appPid > 1, "Owned app PID is required");
  checkpoint="application process";
  const fields = (await readFile(`/proc/${manifest.appPid}/environ`, "utf8")).split("\0");
  const environment = Object.fromEntries(fields.filter(Boolean).map(field => { const pos = field.indexOf("="); return [field.slice(0, pos), field.slice(pos + 1)]; }));
  assert.equal(environment.NODE_ENV, "test"); assert.equal(environment.PLATFORM_TEST_RUN_ID, manifest.runId);
  assert.equal(environment.PORT, String(manifest.appPort)); assert(environment.DATABASE_URL === database.toString(), "Owned application database mismatch");
  checkpoint="browser process";
  if (browser) {
    assert(Number.isSafeInteger(manifest.browserPid) && manifest.browserPid > 1, "Owned browser PID is required");
    const args = (await readFile(`/proc/${manifest.browserPid}/cmdline`, "utf8")).split("\0");
    const profile = resolve(manifest.artifactDirectory, "browser-profile");
    checkpoint="browser profile";
    assert.equal(await realpath(profile), profile, "Browser profile must not redirect to another profile");
    checkpoint="browser arguments";
    const containsFlag = flag => args.includes(flag) || args.some(arg=>arg.split(" ").length>1 && (` ${arg} `).includes(` ${flag} `));
    assert(containsFlag(`--user-data-dir=${profile}`));
    assert((await readlink(resolve(profile,"SingletonLock"))).endsWith(`-${manifest.browserPid}`),"Owned profile lock PID mismatch");
    checkpoint="browser debug port";
    assert(containsFlag(`--remote-debugging-port=${manifest.browserPort}`));
  }
  checkpoint="database sentinel";
  const prisma = new PrismaClient({ datasources: { db: { url: database.toString() } } });
  try { assert.deepEqual(await prisma.$queryRaw`SELECT run_id FROM platform_test.ownership`, [{ run_id: manifest.runId }]); }
  finally { await prisma.$disconnect(); }
  return { base: app.origin, browserBase: `http://127.0.0.1:${manifest.browserPort}`, databaseUrl: database.toString(), manifest };
}

export async function requireOwnedAcceptance(browser = false) {
  try { return await verifyOwnedAcceptance(browser); }
  catch { throw Error("Acceptance requires a verified owned app/database manifest and, for browser runs, an isolated owned profile; no existing runtime fallback ("+checkpoint+")"); }
}
