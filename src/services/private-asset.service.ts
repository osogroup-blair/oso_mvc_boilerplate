import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { AppError } from "../lib/AppError.js";
import type { PrivateAssetPolicy, PrivateAssetScope } from "../lib/private-asset-contracts.js";
import { PrivateAssetModel, privateAssetModel } from "../models/privateAsset.model.js";
import { PrivateAssetStorageService } from "./private-asset-storage.service.js";
import { BaseService } from "./BaseService.js";

const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const scopeSchema = z.object({ orgId: z.string().min(1).max(160), actorId: z.string().min(1).max(160),
  resourceType: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), resourceId: z.string().min(1).max(160) }).strict();
const fileSchema = z.object({ filename: z.string().min(1).max(255).refine(value => Array.from(value).every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127 && char !== "/" && char !== "\\")), mimeType: z.string().min(1).max(100) }).strict();

/** No permissive singleton: each resource registers an explicit access policy. */
export class PrivateAssetService extends BaseService {
  constructor(private readonly policy: PrivateAssetPolicy, private readonly model: PrivateAssetModel = privateAssetModel,
    private readonly storage = new PrivateAssetStorageService()) { super("PrivateAssetService"); }

  private async authorize(scope: PrivateAssetScope, action: "upload" | "read" | "delete") {
    scopeSchema.parse(scope);
    if (!await this.policy.authorize(scope, action)) throw AppError.forbidden();
  }
  private metadata(row: { id: string; filename: string; mimeType: string; size: number }) {
    return { id: row.id, filename: row.filename, mimeType: row.mimeType, size: row.size };
  }
  private async row(id: string, scope: PrivateAssetScope) {
    const row = await this.model.findInScope(id, scope);
    if (!row) throw AppError.notFound("Private asset");
    if (row.backend !== this.storage.id) throw AppError.conflict("Private asset backend is unavailable");
    return row;
  }

  async upload(scope: PrivateAssetScope, file: { filename: string; mimeType: string; buffer: Buffer }, operationId: string) {
    await this.authorize(scope, "upload");
    z.string().uuid().parse(operationId);
    fileSchema.parse({ filename: file.filename, mimeType: file.mimeType });
    if (!Number.isSafeInteger(this.policy.maxBytes) || this.policy.maxBytes <= 0 || this.policy.maxBytes > 10 * 1024 * 1024
      || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0 || file.buffer.length > this.policy.maxBytes
      || !this.policy.allowedMimeTypes.includes(file.mimeType)) throw AppError.badRequest("Private upload violates resource file policy");
    const row = await this.model.createPending({ orgId: scope.orgId, resourceType: scope.resourceType, resourceId: scope.resourceId, actorId: scope.actorId, operationId,
      filename: file.filename, mimeType: file.mimeType, size: file.buffer.length, sha256: sha256(file.buffer), key: randomUUID(), backend: this.storage.id });
    if (row.actorId !== scope.actorId || row.filename !== file.filename || row.mimeType !== file.mimeType || row.size !== file.buffer.length
      || row.sha256 !== sha256(file.buffer) || row.backend !== this.storage.id || row.deletedAt || !["PENDING", "READY"].includes(row.state)) throw AppError.conflict("Private upload operation identity mismatch");
    // Retain a durable PENDING record after any storage/commit uncertainty.
    if (row.state === "PENDING") {
      try { await this.storage.write(row.key, file.buffer); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    }
    const stored = await this.storage.read(row.key, row.size);
    if (stored.length !== row.size || sha256(stored) !== row.sha256) throw AppError.conflict("Private asset integrity mismatch");
    if (row.state !== "READY" && !await this.model.transition(row.id, scope, "PENDING", "READY")) {
      if ((await this.row(row.id, scope)).state !== "READY") throw AppError.conflict("Private upload changed concurrently");
    }
    return this.metadata(row);
  }

  async read(id: string, scope: PrivateAssetScope) {
    await this.authorize(scope, "read");
    const row = await this.row(id, scope);
    if (row.state !== "READY") throw AppError.conflict("Private asset is unavailable");
    if (row.size <= 0 || row.size > 10 * 1024 * 1024) throw AppError.conflict("Private asset integrity mismatch");
    const buffer = await this.storage.read(row.key, row.size);
    if (buffer.length !== row.size || sha256(buffer) !== row.sha256) throw AppError.conflict("Private asset integrity mismatch");
    return { ...this.metadata(row), buffer };
  }

  async recoverUpload(id: string, scope: PrivateAssetScope) {
    await this.authorize(scope, "upload");
    const row = await this.row(id, scope);
    if (row.state === "READY") return this.metadata(row);
    if (row.state !== "PENDING" || row.size <= 0 || row.size > 10 * 1024 * 1024) throw AppError.conflict("Private upload cannot be recovered");
    const buffer = await this.storage.read(row.key, row.size);
    if (buffer.length !== row.size || sha256(buffer) !== row.sha256) throw AppError.conflict("Private asset integrity mismatch");
    if (!await this.model.transition(id, scope, "PENDING", "READY")) throw AppError.conflict("Private upload changed concurrently");
    return this.metadata(row);
  }

  async remove(id: string, scope: PrivateAssetScope) {
    await this.authorize(scope, "delete");
    const row = await this.row(id, scope);
    // Repeating the delete resumes physical cleanup after an uncertain response.
    if (row.state !== "DELETING" && !await this.model.transition(id, scope, row.state, "DELETING")) throw AppError.conflict("Private asset changed concurrently");
    await this.storage.remove(row.key);
    if (!await this.model.transition(id, scope, "DELETING", "DELETED")) throw AppError.conflict("Private deletion changed concurrently");
    return { id, deleted: true };
  }
}
