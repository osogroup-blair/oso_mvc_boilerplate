import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { AdminSchema } from "../admin/schema.types.js";
import type { AdminAction, AdminActor, AdminResource, AdminMutationMetadata, AdminResourceContext } from "../admin/resource.types.js";
import { AppError } from "../lib/AppError.js";

const metadataSchema = z.object({ operationId: z.string().uuid(), expectedVersion: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional() });
function bounded(value: unknown, depth = 0): void {
  if (depth > 8) throw AppError.badRequest("Admin payload nesting limit exceeded");
  if (Array.isArray(value)) {
    if (value.length > 100) throw AppError.badRequest("Admin row limit exceeded");
    for (const item of value) bounded(item, depth + 1);
  } else if (value && typeof value === "object") {
    if (Object.keys(value).length > 256) throw AppError.badRequest("Admin field limit exceeded");
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw AppError.badRequest("Invalid admin field name");
      bounded(item, depth + 1);
    }
  }
}

/** Resolve access before any record/options read. Adapters call domain services. */
export class AdminResourceService {
  async open(schema: AdminSchema, legacy: () => AdminResource, input: { actor?: AdminActor; requestedOrgId?: unknown; action: AdminAction }, body?: Record<string, unknown>) {
    const adapter = schema.adapter;
    if (!adapter) return { resource: legacy(), context: undefined,
      mutation: body ? metadataSchema.parse({ operationId: body._adminOperationId ?? randomUUID() }) : undefined };
    if (!input.actor) throw AppError.unauthorized();
    const requestedOrgId = z.string().min(1).max(160).optional().parse(input.requestedOrgId);
    const context = await adapter.resolveContext({ actor: input.actor, requestedOrgId, action: input.action });
    if (context.actor.id !== input.actor.id || context.actor.role !== input.actor.role || !context.orgId
      || requestedOrgId && context.orgId !== requestedOrgId) throw AppError.forbidden("Invalid admin resource context");
    const mutation = body ? metadataSchema.parse({ operationId: body._adminOperationId, expectedVersion: body._adminVersion }) : undefined;
    if (body && adapter.version && input.action !== "create" && mutation?.expectedVersion === undefined) throw AppError.badRequest("Expected version is required");
    return { resource: adapter.bind(context, mutation), context, mutation };
  }

  async parse(schema: AdminSchema, body: Record<string, unknown>, context: AdminResourceContext, mutation: AdminMutationMetadata) {
    if (!schema.adapter) throw AppError.badRequest("Admin adapter is required");
    let value: unknown;
    if (schema.adapter.transport === "json") {
      if (typeof body._adminPayload !== "string" || Buffer.byteLength(body._adminPayload) > 65536) throw AppError.badRequest("Admin JSON payload is required and limited to 64 KiB");
      try { value = JSON.parse(body._adminPayload); } catch { throw AppError.badRequest("Invalid admin JSON payload"); }
    } else {
      value = Object.fromEntries(Object.entries(body).filter(([key]) => key !== "_csrf" && !key.startsWith("_admin")));
      if (Buffer.byteLength(JSON.stringify(value)) > 65536) throw AppError.badRequest("Admin payload limit exceeded");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw AppError.badRequest("Admin payload must be an object");
    bounded(value);
    return schema.adapter.parse(value, context, mutation);
  }

  form(schema: AdminSchema, context?: AdminResourceContext, record: Record<string, unknown> = {}, isNew = false) {
    if (!schema.adapter || !context) return { adminMetadata: { orgId: undefined, operationId: randomUUID() as string,
      deleteOperationId: randomUUID() as string, expectedVersion: undefined as number | undefined, versionSet: false } };
    const expectedVersion = isNew ? undefined : schema.adapter.version?.(record);
    if (expectedVersion !== undefined) z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(expectedVersion);
    const metadata = { orgId: context.orgId, operationId: randomUUID() as string, deleteOperationId: randomUUID() as string, expectedVersion, versionSet: expectedVersion !== undefined };
    if (schema.adapter.transport !== "json") return { adminMetadata: metadata };
    if (!schema.adapter.formValues) throw Error("JSON admin adapter must supply safe formValues");
    return { adminMetadata: metadata, formPayloadJson: JSON.stringify(schema.adapter.formValues(record, context), null, 2) };
  }
}
export const adminResourceService = new AdminResourceService();
