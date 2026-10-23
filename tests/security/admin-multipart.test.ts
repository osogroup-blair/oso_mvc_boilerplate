import express from "express";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import type { Server } from "node:http";
const upload = vi.hoisted(() => vi.fn((req: any, res: any) => res.json({ size: req.file?.size })));
vi.mock("../../src/middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: "synthetic", role: "ADMIN" }; next(); },
  requirePermission: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../src/controllers/asset.controller.js", () => ({ assetController: new Proxy({}, { get: (_target, key) => key === "upload" ? upload : vi.fn() }) }));
import { adminRoutes } from "../../src/routes/admin.routes.js";
import { ensureCsrfToken } from "../../src/middleware/csrf.js";
let server: Server; let base: string; let csrf: string;
beforeAll(async () => {
  ensureCsrfToken({ headers: {} } as never, { locals: {}, cookie: (_key: string, value: string) => { csrf = value; } } as never, vi.fn());
  const app = express(); app.use("/admin", adminRoutes);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ code: error.code }));
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw Error("Missing owned listener");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => { server?.closeAllConnections(); await new Promise<void>(resolve => server?.close(() => resolve())); });
it("parses a bounded multipart token before verification, without persisting bytes", async () => {
  const data = new FormData(); data.append("_csrf", csrf); data.append("file", new Blob(["hello"]), "synthetic.txt");
  const response = await fetch(`${base}/admin/assets/upload`, { method: "POST", headers: { cookie: `csrf=${csrf}; session=synthetic` }, body: data });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ size: 5 }); expect(upload).toHaveBeenCalledOnce();
  upload.mockClear();
  const bad = new FormData(); bad.append("file", new Blob(["hello"]), "synthetic.txt");
  const rejected = await fetch(`${base}/admin/assets/upload`, { method: "POST", headers: { cookie: `csrf=${csrf}; session=synthetic` }, body: bad });
  expect(rejected.status).toBe(403); expect(upload).not.toHaveBeenCalled();
});
