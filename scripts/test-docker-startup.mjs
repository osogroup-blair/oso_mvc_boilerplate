// Actual image/Compose smoke test. Creates and removes only a random owned project.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const project = `bp-docker-${randomUUID()}`;
const directory = resolve(`artifacts/docker-${project}`);
await mkdir(directory, { recursive: true });
const freePort = () => new Promise(resolve => {
  const server = createServer().listen(0, "127.0.0.1", () => {
    const port = server.address().port; server.close(() => resolve(port));
  });
});
const port = await freePort(); const uiPort = await freePort();
const env = { ...process.env, BOILERPLATE_HTTP_PORT: String(port), BOILERPLATE_TEMPORAL_UI_PORT: String(uiPort) };
const run = args => {
  const result = spawnSync("docker", args, { env, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, `Docker command failed: ${args.slice(0, 3).join(" ")}\n${result.stderr}`);
  return result.stdout;
};
const compose = args => run(["compose", "--env-file", "/dev/null", "--project-name", project, ...args]);
const verifyOwnership = () => {
  const ids = compose(["ps", "--all", "--quiet"]).trim().split(/\s+/).filter(Boolean);
  assert(ids.length > 0);
  for (const item of JSON.parse(run(["inspect", ...ids]))) assert.equal(item.Config.Labels["com.docker.compose.project"], project);
  const volumes = run(["volume", "ls", "--quiet", "--filter", `label=com.docker.compose.project=${project}`]).trim().split(/\s+/).filter(Boolean);
  for (const volume of volumes) assert.equal(JSON.parse(run(["volume", "inspect", volume]))[0].Labels["com.docker.compose.project"], project);
};
const request = (url, options = {}) => fetch(url, { ...options, headers: { ...options.headers, connection: "close" }, signal: AbortSignal.timeout(20000) });
const checks = [];
let created = false;
const base = `http://127.0.0.1:${port}`;
try {
  created = true; compose(["up", "-d", "--wait", "--wait-timeout", "240"]); verifyOwnership();
  const services = JSON.parse("[" + compose(["ps", "--all", "--format", "json"]).trim().split("\n").join(",") + "]");
  for (const name of ["web", "worker", "db", "redis", "temporal", "temporal-postgres", "temporal-ui"]) assert.equal(services.find(item => item.Service === name)?.Health, "healthy", name);
  const home = await request(base + "/"); assert.equal(home.status, 200); const homeHtml = await home.text(); assert(homeHtml.includes("Skip the setup.")); assert(homeHtml.includes('id="features"'));
  const guide = await request(base + "/getting-started"); assert.equal(guide.status, 200);
  assert.equal((await request(base + "/css/getting-started.css")).status, 200); assert.equal((await request(base + "/js/getting-started.js")).status, 200);
  const health = await request(base + "/health").then(r => r.json()); assert.equal(health.data.status, "up");
  assert.equal((await request(`http://127.0.0.1:${uiPort}`)).status, 200);
  const css = await request(base + "/css/app.css"); assert.equal(css.status, 200); assert((await css.text()).length > 1000);
  const jar = new Map();
  const remember = response => { for (const cookie of response.headers.getSetCookie()) { const pair = cookie.split(";")[0]; const at = pair.indexOf("="); jar.set(pair.slice(0, at), pair.slice(at + 1)); } };
  const cookies = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
  const login = await request(base + "/admin/login"); remember(login);
  const html = await login.text(); const token = html.match(/name="_csrf"\s+value="([^"]+)"/)[1];
  const loggedIn = await request(base + "/admin/login", { method: "POST", redirect: "manual", headers: { cookie: cookies(), "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ email: "alice@example.com", password: "password123", _csrf: token }) });
  remember(loggedIn); assert.equal(loggedIn.status, 302); assert.equal(loggedIn.headers.get("location"), "/admin");
  assert.equal((await request(base + "/admin", { headers: { cookie: cookies() }, redirect: "manual" })).status, 200);
  assert.equal((await request(base + "/projects", { method: "POST", headers: { cookie: cookies(), "content-type": "application/x-www-form-urlencoded" }, body: "name=NoCSRF" })).status, 403);
  const board = await request(base + "/admin/jobs/api/queues", { headers: { cookie: cookies() } }); assert.equal(board.status, 200); assert((await board.text()).includes('"email"'));
  checks.push("fresh image: all services healthy; real login/CSRF, CSS, queue and Temporal UI");
  const canary = JSON.parse(compose(["exec", "-T", "worker", "node", "scripts/temporal-canary.mjs"]).trim()); assert.equal(canary.status, "PASS");
  checks.push("actual container Worker Workflow/Activity/database canary");
  compose(["exec", "-T", "web", "sh", "-c", "test ! -f /app/.env && test $(id -u) -ne 0"]);
  compose(["exec", "-T", "web", "node", "--input-type=module", "-e", `import { PrismaClient } from '@prisma/client'; import { writeFile } from 'node:fs/promises'; const db=new PrismaClient(); await db.user.update({where:{email:'alice@example.com'},data:{name:'Docker persistence probe'}}); await db.$disconnect(); await writeFile('/app/public/uploads/persistence.txt','public-persist'); await writeFile('/app/var/private-assets/persistence.txt','private-persist');`]);
  checks.push("non-root container and no host dotenv baked into image");
  verifyOwnership(); compose(["down"]); compose(["up", "-d", "--wait", "--wait-timeout", "240"]); verifyOwnership();
  assert(compose(["logs", "--no-color", "initialize"]).includes("Demo seed already completed"));
  compose(["exec", "-T", "web", "node", "--input-type=module", "-e", `import assert from 'node:assert/strict'; import { PrismaClient } from '@prisma/client'; import { readFile } from 'node:fs/promises';const db=new PrismaClient(); assert.equal((await db.user.findUniqueOrThrow({where:{email:'alice@example.com'}})).name,'Docker persistence probe'); await db.$disconnect(); assert.equal(await readFile('/app/public/uploads/persistence.txt','utf8'),'public-persist'); assert.equal(await readFile('/app/var/private-assets/persistence.txt','utf8'),'private-persist');`]);
  assert.equal((await request(base + "/uploads/persistence.txt")).status, 200); assert.equal((await request(base + "/var/private-assets/persistence.txt")).status, 404);
  checks.push("down/up preserves edited data, public/private volumes and does not reseed");
  await writeFile(resolve(directory, "result.json"), JSON.stringify({ result: "PASS", project, checks, ports: { web: port, temporalUi: uiPort }, imageId: run(["image", "inspect", "mvc-boilerplate:local", "--format", "{{.Id}}"]).trim(), services }, null, 2));
  console.log(JSON.stringify({ result: "PASS", checks, evidence: directory }, null, 2));
} finally {
  if (created) {
    await writeFile(resolve(directory, "compose.log"), compose(["logs", "--no-color", "--tail", "100", "initialize", "web", "worker"]));
    verifyOwnership(); compose(["down", "--volumes", "--remove-orphans"]);
  }
}
