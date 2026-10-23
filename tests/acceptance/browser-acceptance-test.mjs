import { requireOwnedAcceptance } from "./owned-runtime.mjs";
const { base, browserBase } = await requireOwnedAcceptance(true);
const pageTargetResponse = await fetch(`${browserBase}/json/new?about:blank`, { method: "PUT" });
if (!pageTargetResponse.ok) throw Error("Cannot create a fresh owned browser tab");
const pageTarget = await pageTargetResponse.json();
const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const listeners = new Map();
const results = [];

function record(name, passed, details = {}) {
  results.push({ name, passed, ...details });
}

ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  const callbacks = listeners.get(message.method) ?? [];
  for (const callback of callbacks) callback(message.params);
});

await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve, { once: true });
  ws.addEventListener("error", reject, { once: true });
});

function send(method, params = {}) {
  const id = nextId++;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function once(method, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const callbacks = listeners.get(method) ?? [];
      listeners.set(method, callbacks.filter((cb) => cb !== callback));
      reject(new Error(`Timed out waiting for ${method}`));
    }, timeoutMs);
    const callback = (params) => {
      clearTimeout(timer);
      const callbacks = listeners.get(method) ?? [];
      listeners.set(method, callbacks.filter((cb) => cb !== callback));
      resolve(params);
    };
    listeners.set(method, [...(listeners.get(method) ?? []), callback]);
  });
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
  }
  return result.result.value;
}

async function navigate(path) {
  const target = path.startsWith("http") ? path : `${base}${path}`;
  const loaded = once("Page.loadEventFired", 15000).catch(() => null);
  await send("Page.navigate", { url: target });
  await loaded;
  return evaluate("({ href: location.href, title: document.title, text: document.body.innerText.slice(0, 4000) })");
}

async function clickAndWait(expression) {
  const loaded = once("Page.loadEventFired", 15000).catch(() => null);
  await evaluate(expression);
  await loaded;
  return evaluate("({ href: location.href, title: document.title, text: document.body.innerText.slice(0, 4000) })");
}

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("Network.clearBrowserCookies");

const healthPage = await navigate("/health");
const health = JSON.parse(healthPage.text);
record("Health endpoint returns success/db up JSON envelope", health.success === true && health.data.status === "up" && health.data.db === "up", { observed: health });

const home = await navigate("/");
record("Public home page renders implementation guide", home.text.includes("Skip the setup.") && home.text.includes("Build your thing."), { url: home.href, excerpt: home.text.slice(0, 220) });

const cms = await navigate("/pages/welcome");
record("CMS page renders JSON content blocks", cms.text.includes("Built to be extended") && cms.text.includes("How it works"), { url: cms.href, excerpt: cms.text.slice(0, 220) });

const projects = await navigate("/projects");
record("Projects index renders seeded projects", ["Alpha Platform", "Beta Redesign", "Gamma Analytics"].every((text) => projects.text.includes(text)), { url: projects.href, excerpt: projects.text.slice(0, 220) });

const projectDetail = await navigate("/projects/seed-project-alpha");
record("Project detail renders seeded tasks", projectDetail.text.includes("Alpha Platform") && projectDetail.text.includes("Set up CI pipeline") && projectDetail.text.includes("User authentication flow"), { url: projectDetail.href, excerpt: projectDetail.text.slice(0, 220) });

const loggedOutAdmin = await navigate("/admin");
record("Admin route redirects logged-out users to login", loggedOutAdmin.href.includes("/admin/login") && (loggedOutAdmin.text.includes("Login") || loggedOutAdmin.text.includes("Sign in")), { url: loggedOutAdmin.href, title: loggedOutAdmin.title });

const formCounts = await evaluate(`({
  email: document.querySelectorAll('input[name="email"]').length,
  password: document.querySelectorAll('input[name="password"]').length,
  submit: document.querySelectorAll('button[type="submit"]').length
})`);
record("Login form fields are uniquely locatable", formCounts.email === 1 && formCounts.password === 1 && formCounts.submit === 1, { observed: formCounts });

const invalidLogin = await clickAndWait(`(() => {
  document.querySelector('input[name="email"]').value = 'alice@example.com';
  document.querySelector('input[name="password"]').value = 'wrong-password';
  document.querySelector('button[type="submit"]').click();
  return true;
})()`);
record("Invalid admin login shows authentication error", invalidLogin.text.includes("Invalid credentials"), { url: invalidLogin.href, excerpt: invalidLogin.text.slice(0, 220) });

const validLogin = await clickAndWait(`(() => {
  document.querySelector('input[name="email"]').value = 'alice@example.com';
  document.querySelector('input[name="password"]').value = 'password123';
  document.querySelector('button[type="submit"]').click();
  return true;
})()`);
record("Valid admin login reaches dashboard", validLogin.href.endsWith("/admin") && (validLogin.text.includes("Dashboard") || validLogin.text.includes("Users")), { url: validLogin.href, excerpt: validLogin.text.slice(0, 220) });

const userList = await navigate("/admin/user");
record("Admin user list renders seeded users", userList.text.includes("Alice Admin") && userList.text.includes("Bob Editor"), { url: userList.href, excerpt: userList.text.slice(0, 220) });

const pageList = await navigate("/admin/page");
record("Admin CMS page list renders seeded page", pageList.text.includes("Welcome to the boilerplate") || pageList.text.includes("welcome"), { url: pageList.href, excerpt: pageList.text.slice(0, 220) });

const organizationList = await navigate("/admin/organizations");
record("Admin organizations page renders with corrected spelling", organizationList.href.endsWith("/admin/organizations") && organizationList.text.includes("Organizations") && !organizationList.text.includes(["Organ", "isations"].join("")), { url: organizationList.href, excerpt: organizationList.text.slice(0, 220) });

const settings = await navigate("/admin/settings");
record("Admin settings page renders grouped site settings", settings.text.includes("Settings") && (settings.text.includes("Site Name") || settings.text.includes("Identity") || settings.text.includes("My App")), { url: settings.href, excerpt: settings.text.slice(0, 220) });

const diagnostics = await navigate("/admin/logs/diagnostics");
record("Diagnostics page renders system health", diagnostics.text.includes("Diagnostics") || diagnostics.text.includes("Database") || diagnostics.text.includes("System"), { url: diagnostics.href, excerpt: diagnostics.text.slice(0, 220) });

await navigate("/api/users");
const apiUsers = await evaluate("JSON.parse(document.body.innerText)");
record("Authenticated /api/users returns success envelope with data array", apiUsers.success === true && Array.isArray(apiUsers.data), { count: Array.isArray(apiUsers.data) ? apiUsers.data.length : null, meta: apiUsers.meta });

const missing = await navigate("/no-such-route-browser-test");
record("Unknown route renders handled 404 page", missing.text.includes("Route not found") || missing.text.includes("Not Found") || missing.text.includes("404"), { url: missing.href, excerpt: missing.text.slice(0, 220) });

await navigate("/admin");
const logout = await clickAndWait(`(() => {
  const button = document.querySelector('form[action="/admin/logout"] button[type="submit"]');
  if (button) button.click();
  return Boolean(button);
})()`);
record("Logout clears admin session and returns to login", logout.href.includes("/admin/login") && (logout.text.includes("Login") || logout.text.includes("Sign in")), { url: logout.href, title: logout.title });

ws.close();
console.log(JSON.stringify(results, null, 2));
if (results.some((result) => !result.passed)) {
  process.exitCode = 1;
}





