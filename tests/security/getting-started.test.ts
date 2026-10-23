import { it, expect, vi, beforeEach } from "vitest";
import { access } from "node:fs/promises";
const mocks = vi.hoisted(() => ({ setting: vi.fn(), page: vi.fn() }));
vi.mock("../../src/services/setting.service.js", () => ({ settingService: { get: (...args: unknown[]) => mocks.setting(...args) } }));
vi.mock("../../src/services/page.service.js", () => ({ pageService: { getPublishedBySlug: (...args: unknown[]) => mocks.page(...args) } }));
vi.mock("../../src/services/permissions.service.js", () => ({ permissionsService: { getActionsForRole: async () => [] } }));
import { PageController } from "../../src/controllers/page.controller.js";
import { GettingStartedController } from "../../src/controllers/getting-started.controller.js";
import { gettingStartedService } from "../../src/services/getting-started.service.js";
beforeEach(() => { vi.clearAllMocks(); });
const response = () => ({ locals: {}, render: vi.fn(), redirect: vi.fn() });
it("uses the implementation guide as the fresh default without requiring a CMS record", async () => {
  mocks.setting.mockResolvedValue("getting-started"); const res=response();const next=vi.fn();
  await new PageController().renderHome({ params:{} } as never,res as never,next);
  expect(res.render).toHaveBeenCalledWith("pages/getting-started",expect.objectContaining({layout:"getting-started",applicationHomeHref:"/pages/welcome"}));
  expect(mocks.page).not.toHaveBeenCalled();expect(next).not.toHaveBeenCalled();
});
it("preserves a selected CMS homepage and its actual role restrictions",async()=>{
  mocks.setting.mockResolvedValue("my-product");mocks.page.mockResolvedValue({title:"Product",slug:"my-product",blocks:[],allowedRoles:[{role:{name:"EDITOR"}}]});
  const res=response();const next=vi.fn();
  await new PageController().renderHome({params:{},originalUrl:"/"} as never,res as never,next);
  expect(mocks.page).toHaveBeenCalledWith("my-product");expect(res.redirect).toHaveBeenCalledWith("/admin/login?returnTo=%2F");expect(res.render).not.toHaveBeenCalled();
});
it("keeps the direct guide available independently of homepage selection and points to real extension files",async()=>{
  mocks.setting.mockResolvedValue("my-product");
  const res=response();const next=vi.fn();await new GettingStartedController().show({} as never,res as never,next);
  expect(res.render).toHaveBeenCalledWith("pages/getting-started",expect.objectContaining({features:expect.any(Array)}));
  expect(res.render).toHaveBeenCalledWith("pages/getting-started",expect.objectContaining({applicationHomeHref:"/"}));expect(next).not.toHaveBeenCalled();
  for(const feature of gettingStartedService.getGuide().features)for(const file of feature.files)await expect(access(file)).resolves.toBeUndefined();
});
