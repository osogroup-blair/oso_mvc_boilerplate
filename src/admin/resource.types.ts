import type { ListParams } from "../lib/query.js";
import type { FieldDef, RelationOptionsMap } from "./schema.types.js";

export interface AdminResource {
  list(params: ListParams): Promise<Record<string, unknown>[]>;
  listAll(): Promise<Record<string, unknown>[]>;
  count(search?: string): Promise<number>;
  getById(id: string): Promise<Record<string, unknown> | null>;
  create(data: Record<string, unknown>, actorId?: string): Promise<Record<string, unknown>>;
  update(id: string, data: Record<string, unknown>, actorId?: string): Promise<Record<string, unknown>>;
  remove(id: string, actorId?: string): Promise<Record<string, unknown>>;
}
export type AdminAction = "read" | "create" | "update" | "delete";
export interface AdminActor { id: string; role: string }
export interface AdminResourceContext { actor: AdminActor; orgId: string }
export interface AdminMutationMetadata { operationId: string; expectedVersion?: number }

/** Optional tenant adapter. Legacy resources keep their existing interface. */
export interface AdminResourceAdapter {
  resolveContext(input: { actor: AdminActor; requestedOrgId?: string; action: AdminAction }): Promise<AdminResourceContext>;
  bind(context: AdminResourceContext, mutation?: AdminMutationMetadata): AdminResource;
  parse(data: unknown, context: AdminResourceContext, mutation: AdminMutationMetadata): Promise<Record<string, unknown>>;
  options(fields: FieldDef[], context: AdminResourceContext, record?: Record<string, unknown>): Promise<RelationOptionsMap>;
  defaults?(context: AdminResourceContext): Promise<Record<string, unknown>>;
  version?(record: Record<string, unknown>): number;
  transport?: "fields" | "json";
  formValues?(record: Record<string, unknown>, context: AdminResourceContext): Record<string, unknown>;
}
