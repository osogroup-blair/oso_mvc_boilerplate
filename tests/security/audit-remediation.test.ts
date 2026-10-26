import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { safeRedirect } from "../../src/lib/safe-redirect.js";
import { validatePublicUpload, publicObjectHeaders } from "../../src/lib/public-upload-policy.js";
import { allSchemas } from "../../src/admin/schema.registry.js";
import { ADMIN_PERMISSIONS, DEFINED_PERMISSIONS } from "../../src/lib/permission-definitions.js";
import { ActorAccessService } from "../../src/services/actor-access.service.js";
import { ProjectService } from "../../src/services/project.service.js";
import { TaskService } from "../../src/services/task.service.js";
import { OrganizationService } from "../../src/services/organization.service.js";
import { UserService } from "../../src/services/user.service.js";

const actor = (permissions: string[] = []) => ({ id: "b", isActive: true, deletedAt: null,
  role: { id: "role", name: "ADMIN", permissions, deletedAt: null } });
const access = (permissions: string[] = []) => new ActorAccessService({ findAuthorizationById: vi.fn(async () => actor(permissions)) } as never);
const audit = { record: vi.fn() };

describe("audit remediation contracts", () => {
  it.each(["https://attacker.invalid", "//attacker.invalid", "/\\attacker.invalid", "/%5cattacker.invalid", "/%252f%252fattacker.invalid", "/ok%0d%0aLocation:evil", "javascript:alert(1)", "/%00", ["/admin"]])("restricts unsafe redirect %j", value => {
    expect(safeRedirect(value)).toBe("/admin");
  });
  it("preserves local path/query/fragment", () => expect(safeRedirect("/projects/p?tab=tasks#edit")).toBe("/projects/p?tab=tasks#edit"));
  it("registers every CRUD permission for every existing admin schema", () => {
    const keys = DEFINED_PERMISSIONS.map(p => `${p.resource}:${p.action}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const schema of allSchemas()) for (const action of ["read", "create", "update", "delete"]) {
      expect(keys).toContain(`${schema.key}:${action}`);
      expect(ADMIN_PERMISSIONS).toContain(`${schema.key}:${action}`);
    }
  });
  it("rejects inactive/currently revoked actors", async () => {
    const users = { findAuthorizationById: vi.fn(async () => ({ ...actor(), isActive: false })) };
    await expect(new ActorAccessService(users as never).actor("b")).rejects.toMatchObject({ statusCode: 403 });
    await expect(access().actor()).rejects.toMatchObject({ statusCode: 401 });
  });
  it("denies cross-owner project writes even for an ADMIN-named role", async () => {
    const model = { findById: vi.fn(async () => ({ id: "project", ownerId: "a" })), update: vi.fn(), softDelete: vi.fn() };
    const service = new ProjectService(model as never, audit as never, access());
    await expect(service.update("project", { name: "stolen" }, "b")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.remove("project", "b")).rejects.toMatchObject({ statusCode: 403 });
    expect(model.update).not.toHaveBeenCalled(); expect(model.softDelete).not.toHaveBeenCalled();
  });
  it("rejects wrong-parent task URLs before writing even for a privileged actor", async () => {
    const projects = { authorize: vi.fn(async () => ({ ownerId: "a" })) };
    const model = { findById: vi.fn(async () => ({ id: "task", projectId: "a" })), update: vi.fn(), softDelete: vi.fn() };
    const service = new TaskService(model as never, audit as never, projects as never);
    await expect(service.update("task", { title: "bad" }, "b", "wrong")).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.remove("task", "b", "wrong")).rejects.toMatchObject({ statusCode: 404 });
    expect(projects.authorize).not.toHaveBeenCalled(); expect(model.update).not.toHaveBeenCalled(); expect(model.softDelete).not.toHaveBeenCalled();
  });
  it("denies task create and tag changes through the actual parent policy", async () => {
    const projects = { authorize: vi.fn(async () => { throw Object.assign(new Error("denied"), { statusCode: 403 }); }) };
    const model = { findById: vi.fn(async () => ({ id: "task", projectId: "a" })), create: vi.fn(), addTag: vi.fn(), removeTag: vi.fn() };
    const service = new TaskService(model as never, audit as never, projects as never);
    await expect(service.create({ title: "bad", project: { connect: { id: "a" } } }, "b")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.addTag("task", "tag", "b")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.removeTag("task", "tag", "b")).rejects.toMatchObject({ statusCode: 403 });
    expect(model.create).not.toHaveBeenCalled(); expect(model.addTag).not.toHaveBeenCalled(); expect(model.removeTag).not.toHaveBeenCalled();
  });
  it("denies organization reads and mutations to unrelated actors", async () => {
    const orgs = { findById: vi.fn(), updateAuthorized: vi.fn(), changeMemberAuthorized: vi.fn(), deleteAuthorized: vi.fn() };
    const members = { findMembership: vi.fn(async () => null), findByIdInOrg: vi.fn() };
    const users = { listActiveBasic: vi.fn() };
    const service = new OrganizationService(orgs as never, members as never, users as never, access());
    for (const operation of [() => service.getDetailWithAvailableUsers("other", "b"), () => service.update("other", { name: "bad" }, "b"), () => service.delete("other", "b"), () => service.changeRole("other", "member", "OWNER", "b"), () => service.removeMember("other", "member", "b")]) await expect(operation()).rejects.toMatchObject({ statusCode: 403 });
    expect(orgs.findById).not.toHaveBeenCalled(); expect(orgs.updateAuthorized).not.toHaveBeenCalled(); expect(orgs.changeMemberAuthorized).not.toHaveBeenCalled(); expect(users.listActiveBasic).not.toHaveBeenCalled();
  });
  it("prevents an organization ADMIN from promoting themselves", async () => {
    const orgs = { changeMemberAuthorized: vi.fn() };
    const members = { findMembership: vi.fn(async () => ({ role: "ADMIN" })), findByIdInOrg: vi.fn(async () => ({ role: "ADMIN" })) };
    const service = new OrganizationService(orgs as never, members as never, {} as never, access());
    await expect(service.changeRole("org", "self", "OWNER", "b")).rejects.toMatchObject({ statusCode: 403 });
    expect(orgs.changeMemberAuthorized).not.toHaveBeenCalled();
  });
  it("rejects missing provisioning passwords and unauthorized role assignment", async () => {
    const model = { create: vi.fn() };
    const service = new UserService(model as never, audit as never, {} as never, access(["user:create"]));
    await expect(service.create({ name: "Test", email: "test@example.invalid" }, "b")).rejects.toHaveProperty("name", "ZodError");
    await expect(service.create({ name: "Test", email: "test@example.invalid", password: "explicit-password", role: "ADMIN" }, "b")).rejects.toMatchObject({ statusCode: 403 });
    expect(model.create).not.toHaveBeenCalled();
  });
  it("rejects corrupt images, type mismatch and excessive decoded dimensions", async () => {
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    for (const [buffer, filename, mime] of [[png, "picture.html", "image/png"], [png, "picture.jpg", "image/jpeg"], [png.subarray(0, 40), "picture.png", "image/png"]] as const) await expect(validatePublicUpload(buffer, filename, mime, buffer.length)).rejects.toMatchObject({ statusCode: 400 });
    const huge = await sharp({ create: { width: 4001, height: 4001, channels: 3, background: "red" } }).png().toBuffer();
    await expect(validatePublicUpload(huge, "huge.png", "image/png", huge.length)).rejects.toMatchObject({ statusCode: 400 });
  });
  it("sandboxes and downloads legacy HTML/SVG and permits only generated raster names inline", () => {
    for (const name of ["old.html", "old.svg", "old.js", "new.pdf", "fake.jpg"]) expect(publicObjectHeaders(name)).toMatchObject({ "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": expect.stringContaining("sandbox") });
    expect(publicObjectHeaders("old.js")["Content-Type"]).toBe("application/octet-stream");
    expect(publicObjectHeaders("00000000-0000-0000-0000-000000000000.png")["Content-Disposition"]).toBe("inline");
  });
});
