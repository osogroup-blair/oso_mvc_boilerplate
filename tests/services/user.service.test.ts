// Example service unit test with the model mocked.
// Demonstrates the pattern: services are testable in isolation from the DB.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { UserService } from "../../src/services/user.service.js";

const makeModel = () => ({
  list: vi.fn(),
  count: vi.fn(),
  findById: vi.fn(),
  findByEmail: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
});

const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });

describe("UserService", () => {
  let model: ReturnType<typeof makeModel>;
  let audit: ReturnType<typeof makeAudit>;
  let service: UserService;

  beforeEach(() => {
    model = makeModel();
    audit = makeAudit();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new UserService(model as any, audit as any);
  });

  it("throws 404 when user not found", async () => {
    model.findById.mockResolvedValue(null);
    await expect(service.getById("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("writes an audit log on create", async () => {
    model.create.mockResolvedValue({ id: "u1", name: "A" });
    await service.create({ name: "A", email: "a@x.com" } as never, "actor1");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.create", actorId: "actor1" })
    );
  });
});
