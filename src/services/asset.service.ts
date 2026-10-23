import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { storageService } from "./storage.service.js";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { AssetModel, assetModel } from "../models/asset.model.js";

const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "application/zip",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024;

export interface UploadFileOptions {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
  userId?: string;
}

export class AssetService extends BaseService {
  constructor(private readonly model: AssetModel = assetModel) {
    super("AssetService");
  }

  async upload(options: UploadFileOptions) {
    if (!ALLOWED_MIME_TYPES.includes(options.mimetype)) {
      throw AppError.badRequest(`File type '${options.mimetype}' is not allowed`);
    }

    if (options.size > MAX_FILE_SIZE) {
      throw AppError.badRequest("File exceeds the maximum size limit of 10MB");
    }

    const extension = extname(options.originalname);
    const key = `${randomUUID()}${extension}`;

    const { url, provider } = await storageService.upload(key, options.buffer, options.mimetype);

    const asset = await this.model.create({
      filename: options.originalname,
      mimeType: options.mimetype,
      size: options.size,
      key,
      url,
      provider,
      userId: options.userId,
    });

    this.log.info({ assetId: asset.id, filename: asset.filename }, "Asset uploaded successfully");
    return asset;
  }

  async findById(id: string) {
    const asset = await this.model.findById(id);
    if (!asset) throw AppError.notFound("Asset not found");
    return asset;
  }

  async getAll() {
    return this.model.listAll();
  }

  async delete(id: string) {
    const asset = await this.findById(id);

    await storageService.delete(asset.key, asset.provider).catch((err) => {
      this.log.error({ err, key: asset.key }, "Failed to delete file from physical storage");
    });

    await this.model.softDelete(asset.id);

    this.log.info({ assetId: asset.id }, "Asset deleted successfully");
    return { success: true };
  }
}

export const assetService = new AssetService();
