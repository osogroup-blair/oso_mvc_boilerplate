import { randomUUID } from "node:crypto";
import { validatePublicUpload } from "../lib/public-upload-policy.js";
import { storageService } from "./storage.service.js";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { AssetModel, assetModel } from "../models/asset.model.js";

export interface UploadFileOptions {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
  userId?: string;
}

export class AssetService extends BaseService {
  constructor(private readonly model: AssetModel = assetModel, private readonly storage = storageService) {
    super("AssetService");
  }

  async upload(options: UploadFileOptions) {
    const verified = await validatePublicUpload(options.buffer, options.originalname, options.mimetype, options.size);
    const key = `${randomUUID()}.${verified.extension}`;
    const { url, provider } = await this.storage.upload(key, verified.buffer, verified.mimeType);

    let asset;
    try { asset = await this.model.create({
      filename: options.originalname,
      mimeType: verified.mimeType,
      size: verified.size,
      key,
      url,
      provider,
      userId: options.userId,
    }); } catch (error) {
      await this.storage.delete(key, provider).catch(() => this.log.error({ code: "UPLOAD_ORPHAN" }, "Upload cleanup requires reconciliation"));
      throw error;
    }

    this.log.info({ assetId: asset.id }, "Asset uploaded successfully");
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

  async delete(id: string, actorId?: string) {
    const asset = await this.findById(id);

    await this.storage.delete(asset.key, asset.provider);

    await this.model.softDelete(asset.id, actorId);

    this.log.info({ assetId: asset.id }, "Asset deleted successfully");
    return { success: true };
  }
}

export const assetService = new AssetService();
