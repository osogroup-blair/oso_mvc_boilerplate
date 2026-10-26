import { BaseModel } from "./BaseModel.js";

/** Startup inventory writes use the same database boundary as runtime queries. */
export class AppSyncModel extends BaseModel {
  upsertPage(page: { slug: string; title: string; filePath: string }, actorId?: string) {
    const data = { title: page.title, filePath: page.filePath, isHardcoded: true, status: "PUBLISHED" as const };
    return this.mutate("page.upsertPage", "Page", actorId, tx => tx.page.upsert({ where: { slug: page.slug }, update: { ...data, deletedAt: null }, create: { ...data, slug: page.slug } }));
  }
  upsertRoute(pattern: string, actorId?: string) {
    const data = { targetType: "APP" as const, targetValue: "Internal Application Route", isActive: true };
    return this.mutate("route.upsertRoute", "Route", actorId, tx => tx.route.upsert({ where: { pattern }, update: { ...data, deletedAt: null }, create: { ...data, pattern } }));
  }
  listAppRoutes() { return this.db.route.findMany({ where: { targetType: "APP" } }); }
  softDeleteRoute(id: string, actorId?: string) { return this.mutate("route.softDeleteRoute", "Route", actorId, tx => tx.route.update({ where: { id }, data: { deletedAt: new Date() } }), id); }
}
export const appSyncModel = new AppSyncModel();
