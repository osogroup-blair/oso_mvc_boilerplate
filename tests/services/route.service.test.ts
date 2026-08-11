import { describe, it, expect, vi, beforeEach } from "vitest";
import { RouteService } from "../../src/services/route.service.js";

const makeModel = () => ({
  list: vi.fn(),
  count: vi.fn(),
  findById: vi.fn(),
  findByPattern: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
});
const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });

describe("RouteService", () => {
  let model: ReturnType<typeof makeModel>;
  let audit: ReturnType<typeof makeAudit>;
  let service: RouteService;

  beforeEach(() => {
    model = makeModel();
    audit = makeAudit();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new RouteService(model as any, audit as any);
  });

  it("throws a validation error if pattern does not start with /", async () => {
    await expect(service.create({ pattern: "no-slash", targetType: "REDIRECT", targetValue: "/test" } as never)).rejects.toMatchObject({
      statusCode: 400,
      message: "Pattern must start with a forward slash '/'",
    });
  });

  it("throws a validation error for reserved system patterns", async () => {
    await expect(service.create({ pattern: "/admin/routes", targetType: "REDIRECT", targetValue: "/test" } as never)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Pattern cannot start with reserved system prefix "/admin"',
    });
  });

  it("throws a validation error if a route redirects to itself", async () => {
    await expect(service.create({ pattern: "/loop", targetType: "REDIRECT", targetValue: "/loop" } as never)).rejects.toMatchObject({
      statusCode: 400,
      message: "A route cannot redirect to itself",
    });
  });

  it("throws a validation error on duplicate patterns", async () => {
    model.findByPattern.mockResolvedValue({ id: "r1", pattern: "/duplicate" });
    await expect(service.create({ pattern: "/duplicate", targetType: "PAGE", targetValue: "welcome" } as never)).rejects.toMatchObject({
      statusCode: 400,
      message: 'Route pattern "/duplicate" already exists',
    });
  });

  it("audits route creation", async () => {
    model.findByPattern.mockResolvedValue(null);
    model.create.mockResolvedValue({ id: "r2", pattern: "/new-route" });
    await service.create({ pattern: "/new-route", targetType: "PAGE", targetValue: "welcome" } as never, "actor1");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "route.create", entityType: "Route" })
    );
  });

  it("throws a validation error when creating an APP route manually", async () => {
    await expect(service.create({ pattern: "/projects", targetType: "APP", targetValue: "Internal" } as never)).rejects.toMatchObject({
      statusCode: 400,
      message: "Application routes cannot be created manually.",
    });
  });

  it("throws a validation error when updating an APP route manually", async () => {
    model.findById.mockResolvedValue({ id: "r1", pattern: "/projects", targetType: "APP", targetValue: "Internal" });
    await expect(service.update("r1", { pattern: "/projects-new" } as never)).rejects.toMatchObject({
      statusCode: 400,
      message: "Application routes cannot be modified manually.",
    });
  });

  it("throws a validation error when deleting an APP route manually", async () => {
    model.findById.mockResolvedValue({ id: "r1", pattern: "/projects", targetType: "APP", targetValue: "Internal" });
    await expect(service.remove("r1")).rejects.toMatchObject({
      statusCode: 400,
      message: "Application routes cannot be deleted manually.",
    });
  });
});
