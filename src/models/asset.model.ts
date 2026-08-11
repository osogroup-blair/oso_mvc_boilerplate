import { BaseModel } from "./BaseModel.js";

export class AssetModel extends BaseModel {
  create(data: { filename: string; mimeType: string; size: number; key: string; url: string; provider: string; userId?: string }) {
    return this.db.asset.create({ data });
  }

  findById(id: string) {
    return this.db.asset.findFirst({
      where: { id, deletedAt: null },
    });
  }

  listAll() {
    return this.db.asset.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
  }

  softDelete(id: string) {
    return this.db.asset.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export const assetModel = new AssetModel();
