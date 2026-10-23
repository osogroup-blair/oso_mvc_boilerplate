// tests/services/project.service.test.ts
// Mirrors tests/services/user.service.test.ts — constructor injection lets us
// pass mocks so no database is needed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectService } from "../../src/services/project.service.js";

const makeModel = () => ({
  list:       vi.fn().mockResolvedValue([]),
  count:      vi.fn().mockResolvedValue(0),
  findById:   vi.fn(),
  create:     vi.fn(),
  createWithReceipt: vi.fn(),
  update:     vi.fn(),
  softDelete: vi.fn(),
});

const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });

describe("ProjectService", () => {
  let model:   ReturnType<typeof makeModel>;
  let audit:   ReturnType<typeof makeAudit>;
  let service: ProjectService;

  beforeEach(() => {
    model   = makeModel();
    audit   = makeAudit();
    service = new ProjectService(model as any, audit as any);
  });

  // ── getById ─────────────────────────────────────────────────────────────────
  it("getById throws 404 when project is absent", async () => {
    model.findById.mockResolvedValue(null);
    await expect(service.getById("missing-id")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("getById returns the project when found", async () => {
    const project = { id: "p1", name: "Alpha" };
    model.findById.mockResolvedValue(project);
    await expect(service.getById("p1")).resolves.toEqual(project);
  });

  // ── create ──────────────────────────────────────────────────────────────────
  it("create delegates the stable operation to the atomic model command", async () => {
    const input   = { name: "New Project", owner: { connect: { id: "user-1" } } } as any;
    const created = { id: "p-new", name: "New Project" };
    model.createWithReceipt.mockResolvedValue(created);

    const operationId = "771ca5be-6507-40ef-b781-aecbcad883ad";
    const result = await service.create(input, "user-1", operationId);

    expect(result).toEqual(created);
    expect(model.createWithReceipt).toHaveBeenCalledWith(input, "user-1", operationId);
    expect(audit.record).not.toHaveBeenCalled();
  });

  // ── update ──────────────────────────────────────────────────────────────────
  it("update calls model.update and audits the change", async () => {
    const before  = { id: "p1", name: "Old" };
    const updated = { id: "p1", name: "New" };
    model.findById.mockResolvedValue(before);
    model.update.mockResolvedValue(updated);

    const result = await service.update("p1", { name: "New" }, "user-1");

    expect(result).toEqual(updated);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     "project.update",
        entityType: "Project",
        entityId:   "p1",
        changes:    { before, after: updated },
      })
    );
  });

  // ── remove ──────────────────────────────────────────────────────────────────
  it("remove calls model.softDelete and audits the deletion", async () => {
    const project = { id: "p1", name: "Alpha" };
    const deleted = { ...project, deletedAt: new Date() };
    model.findById.mockResolvedValue(project);
    model.softDelete.mockResolvedValue(deleted);

    await service.remove("p1", "user-1");

    expect(model.softDelete).toHaveBeenCalledWith("p1");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "project.delete", entityId: "p1" })
    );
  });

  it("remove throws 404 when project does not exist", async () => {
    model.findById.mockResolvedValue(null);
    await expect(service.remove("bad-id")).rejects.toMatchObject({ statusCode: 404 });
    expect(model.softDelete).not.toHaveBeenCalled();
  });
});
