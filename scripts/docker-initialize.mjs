// Local Compose bootstrap only. Never called by the web or Worker processes.
import { spawnSync } from "node:child_process";
import { access, mkdir, writeFile, rename } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
const run = args => {
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  if (result.status !== 0) throw Error("Local database initialization failed");
};
run(["node_modules/prisma/build/index.js", "migrate", "deploy"]);
if (process.env.BOOTSTRAP_DEMO_DATA === "true") {
  const directory = "/app/var/bootstrap";
  const completed = `${directory}/demo-seeded`;
  const pending = `${directory}/demo-seeding`;
  const exists = path => access(path).then(() => true, () => false);
  await mkdir(directory, { recursive: true });
  if (await exists(completed)) {
    console.log("Demo seed already completed; preserving current data");
  } else {
    const db = new PrismaClient();
    let users;
    try { users = await db.user.count(); } finally { await db.$disconnect(); }
    if (users === 0 || await exists(pending)) {
      await writeFile(pending, "Local demo initialization in progress\n");
      run(["node_modules/tsx/dist/cli.mjs", "prisma/seed.ts"]);
      await rename(pending, completed);
      console.log("First-run demo data initialized");
    } else {
      console.log("Existing users found; skipping demo seed to preserve application data");
    }
  }
}
