import type { Prisma, PrivateAssetState } from "@prisma/client";
import type { PrivateAssetScope } from "../lib/private-asset-contracts.js";
import { safeAuditEntry } from "../lib/audit-policy.js";
import { BaseModel } from "./BaseModel.js";

export class PrivateAssetModel extends BaseModel {
  async createPending(data: Prisma.PrivateAssetUncheckedCreateInput) {
    try { return await this.db.$transaction(async tx => {
      const row = await tx.privateAsset.create({ data: { ...data, state: "PENDING" } });
      const entry = safeAuditEntry({ actorId: row.actorId, action: "privateAsset.pending", entityType: "PrivateAsset", entityId: row.id, changes: { after: { status: row.state, size: row.size } } });
      await tx.auditLog.create({ data: { ...entry, changes: entry.changes as Prisma.InputJsonObject } });
      return row;
    }); } catch (error) {
      if ((error as { code?: string }).code !== "P2002") throw error;
      // The unique operation identity is authoritative, including soft-deleted
      // receipts. A reused operation must never create different bytes.
      const row = await this.db.privateAsset.findUnique({ where: { orgId_resourceType_resourceId_operationId: {
        orgId: data.orgId, resourceType: data.resourceType, resourceId: data.resourceId, operationId: data.operationId,
      } } });
      if (!row) throw error;
      return row;
    }
  }
  findInScope(id: string, scope: PrivateAssetScope) {
    return this.db.privateAsset.findFirst({ where: { id, orgId: scope.orgId, resourceType: scope.resourceType, resourceId: scope.resourceId, deletedAt: null } });
  }
  transition(id: string, scope: PrivateAssetScope, from: PrivateAssetState, to: PrivateAssetState) {
    return this.db.$transaction(async tx => {
      const result = await tx.privateAsset.updateMany({ where: { id, orgId: scope.orgId, resourceType: scope.resourceType, resourceId: scope.resourceId, state: from, deletedAt: null },
        data: { state: to, ...(to === "DELETED" ? { deletedAt: new Date() } : {}) } });
      if (result.count) {
        const entry = safeAuditEntry({ actorId: scope.actorId, action: `privateAsset.${to.toLowerCase()}`, entityType: "PrivateAsset", entityId: id, changes: { after: { status: to } } });
        await tx.auditLog.create({ data: { ...entry, changes: entry.changes as Prisma.InputJsonObject } });
      }
      return result.count === 1;
    });
  }
}
export const privateAssetModel = new PrivateAssetModel();
