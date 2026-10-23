import { it, expect } from "vitest";
import { spawnSync } from "node:child_process";

it("refuses legacy acceptance before browser/HTTP/database access when ownership is absent", () => {
  const environment = { ...process.env };
  delete environment.PLATFORM_TEST_MANIFEST; delete environment.PLATFORM_TEST_DATABASE_URL; delete environment.APP_BASE_URL;
  for (const file of ["browser-acceptance-test.mjs", "upload-smoke-test.mjs"]) {
    const result = spawnSync(process.execPath, [`tests/acceptance/${file}`], { env: environment, encoding: "utf8", timeout: 5000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Acceptance requires a verified owned app/database manifest");
  }
});
