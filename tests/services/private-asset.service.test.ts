import { it, expect, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrivateAssetService } from "../../src/services/private-asset.service.js";
import { PrivateAssetStorageService } from "../../src/services/private-asset-storage.service.js";

const scope = { orgId: "org", actorId: "actor", resourceType: "Document", resourceId: "document" };
const bytes = Buffer.from("SYNTHETIC PRIVATE DOCUMENT");
const row = () => ({ id: randomUUID(), ...scope, filename: "document.txt", mimeType: "text/plain", key: randomUUID(), size: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"), backend: "unit-store", state: "READY" });
const setup = () => {
  const data = row();
  const policy = { authorize: vi.fn().mockResolvedValue(true), maxBytes: 1024, allowedMimeTypes: ["text/plain"] };
  const model = { createPending: vi.fn().mockImplementation(async input => ({ ...data, ...input, state: "PENDING" })),
    findInScope: vi.fn().mockResolvedValue(data), transition: vi.fn().mockResolvedValue(true) };
  const storage = { id: "unit-store", read: vi.fn().mockResolvedValue(bytes), write: vi.fn(), remove: vi.fn() };
  return { data, policy, model, storage, service: new PrivateAssetService(policy, model as never, storage as never) };
};

it("denies before I/O and checks resource policy before persisting private uploads", async () => {
  const ctx = setup(); ctx.policy.authorize.mockResolvedValue(false);
  await expect(ctx.service.read(ctx.data.id, scope)).rejects.toMatchObject({ statusCode: 403 });
  expect(ctx.model.findInScope).not.toHaveBeenCalled(); expect(ctx.storage.read).not.toHaveBeenCalled();
  ctx.policy.authorize.mockResolvedValue(true);
  await expect(ctx.service.upload(scope, { filename: "../escape", mimeType: "text/plain", buffer: bytes }, randomUUID())).rejects.toThrow();
  await expect(ctx.service.upload(scope, { filename: "document.txt", mimeType: "application/pdf", buffer: bytes }, randomUUID())).rejects.toThrow();
  expect(ctx.model.createPending).not.toHaveBeenCalled();
  const result = await ctx.service.upload(scope, { filename: "document.txt", mimeType: "text/plain", buffer: bytes }, randomUUID());
  expect(result).not.toHaveProperty("key"); expect(result).not.toHaveProperty("url");
  expect(ctx.model.transition).toHaveBeenCalledWith(result.id, scope, "PENDING", "READY");
});

it("rejects scope/backend/state/size/checksum mismatch and recovers an uncertain publication", async () => {
  const ctx = setup();
  await ctx.service.read(ctx.data.id, scope);
  expect(ctx.model.findInScope).toHaveBeenCalledWith(ctx.data.id, scope);
  ctx.model.findInScope.mockResolvedValueOnce(null);
  await expect(ctx.service.read(ctx.data.id, { ...scope, orgId: "other" })).rejects.toMatchObject({ statusCode: 404 });
  ctx.model.findInScope.mockResolvedValueOnce({ ...ctx.data, backend: "other" });
  await expect(ctx.service.read(ctx.data.id, scope)).rejects.toThrow("backend");
  ctx.model.findInScope.mockResolvedValueOnce({ ...ctx.data, state: "PENDING" });
  await expect(ctx.service.read(ctx.data.id, scope)).rejects.toThrow("unavailable");
  ctx.storage.read.mockResolvedValueOnce(Buffer.from("tampered"));
  await expect(ctx.service.read(ctx.data.id, scope)).rejects.toThrow("integrity");
  ctx.model.findInScope.mockResolvedValueOnce({ ...ctx.data, size: 1000000000 });
  await expect(ctx.service.read(ctx.data.id, scope)).rejects.toThrow("integrity");
  ctx.model.findInScope.mockResolvedValueOnce({ ...ctx.data, state: "PENDING" });
  await ctx.service.recoverUpload(ctx.data.id, scope);
  expect(ctx.model.transition).toHaveBeenCalledWith(ctx.data.id, scope, "PENDING", "READY");
});

it("keeps failed upload publication pending and resumes deletion after cleanup failure", async () => {
  const ctx = setup(); ctx.model.transition.mockRejectedValueOnce(Error("synthetic commit uncertainty"));
  await expect(ctx.service.upload(scope, { filename: "document.txt", mimeType: "text/plain", buffer: bytes }, randomUUID())).rejects.toThrow("uncertainty");
  expect(ctx.storage.remove).not.toHaveBeenCalled();
  ctx.storage.remove.mockRejectedValueOnce(Error("synthetic storage failure"));
  await expect(ctx.service.remove(ctx.data.id, scope)).rejects.toThrow("storage failure");
  ctx.model.findInScope.mockResolvedValueOnce({ ...ctx.data, state: "DELETING" });
  await ctx.service.remove(ctx.data.id, scope);
  expect(ctx.model.transition).toHaveBeenLastCalledWith(ctx.data.id, scope, "DELETING", "DELETED");
});

it("local private storage rejects public roots, traversal and symlink objects", async () => {
  const root = await mkdtemp(join(tmpdir(), "bp-private-storage-"));
  try {
    const publicRoot = join(root, "public"); await mkdir(publicRoot);
    const storage = new PrivateAssetStorageService(join(root, "private"), "unit-store", publicRoot);
    const key = randomUUID(); await storage.write(key, bytes);
    expect(await storage.read(key, bytes.length)).toEqual(bytes);
    await expect(storage.read(key, 1)).rejects.toThrow("integrity");
    await expect(storage.write("../escape", bytes)).rejects.toThrow("key");
    await expect(new PrivateAssetStorageService(join(publicRoot, "private"), "unit", publicRoot).write(key, bytes)).rejects.toThrow("separate");
    const target = join(root, "sensitive.txt"); await writeFile(target, bytes);
    const link = randomUUID(); await symlink(target, join(root, "private", link));
    await expect(storage.read(link, 1024)).rejects.toThrow();
    await expect(storage.write(key, bytes)).rejects.toThrow();
    await storage.remove(key); await storage.remove(key);
  } finally { await rm(root, { recursive: true, force: true }); }
});
