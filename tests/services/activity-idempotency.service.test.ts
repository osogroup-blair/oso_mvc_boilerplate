import { describe, it, expect, vi, beforeEach } from "vitest";
import { ActivityIdempotencyStatus } from "@prisma/client";
import { createHash } from "node:crypto";
import { ActivityIdempotencyService } from "../../src/services/activity-idempotency.service.js";

const makeModel = () => ({
  find: vi.fn(),
  createRunning: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn().mockResolvedValue({count:1}),
  fail: vi.fn(),
});

const makeSettings = () => ({
  get: vi.fn().mockResolvedValue("15"),
});

describe("ActivityIdempotencyService", () => {
  let model: ReturnType<typeof makeModel>;
  let settings: ReturnType<typeof makeSettings>;
  let service: ActivityIdempotencyService;

  beforeEach(() => {
    model = makeModel();
    settings = makeSettings();
    service = new ActivityIdempotencyService(model as never, settings as never);
  });

  it("records and completes a first activity operation", async () => {
    model.find.mockResolvedValue(null);
    model.createRunning.mockResolvedValue({ id: "idem-1",attempt:1 });

    const result = await service.run("org-1", "scope", "key-1", { a: 1 }, async () => ({ ok: true }), {retrySafe:true});

    expect(model.createRunning).toHaveBeenCalledWith(expect.objectContaining({
      orgId: "org-1",
      scope: "scope",
      idempotencyKey: "key-1",
    }));
    expect(model.complete).toHaveBeenCalledWith("idem-1", 1, { ok: true }, undefined);
    expect(result).toEqual({ value: { ok: true }, replayed: false });
  });

  it("replays a succeeded operation with the same request hash", async () => {
    model.find.mockResolvedValue({
      status: ActivityIdempotencyStatus.SUCCEEDED,
      requestHash: createHash("sha256").update(JSON.stringify({ a: 1 })).digest("hex"),
      response: { ok: true },
    });

    const result = await service.run("org-1", "scope", "key-1", { a: 1 }, async () => ({ ok: false }));

    expect(model.createRunning).not.toHaveBeenCalled();
    expect(result).toEqual({ value: { ok: true }, replayed: true });
  });

  it("rejects idempotency key reuse with a different request", async () => {
    model.find.mockResolvedValue({
      status: ActivityIdempotencyStatus.SUCCEEDED,
      requestHash: "different",
      response: { ok: true },
    });

    await expect(
      service.run("org-1", "scope", "key-1", { a: 1 }, async () => ({ ok: false }))
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("recovers a stale running claim after an atomic takeover", async () => {
    model.find.mockResolvedValue({
      id: "idem-1",attempt:0,
      status: ActivityIdempotencyStatus.RUNNING,
      requestHash: createHash("sha256").update(JSON.stringify({ a: 1 })).digest("hex"),
    });
    model.claim.mockResolvedValue({ id: "idem-1",attempt:1 });

    const result = await service.run("org-1", "scope", "key-1", { a: 1 }, async () => ({ ok: true }), {retrySafe:true});

    expect(settings.get).toHaveBeenCalledWith("ACTIVITY_IDEMPOTENCY_STALE_CLAIM_MINUTES", "15");
    expect(model.claim).toHaveBeenCalledWith("idem-1", expect.any(String), 0, expect.any(Date));
    expect(model.complete).toHaveBeenCalledWith("idem-1", 1, { ok: true }, undefined);
    expect(result).toEqual({ value: { ok: true }, replayed: false });
  });

  it("rejects a running claim that is not stale enough to take over", async () => {
    model.find.mockResolvedValue({
      id: "idem-1",attempt:0,
      status: ActivityIdempotencyStatus.RUNNING,
      requestHash: createHash("sha256").update(JSON.stringify({ a: 1 })).digest("hex"),
    });
    model.claim.mockResolvedValue(null);

    await expect(
      service.run("org-1", "scope", "key-1", { a: 1 }, async () => ({ ok: true }), {retrySafe:true})
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(model.complete).not.toHaveBeenCalled();
  });
});
