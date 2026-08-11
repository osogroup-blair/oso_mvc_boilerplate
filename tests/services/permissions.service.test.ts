import { describe, it, expect, vi } from "vitest";
import { PermissionsService, DEFINED_PERMISSIONS, permKey } from "../../src/services/permissions.service.js";
import { RoleModel } from "../../src/models/role.model.js";

// Mock the RoleModel so tests don't need a live DB.
vi.mock("../../src/models/role.model.js", () => ({
  RoleModel: vi.fn().mockImplementation(() => ({
    findByName: vi.fn(),
    findById: vi.fn(),
    findAll: vi.fn(),
    listAll: vi.fn(),
    update: vi.fn(),
  })),
}));

// Mock AuditService so setPermissions tests don't try to write to DB.
vi.mock("../../src/services/audit.service.js", () => ({
  auditService: { record: vi.fn() },
  AuditService: vi.fn(),
}));

const makeService = () => {
  const model = new RoleModel() as any;
  const auditMock = { record: vi.fn() } as any;
  return { service: new PermissionsService(model, auditMock), model };
};

describe("PermissionsService", () => {
  // ── Legacy getActionsForRole ───────────────────────────────────────────────
  it("returns correct actions for ADMIN", async () => {
    const { service, model } = makeService();
    model.findByName.mockResolvedValue({
      id: "1",
      name: "ADMIN",
      permissions: ["page:read", "page:create", "page:update", "page:delete"],
      deletedAt: null,
    });
    const actions = await service.getActionsForRole("ADMIN");
    expect(actions).toEqual(["page:read", "page:create", "page:update", "page:delete"]);
  });

  it("returns correct actions for USER", async () => {
    const { service, model } = makeService();
    model.findByName.mockResolvedValue({
      id: "2",
      name: "USER",
      permissions: ["page:read"],
      deletedAt: null,
    });
    const actions = await service.getActionsForRole("USER");
    expect(actions).toEqual(["page:read"]);
  });

  it("returns empty array for unknown role", async () => {
    const { service, model } = makeService();
    model.findByName.mockResolvedValue(null);
    const actions = await service.getActionsForRole("UNKNOWN");
    expect(actions).toEqual([]);
  });

  // ── canByName (resource:action format) ────────────────────────────────────
  it("canByName returns true when role has the permission", async () => {
    const { service, model } = makeService();
    model.findByName.mockResolvedValue({
      id: "1",
      name: "ADMIN",
      permissions: ["page:read", "page:delete"],
      deletedAt: null,
    });
    expect(await service.canByName("ADMIN", "page", "read")).toBe(true);
    expect(await service.canByName("ADMIN", "page", "delete")).toBe(true);
  });

  it("canByName returns false when permission is missing", async () => {
    const { service, model } = makeService();
    model.findByName.mockResolvedValue({
      id: "2",
      name: "USER",
      permissions: ["page:read"],
      deletedAt: null,
    });
    expect(await service.canByName("USER", "page", "delete")).toBe(false);
    expect(await service.canByName("USER", "user", "read")).toBe(false);
  });

  // ── DEFINED_PERMISSIONS vocabulary ────────────────────────────────────────
  it("DEFINED_PERMISSIONS is a non-empty array", () => {
    expect(DEFINED_PERMISSIONS.length).toBeGreaterThan(0);
  });

  it("permKey generates resource:action format", () => {
    expect(permKey("page", "read")).toBe("page:read");
    expect(permKey("admin", "access")).toBe("admin:access");
  });

  // ── setPermissions filters to known keys ──────────────────────────────────
  it("setPermissions strips unknown permission keys", async () => {
    const { service, model } = makeService();
    model.findById.mockResolvedValue({
      id: "r1",
      name: "EDITOR",
      permissions: [],
      deletedAt: null,
    });
    model.update.mockResolvedValue({ id: "r1", permissions: ["page:read"] });

    await service.setPermissions("r1", ["page:read", "invalid:fake"], undefined);

    expect(model.update).toHaveBeenCalledWith("r1", {
      permissions: ["page:read"],
    });
  });
});
