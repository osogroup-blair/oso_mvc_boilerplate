import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ reached: vi.fn(), permissions: {
  user: [], editor: ["admin:access", "page:read"], admin: ["admin:access", "admin:logs", "user:read"],
} as Record<string, string[]> }));
vi.mock("../../src/services/auth.service.js", () => {
  const verifySession = async (token: string) => {
    if (!state.permissions[token]) throw Object.assign(new Error("invalid"), { statusCode: 401 });
    return { id: token, role: token, roleId: token };
  };
  return { AuthService: class { verifySession = verifySession; }, authService: { verifySession } };
});
vi.mock("../../src/services/permissions.service.js", () => ({ permissionsService: {
  can: async (role: string, resource: string, action: string) => state.permissions[role]?.includes(`${resource}:${action}`),
  canByName: async (role: string, resource: string, action: string) => state.permissions[role]?.includes(`${resource}:${action}`),
  getActionsForRole: async (role: string) => state.permissions[role] ?? [],
} }));
vi.mock("../../src/controllers/log.controller.js", () => ({ logController: new Proxy({}, { get: () => (_req: unknown, res: any) => { state.reached(); res.json({ success: true }); } }) }));
vi.mock("../../src/controllers/user.controller.js", () => ({ userController: new Proxy({}, { get: () => (_req: unknown, res: any) => { state.reached(); res.json({ success: true }); } }) }));
vi.mock("../../src/controllers/asset.controller.js", () => ({ assetController: new Proxy({}, { get: () => (_req: unknown, res: any) => { state.reached(); res.json({ success: true }); } }) }));
import { adminRoutes } from "../../src/routes/admin.routes.js";
import { userRoutes } from "../../src/routes/user.routes.js";
let server: Server; let base: string;
beforeAll(async () => {
  const app = express(); app.use(express.json()); app.use("/api/users", userRoutes); app.use("/admin", adminRoutes);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ code: error.code }));
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("Owned listener missing");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); });
it("requires authentication and user read authority for both user endpoints", async () => {
  for (const path of ["/api/users", "/api/users/synthetic"]) {
    for (const [identity, status] of [[undefined, 401], ["user", 403], ["admin", 200]] as const) {
      state.reached.mockClear();
      const response = await fetch(base + path, { headers: { accept: "application/json", ...(identity ? { authorization: `Bearer ${identity}` } : {}) } });
      expect(response.status).toBe(status); expect(state.reached.mock.calls.length).toBe(status === 200 ? 1 : 0);
    }
  }
});
it("denies ordinary users and admin-access-only editors at every sensitive section", async () => {
  for (const identity of ["user", "editor"]) for (const [path, method] of [
    ["/admin/logs/audit", "GET"], ["/admin/logs/audit/synthetic", "GET"], ["/admin/logs/diagnostics", "GET"], ["/admin/logs/stream", "GET"],
    ["/admin/sessions", "GET"], ["/admin/sessions/synthetic/logout", "POST"], ["/admin/settings", "GET"], ["/admin/settings", "POST"],
    ["/admin/permissions", "GET"], ["/admin/permissions", "POST"], ["/admin/assets", "GET"], ["/admin/assets/upload", "POST"],
    ["/admin/assets/delete/synthetic", "POST"], ["/admin/jobs", "GET"], ["/admin/jobs/api/queues", "GET"], ["/admin/jobs/api/queues/email/pause", "PUT"],
  ]) {
    state.reached.mockClear();
    const response = await fetch(base + path, { method, headers: { accept: "application/json", authorization: `Bearer ${identity}` } });
    expect(response.status, `${identity} ${method} ${path}`).toBe(403); expect(state.reached).not.toHaveBeenCalled();
  }
});
it("allows a narrowly authorized administrator to read logs", async () => {
  const response = await fetch(base + "/admin/logs/audit", { headers: { authorization: "Bearer admin", accept: "application/json" } });
  expect(response.status).toBe(200);
});
