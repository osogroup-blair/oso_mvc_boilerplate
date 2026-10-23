import { describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.js";
import { validatePlatformRuntime } from "../helpers/platform-runtime.js";
const runId = "771ca5be-6507-40ef-b781-aecbcad883ad";
const manifest = {
  owner: "mvc-boilerplate-platform-tests", runId,
  database: { host: "127.0.0.1", port: 55439, name: `bp_platform_${runId.replaceAll("-", "")}` },
  temporal: { host: "127.0.0.1", port: 17243, namespace: `bp-platform-${runId}`, taskQueue: `bp-platform-${runId}` },
  redis: { host: "127.0.0.1", port: 16379, database: 14 }, mail: { host: "127.0.0.1", port: 11025 },
  appPort: 13119, browserPort: 19225, artifactDirectory: `/tmp/platform-${runId}`,
};
const url = `postgresql://synthetic:synthetic@127.0.0.1:55439/${manifest.database.name}`;
describe("unit and integration isolation", () => {
  it("overrides any inherited database and blocks query/transaction access", () => {
    expect(process.env.DATABASE_URL).toBe("postgresql://unit:unit@127.0.0.1:1/unit_test_no_database");
    expect(() => prisma.user.findMany()).toThrow("Unexpected database access");
    expect(() => prisma.$transaction([])).toThrow("Unexpected database access");
    expect(() => prisma.$queryRaw`SELECT 1`).toThrow("Unexpected database access");
  });
  it("accepts only the exact explicit owned destination without connecting", () => {
    expect(validatePlatformRuntime(manifest, url)).toEqual(manifest);
    for (const bad of [undefined, url.replace("55439", "5432"), url.replace(manifest.database.name, "boilerplate")]) {
      expect(() => validatePlatformRuntime(manifest, bad)).toThrow("owned runtime");
    }
    expect(() => validatePlatformRuntime(manifest, url, url)).toThrow("owned runtime");
    expect(() => validatePlatformRuntime({ ...manifest, owner: "another-team" }, url)).toThrow("owned runtime");
    expect(() => validatePlatformRuntime({ ...manifest, temporal: { ...manifest.temporal, namespace: "default" } }, url)).toThrow("owned runtime");
  });
});
