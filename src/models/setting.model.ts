import type { CommandMetadata } from "../lib/command-contracts.js";
import { BaseModel } from "./BaseModel.js";
export class SettingModel extends BaseModel {
  getByKey(key: string) { return this.db.siteSetting.findUnique({ where: { key } }); }
  getAll() { return this.db.siteSetting.findMany({ orderBy: { key: "asc" } }); }
  set(key: string, value: string, actorId?: string, command?: CommandMetadata) {
    return this.mutate("settings.update", "SiteSetting", actorId, tx => tx.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } }), key, command, (tx, id) => tx.siteSetting.findUniqueOrThrow({ where: { id } }));
  }
  setMany(entries: Record<string, string>, actorId?: string, command?: CommandMetadata) {
    return this.mutate("settings.updateMany", "SiteSetting", actorId, async tx => {
      for (const [key, value] of Object.entries(entries)) await tx.siteSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
      return { id: "global", count: Object.keys(entries).length };
    }, "global", command, async () => ({ id: "global", count: Object.keys(entries).length }));
  }
}
export const settingModel = new SettingModel();
