import { describe, expect, it, vi } from "vitest";
const handlers = vi.hoisted(() => ({ project: vi.fn((_req: unknown, res: { end(): void }) => res.end()), register: vi.fn((_req: unknown, res: { end(): void }) => res.end()) }));
vi.mock("../../src/middleware/auth.js", () => ({ requireAuth: (_q: unknown, _s: unknown, next: () => void) => next() }));
vi.mock("../../src/controllers/project.controller.js", () => ({ projectController: new Proxy({}, { get: () => handlers.project }) }));
vi.mock("../../src/controllers/auth.controller.js", () => ({ authController: new Proxy({}, { get: () => handlers.register }) }));
import { projectRoutes } from "../../src/routes/project.routes.js";
import { authRoutes } from "../../src/routes/auth.routes.js";
import { ensureCsrfToken, exposeQueueCsrf, verifyBrowserMutation, verifyCsrfToken } from "../../src/middleware/csrf.js";
import { allowedRoleNames } from "../../src/lib/pageAccess.js";

function token() {
  let value = "";
  ensureCsrfToken({ headers: {} } as never, { locals: {}, cookie: (_key: string, v: string) => { value = v; } } as never, vi.fn());
  return value;
}
function dispatch(router: any, url: string, headers: Record<string, string>, body = {}) {
  return new Promise<unknown>((resolve) => router.handle({ method: "POST", url, headers, body }, { end: () => resolve(null), locals: {} }, resolve));
}
describe("browser mutation composition", () => {
  it("rejects tokenless actual project/registration routes before their handlers", async () => {
    expect(await dispatch(projectRoutes, "/", {})).toMatchObject({ statusCode: 403 });
    expect(await dispatch(authRoutes, "/register", {})).toMatchObject({ statusCode: 403 });
    expect(handlers.project).not.toHaveBeenCalled();
    expect(handlers.register).not.toHaveBeenCalled();
  });
  it("accepts body and header transport but rejects forged/suffixed tokens", async () => {
    const csrf = token();
    expect(await dispatch(projectRoutes, "/", { cookie: `csrf=${csrf}; session=synthetic` }, { _csrf: csrf })).toBeNull();
    expect(await dispatch(authRoutes, "/register", { cookie: `csrf=${csrf}`, "x-csrf-token": csrf })).toBeNull();
    expect(await dispatch(authRoutes, "/register", { cookie: `csrf=${csrf}`, "x-xsrf-token": csrf })).toBeNull();
    const next = vi.fn();
    verifyCsrfToken({ headers: { cookie: `csrf=${csrf}.extra` }, body: { _csrf: `${csrf}.extra` } } as never, {} as never, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });
  it("exposes only the queue-scoped signed token for Bull Board's Axios transport", () => {
    const csrf = token(); const cookie = vi.fn(); const next = vi.fn();
    exposeQueueCsrf({} as never, { locals: { csrfToken: csrf }, cookie } as never, next);
    expect(cookie).toHaveBeenCalledWith("XSRF-TOKEN", csrf, expect.objectContaining({ path: "/admin/jobs", httpOnly: false, sameSite: "lax" }));
    expect(next).toHaveBeenCalledWith();
  });
  it("only exempts cookie-less bearer transport, leaving authentication to its route", () => {
    const next = vi.fn();
    verifyBrowserMutation({ method: "PATCH", headers: { authorization: "Bearer synthetic" } } as never, {} as never, next);
    expect(next).toHaveBeenCalledWith();
    next.mockClear();
    verifyBrowserMutation({ method: "PATCH", headers: { authorization: "Bearer synthetic", cookie: "session=synthetic" } } as never, {} as never, next);
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });
  it("normalizes actual joined roles and fails closed on malformed policies", () => {
    expect(allowedRoleNames([{ role: { name: "ADMIN" } }])).toEqual(["ADMIN"]);
    expect(allowedRoleNames(["EDITOR"])).toEqual(["EDITOR"]);
    expect(() => allowedRoleNames([{}])).toThrow("Invalid page access");
  });
});
