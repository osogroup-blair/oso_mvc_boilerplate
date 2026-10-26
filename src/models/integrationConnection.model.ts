import {
  IntegrationConnectionStatus,
  IntegrationTestStatus,
  type Prisma,
} from "@prisma/client";
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";

const safeConnectionSelect = {
  id: true,
  orgId: true,
  name: true,
  providerKey: true,
  status: true,
  config: true,
  credentialFingerprint: true,
  lastTestedAt: true,
  lastTestStatus: true,
  lastTestMessage: true,
  disabledAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.IntegrationConnectionSelect;

export class IntegrationConnectionModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  listForOrg(orgId: string, params: ListParams) {
    const where: Prisma.IntegrationConnectionWhereInput = {
      orgId,
      ...this.notDeleted,
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" } },
              { providerKey: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    return this.db.integrationConnection.findMany({
      where,
      select: safeConnectionSelect,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
    });
  }

  countForOrg(orgId: string, search?: string) {
    return this.db.integrationConnection.count({
      where: {
        orgId,
        ...this.notDeleted,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { providerKey: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
    });
  }

  listActiveByProvider(orgId: string, providerKey: string) {
    return this.db.integrationConnection.findMany({
      where: {
        orgId,
        providerKey,
        status: IntegrationConnectionStatus.ACTIVE,
        ...this.notDeleted,
      },
      select: safeConnectionSelect,
      orderBy: { name: "asc" },
    });
  }

  listAllForOrg(orgId: string) {
    return this.db.integrationConnection.findMany({
      where: { orgId, ...this.notDeleted },
      select: safeConnectionSelect,
      orderBy: [{ providerKey: "asc" }, { name: "asc" }],
    });
  }

  findSafeByIdInOrg(id: string, orgId: string) {
    return this.db.integrationConnection.findFirst({
      where: { id, orgId, ...this.notDeleted },
      select: safeConnectionSelect,
    });
  }

  findSecretByIdInOrg(id: string, orgId: string) {
    return this.db.integrationConnection.findFirst({
      where: { id, orgId, ...this.notDeleted },
    });
  }

  create(data: Prisma.IntegrationConnectionUncheckedCreateInput, actorId?: string) {
    return this.mutate("integrationConnection.create", "IntegrationConnection", actorId, tx => tx.integrationConnection.create({ data }));
  }

  update(id: string, data: Prisma.IntegrationConnectionUpdateInput, actorId?: string) {
    return this.mutate("integrationConnection.update", "IntegrationConnection", actorId, tx => tx.integrationConnection.update({ where: { id }, data }), id);
  }

  /**
   * Compare-and-swap on the credential fingerprint: a test that read credentials
   * which have since been rotated must not overwrite the newer state. Returns the
   * number of rows written (0 = stale result discarded).
   */
  async updateTestResult(
    id: string,
    expectedFingerprint: string | null,
    data: {
      status?: IntegrationConnectionStatus;
      lastTestStatus: IntegrationTestStatus;
      lastTestMessage: string;
    }, actorId?: string
  ) {
    const result = await this.mutate("integrationConnection.updateTestResult", "IntegrationConnection", actorId, tx => tx.integrationConnection.updateMany({
      where: { id, credentialFingerprint: expectedFingerprint, ...this.notDeleted },
      data: {
        status: data.status,
        lastTestedAt: new Date(),
        lastTestStatus: data.lastTestStatus,
        lastTestMessage: data.lastTestMessage,
      },
    }), id);
    return result.count;
  }

  softDelete(id: string, actorId?: string) {
    return this.mutate("integrationConnection.softDelete", "IntegrationConnection", actorId, tx => tx.integrationConnection.update({
      where: { id },
      data: { deletedAt: new Date(), status: IntegrationConnectionStatus.DISABLED, disabledAt: new Date() },
    }), id);
  }
}

export const integrationConnectionModel = new IntegrationConnectionModel();
