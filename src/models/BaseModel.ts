// Base for all models. Models are the ONLY layer that touches Prisma directly.
// They wrap queries and translate DB errors — no business logic here.
// See skills/SKILL-model.md.
import { prisma } from "../lib/prisma.js";
import type { Prisma } from "@prisma/client";
import { safeAuditEntry } from "../lib/audit-policy.js";
import { createHash } from "node:crypto";
import { AppError } from "../lib/AppError.js";
import type { CommandMetadata } from "../lib/command-contracts.js";

export abstract class BaseModel {
  protected readonly db = prisma;

  /** Authoritative metadata evidence must commit in the same transaction. */
  protected mutate<T>(action: string, entityType: string, actorId: string | undefined,
    write: (tx: Prisma.TransactionClient) => Promise<T>, entityId?: string,
    command?: CommandMetadata, read?: (tx: Prisma.TransactionClient, id: string, count?: number) => Promise<T>) {
    const receiptId = command ? `command-${createHash("sha256").update(JSON.stringify({ action, entityType, actorId, entityId, operationId: command.operationId })).digest("hex")}` : undefined;
    const replay = async (tx: Prisma.TransactionClient) => {
      if (!receiptId) return undefined;
      const receipt = await tx.auditLog.findUnique({ where: { id: receiptId } });
      if (!receipt) return undefined;
      const after = (receipt.changes as { after?: { requestHash?: string; resultId?: string; count?: number } } | null)?.after;
      if (after?.requestHash !== command?.requestHash) throw AppError.conflict("Operation key was used for different input");
      if (!read || !after?.resultId) throw AppError.conflict("Committed command cannot be replayed through this operation");
      try { return { value: await read(tx, after.resultId, after.count) }; }
      catch (error) { if ((error as { code?: string }).code === "P2025") throw AppError.conflict("Committed command result is unavailable"); throw error; }
    };
    const execute = () => this.db.$transaction(async tx => {
      const existing = await replay(tx);
      if (existing) return existing.value;
      const result = await write(tx);
      const row = result as { id?: string; count?: number } | null;
      const entry = safeAuditEntry({ actorId, action, entityType, entityId: entityId ?? row?.id,
        changes: { after: { status: row?.count === 0 ? "NOT_APPLIED" : "COMMITTED", count: row?.count,
          ...command, resultId: row?.id } } });
      await tx.auditLog.create({ data: { ...entry, ...(receiptId ? { id: receiptId } : {}), changes: entry.changes as Prisma.InputJsonObject } });
      return result;
    });
    return execute().catch(async error => {
      if ((error as { code?: string }).code === "P2025") throw AppError.notFound(entityType);
      if (!receiptId || (error as { code?: string }).code !== "P2002") throw error;
      const existing = await this.db.$transaction(tx => replay(tx));
      if (!existing) throw error;
      return existing.value;
    });
  }
}
