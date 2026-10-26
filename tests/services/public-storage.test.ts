import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const state = vi.hoisted(() => ({ values: {} as Record<string, string>, send: vi.fn(async () => ({})) }));
vi.mock("../../src/services/setting.service.js", () => ({ settingService: { get: async (key: string) => state.values[key] } }));
vi.mock("@aws-sdk/client-s3", () => ({ S3Client: class { send = state.send; }, PutObjectCommand: class { constructor(public input: unknown) {} }, DeleteObjectCommand: class { constructor(public input: unknown) {} } }));
import { StorageService } from "../../src/services/storage.service.js";
import { publicStorageLocation } from "../../src/lib/public-storage-paths.js";
let directory: string | undefined;
afterEach(async () => { state.send.mockClear(); if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });
it("uses verified content type and download disposition on public S3 objects", async () => {
  state.values = { STORAGE_PROVIDER: "s3", S3_BUCKET: "synthetic", S3_REGION: "us-east-1" };
  const storage = new StorageService();
  await storage.upload("00000000-0000-0000-0000-000000000000.pdf", Buffer.from("synthetic-pdf"), "application/pdf");
  expect(state.send.mock.calls[0][0].input).toMatchObject({ ContentType: "application/pdf", ContentDisposition: "attachment" });
  await storage.upload("00000000-0000-0000-0000-000000000000.png", Buffer.from("synthetic-pixels"), "image/png");
  expect(state.send.mock.calls[1][0].input).toMatchObject({ ContentType: "image/png", ContentDisposition: "inline" });
});
it("keeps configured local aliases and physical storage consistent", async () => {
  directory = await mkdtemp(join(tmpdir(), "mvc-public-storage-"));
  const uploadDirectory = join(directory, "uploads");
  state.values = { STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: uploadDirectory, STORAGE_PUBLIC_URL_PREFIX: "/media" };
  const storage = new StorageService(); const key = "00000000-0000-0000-0000-000000000000.txt";
  expect(await storage.upload(key, Buffer.from("safe text"), "text/plain")).toEqual({ url: `/media/${key}`, provider: "local" });
  expect(await readFile(join(uploadDirectory, key), "utf8")).toBe("safe text");
  await storage.delete(key, "local");
  await expect(readFile(join(uploadDirectory, key))).rejects.toHaveProperty("code", "ENOENT");
});
it("rejects reserved route prefixes and public code-directory storage", () => {
  for (const prefix of ["/admin", "/api/files", "/js", "//media", "/media/", "/../uploads"]) expect(() => publicStorageLocation("public/uploads", prefix)).toThrow();
  for (const path of ["public", "public/js", "public/css/uploads", "var/private-assets", "."]) expect(() => publicStorageLocation(path, "/media")).toThrow();
});
