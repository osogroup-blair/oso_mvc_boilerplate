import { it, expect, vi } from "vitest";
const page = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../src/services/page.service.js", () => ({ pageService: { getPublishedBySlug: (...args: unknown[]) => page.get(...args) } }));
vi.mock("../../src/services/permissions.service.js", () => ({ permissionsService: { getActionsForRole: async () => [] } }));
import { PageController } from "../../src/controllers/page.controller.js";
import { enforcePagePermissions } from "../../src/middleware/pageMeta.js";

it("enforces actual CMS role joins for direct URLs, independently of navigation", async () => {
  page.get.mockResolvedValue({ title: "Restricted", slug: "restricted", blocks: [], allowedRoles: [{ role: { name: "EDITOR" } }] });
  const controller = new PageController();
  for (const [role, expected] of [["VIEWER", 403], ["EDITOR", 200], [undefined, 302]]) {
    const res = { locals: { user: role ? { role } : undefined }, render: vi.fn(), redirect: vi.fn() }; const next = vi.fn();
    await controller.render({ params: { slug: "restricted" }, originalUrl: "/pages/restricted" } as never, res as never, next);
    if (expected === 403) expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
    if (expected === 200) { expect(res.render).toHaveBeenCalled(); expect(next).not.toHaveBeenCalled(); }
    if (expected === 302) expect(res.redirect).toHaveBeenCalledWith("/admin/login?returnTo=%2Fpages%2Frestricted");
  }
});

it("requires an explicit static policy declaration and enforces its actual joined roles", async () => {
  expect(() => enforcePagePermissions("admin")).toThrow("Declare the static Page policy");
  page.get.mockResolvedValue({ allowedRoles: [{ role: { name: "EDITOR" } }] });
  const next = vi.fn();
  await enforcePagePermissions("projects")({ originalUrl: "/projects" } as never, { locals: { user: { role: "VIEWER" } } } as never, next);
  expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
});
