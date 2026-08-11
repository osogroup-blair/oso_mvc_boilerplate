import { describe, it, expect, vi, beforeEach } from "vitest";
import { AssetService } from "../../src/services/asset.service.js";
import { storageService } from "../../src/services/storage.service.js";
import { prisma } from "../../src/lib/prisma.js";
import { AppError } from "../../src/lib/AppError.js";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    asset: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../../src/services/storage.service.js", () => ({
  storageService: {
    upload: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("AssetService", () => {
  let service: AssetService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AssetService();
  });

  describe("upload", () => {
    it("successfully uploads a valid file and saves metadata", async () => {
      const mockFile = {
        buffer: Buffer.from("test file content"),
        originalname: "test.png",
        mimetype: "image/png",
        size: 100,
        userId: "user-123",
      };

      vi.mocked(storageService.upload).mockResolvedValue({
        url: "/uploads/random-uuid.png",
        provider: "local",
      });

      vi.mocked(prisma.asset.create).mockResolvedValue({
        id: "asset-123",
        filename: "test.png",
        mimeType: "image/png",
        size: 100,
        key: "random-uuid.png",
        url: "/uploads/random-uuid.png",
        provider: "local",
        userId: "user-123",
        createdAt: new Date(),
        deletedAt: null,
      });

      const result = await service.upload(mockFile);

      expect(result.id).toBe("asset-123");
      expect(storageService.upload).toHaveBeenCalled();
      expect(prisma.asset.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            filename: "test.png",
            mimeType: "image/png",
            size: 100,
          }),
        })
      );
    });

    it("throws AppError if mimetype is not allowed", async () => {
      const mockFile = {
        buffer: Buffer.from("test executable"),
        originalname: "malicious.exe",
        mimetype: "application/octet-stream",
        size: 100,
      };

      await expect(service.upload(mockFile)).rejects.toThrow(AppError);
      expect(storageService.upload).not.toHaveBeenCalled();
    });

    it("throws AppError if file exceeds size limit", async () => {
      const mockFile = {
        buffer: Buffer.alloc(11 * 1024 * 1024), // 11MB
        originalname: "huge.zip",
        mimetype: "application/zip",
        size: 11 * 1024 * 1024,
      };

      await expect(service.upload(mockFile)).rejects.toThrow(AppError);
    });
  });

  describe("delete", () => {
    it("deletes file from storage and marks deletedAt in DB", async () => {
      const mockAsset = {
        id: "asset-123",
        filename: "test.png",
        mimeType: "image/png",
        size: 100,
        key: "key-123.png",
        url: "/uploads/key-123.png",
        provider: "local",
        userId: null,
        createdAt: new Date(),
        deletedAt: null,
      };

      vi.mocked(prisma.asset.findFirst).mockResolvedValue(mockAsset);
      vi.mocked(storageService.delete).mockResolvedValue();

      await service.delete("asset-123");

      expect(storageService.delete).toHaveBeenCalledWith("key-123.png", "local");
      expect(prisma.asset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "asset-123" },
          data: expect.objectContaining({
            deletedAt: expect.any(Date),
          }),
        })
      );
    });
  });
});
