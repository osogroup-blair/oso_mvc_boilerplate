// PageService unit test — same isolation pattern as user.service.test.ts:
// the model is mocked, so no database is required.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PageService } from "../../src/services/page.service.js";

const makeModel = () => ({
  list: vi.fn(),
  count: vi.fn(),
  findById: vi.fn(),
  findPublishedBySlug: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  softDelete: vi.fn(),
});
const makeAudit = () => ({ record: vi.fn().mockResolvedValue(undefined) });

describe("PageService", () => {
  let model: ReturnType<typeof makeModel>;
  let audit: ReturnType<typeof makeAudit>;
  let service: PageService;

  beforeEach(() => {
    model = makeModel();
    audit = makeAudit();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    service = new PageService(model as any, audit as any);
  });

  it("returns null for a missing published slug (no throw)", async () => {
    model.findPublishedBySlug.mockResolvedValue(null);
    await expect(service.getPublishedBySlug("nope")).resolves.toBeNull();
  });

  it("throws 404 from getById when the page is absent", async () => {
    model.findById.mockResolvedValue(null);
    await expect(service.getById("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("audits page creation", async () => {
    model.create.mockResolvedValue({ id: "p1", slug: "welcome" });
    await service.create({ slug: "welcome", title: "Hi" } as never, "actor1");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: "page.create", entityType: "Page" })
    );
  });
});
