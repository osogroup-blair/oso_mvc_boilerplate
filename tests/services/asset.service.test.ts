import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { AssetService } from "../../src/services/asset.service.js";
const setup = () => {
  const model = { create: vi.fn(async (data: unknown) => ({ id: "asset", ...(data as object) })), findById: vi.fn(), softDelete: vi.fn() };
  const storage = { upload: vi.fn(async () => ({ url: "/uploads/file.png", provider: "local" })), delete: vi.fn().mockResolvedValue(undefined) };
  return { model, storage, service: new AssetService(model as never, storage as never) };
};
describe("public assets", () => {
  it("decodes/re-encodes valid pixels, derives extension and stores actual size", async () => {
    const { service, storage, model } = setup();
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: "red" } }).png().toBuffer();
    await service.upload({ buffer, originalname: "photo.PNG", mimetype: "image/png", size: buffer.length });
    expect(storage.upload.mock.calls[0][0]).toMatch(/^[a-f0-9-]+\.png$/);
    expect(model.create).toHaveBeenCalledWith(expect.objectContaining({ size: expect.any(Number), mimeType: "image/png" }));
  });
  it.each([
    ["jpeg", "photo.jpeg", "image/jpeg", "jpg"], ["png", "photo.png", "image/png", "png"],
    ["gif", "photo.gif", "image/gif", "gif"], ["webp", "photo.webp", "image/webp", "webp"],
  ] as const)("accepts and re-encodes real %s pixels", async (format, originalname, mimetype, extension) => {
    const { service, storage } = setup();
    const buffer = await sharp({ create: { width: 2, height: 2, channels: 3, background: "blue" } }).toFormat(format).toBuffer();
    await service.upload({ buffer, originalname, mimetype, size: buffer.length });
    expect(storage.upload.mock.calls[0][0]).toMatch(new RegExp(`\\.${extension}$`));
  });
  it.each([
    ["payload.html", "image/png", "<script>alert(1)</script>"],
    ["payload.png", "image/png", "<script>alert(1)</script>"],
    ["payload.svg", "image/svg+xml", '<svg onload="alert(1)"></svg>'],
    ["payload.txt", "text/plain", "<html>active</html>"],
    ["payload.exe", "application/octet-stream", "exe"],
  ])("rejects %s before persistence", async (originalname, mimetype, contents) => {
    const { service, storage, model } = setup(); const buffer = Buffer.from(contents);
    await expect(service.upload({ buffer, originalname, mimetype, size: buffer.length })).rejects.toMatchObject({ statusCode: 400 });
    expect(storage.upload).not.toHaveBeenCalled(); expect(model.create).not.toHaveBeenCalled();
  });
  it("rejects size mismatches and buffers over the actual limit", async () => {
    const { service, storage } = setup();
    for (const buffer of [Buffer.from("text"), Buffer.alloc(11 * 1024 * 1024)]) await expect(service.upload({ buffer, originalname: "file.txt", mimetype: "text/plain", size: 1 })).rejects.toMatchObject({ statusCode: 400 });
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it("cleans uploaded bytes if metadata publication fails", async () => {
    const { service, storage, model } = setup(); model.create.mockRejectedValue(new Error("synthetic"));
    await expect(service.upload({ buffer: Buffer.from("hello"), originalname: "hello.txt", mimetype: "text/plain", size: 5 })).rejects.toThrow("synthetic");
    expect(storage.delete).toHaveBeenCalled();
  });
});
