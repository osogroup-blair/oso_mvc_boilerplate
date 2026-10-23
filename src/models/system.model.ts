import { BaseModel } from "./BaseModel.js";

export class SystemModel extends BaseModel {
  async pingDatabase() {
    await this.db.$queryRaw`SELECT 1`;
  }
}

export const systemModel = new SystemModel();
