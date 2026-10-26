// tests/services/task.service.test.ts
// Tests standard CRUD + the M2M addTag / removeTag methods.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskService } from "../../src/services/task.service.js";

const makeModel = () => ({
  list:       vi.fn().mockResolvedValue([]),
  count:      vi.fn().mockResolvedValue(0),
  findById:   vi.fn(),
  create:     vi.fn(),
  update:     vi.fn(),
  softDelete: vi.fn(),
  addTag:     vi.fn(),
  removeTag:  vi.fn(),
});

const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });

describe("TaskService", () => {
  let model:   ReturnType<typeof makeModel>;
  let audit:   ReturnType<typeof makeAudit>;
  let service: TaskService;

  beforeEach(() => {
    model   = makeModel();
    audit   = makeAudit();
    service = new TaskService(model as any, audit as any, { authorize: vi.fn().mockResolvedValue({ ownerId: "user-1" }) } as any, { findById: async () => ({ id: "tag-1" }) } as any);
  });

  // ── getById ─────────────────────────────────────────────────────────────────
  it("getById throws 404 when task is absent", async () => {
    model.findById.mockResolvedValue(null);
    await expect(service.getById("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  // ── create ──────────────────────────────────────────────────────────────────
  it("create returns the new task and calls audit.record", async () => {
    const input   = { title: "Fix bug", project: { connect: { id: "p1" } } } as any;
    const created = { id: "t1", projectId: "p1", title: "Fix bug" };
    model.create.mockResolvedValue(created);

    const result = await service.create(input, "user-1");

    expect(result).toEqual(created);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "task.create", entityType: "Task" })
    );
  });

  // ── addTag (M2M) ────────────────────────────────────────────────────────────
  it("addTag calls model.addTag and audits tag_add action", async () => {
    const task = { id: "t1", projectId: "p1", title: "Fix bug" };
    const join = { taskId: "t1", tagId: "tag-1" };
    model.findById.mockResolvedValue(task);
    model.addTag.mockResolvedValue(join);

    const result = await service.addTag("t1", "tag-1", "user-1");

    expect(model.addTag).toHaveBeenCalledWith("t1", "tag-1", "user-1", "user-1", expect.objectContaining({ operationId: expect.any(String) }));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action:     "task.tag_add",
        entityType: "Task",
        entityId:   "t1",
      })
    );
    expect(result).toEqual(join);
  });

  it("addTag throws 404 when the task does not exist", async () => {
    model.findById.mockResolvedValue(null);
    await expect(service.addTag("bad-task", "tag-1")).rejects.toMatchObject({ statusCode: 404 });
    expect(model.addTag).not.toHaveBeenCalled();
  });

  // ── removeTag (M2M) ─────────────────────────────────────────────────────────
  it("removeTag calls model.removeTag and audits tag_remove action", async () => {
    const task = { id: "t1", projectId: "p1", title: "Fix bug" };
    model.findById.mockResolvedValue(task);
    model.removeTag.mockResolvedValue({ count: 1 });

    await service.removeTag("t1", "tag-1", "user-1");

    expect(model.removeTag).toHaveBeenCalledWith("t1", "tag-1", "user-1", "user-1", expect.objectContaining({ operationId: expect.any(String) }));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "task.tag_remove" })
    );
  });

  // ── remove ──────────────────────────────────────────────────────────────────
  it("remove soft-deletes the task and records an audit entry", async () => {
    const task    = { id: "t1", projectId: "p1", title: "Fix bug" };
    const deleted = { ...task, deletedAt: new Date() };
    model.findById.mockResolvedValue(task);
    model.softDelete.mockResolvedValue(deleted);

    await service.remove("t1", "user-1");

    expect(model.softDelete).toHaveBeenCalledWith("t1", "user-1", "p1", expect.objectContaining({ operationId: expect.any(String) }), "user-1");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "task.delete" })
    );
  });
});
