import { beforeEach, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AdminSchema } from "../../src/admin/schema.types.js";
import type { AdminResource, AdminResourceAdapter } from "../../src/admin/resource.types.js";
import { AppError } from "../../src/lib/AppError.js";
import { AdminController } from "../../src/controllers/admin.controller.js";
import { AdminResourceService } from "../../src/services/admin-resource.service.js";

const state = vi.hoisted(() => ({ schemas: new Map(), legacy: vi.fn(), permission: vi.fn() }));
vi.mock("../../src/admin/schema.registry.js", () => ({ getSchema: (key: string) => state.schemas.get(key), allSchemas: () => [...state.schemas.values()] }));
vi.mock("../../src/controllers/resourceRegistry.js", () => ({ getResource: (...args: unknown[]) => state.legacy(...args) }));
vi.mock("../../src/services/permissions.service.js", () => ({ permissionsService: { assert: (...args: unknown[]) => state.permission(...args) } }));

function fixture(key: string, requiredRole: string, versioned: boolean) {
  const rows = [{ id: `${key}-a`, orgId: "org-a", name: key, version: 1 }, { id: `${key}-b`, orgId: "org-b", name: "private-other-org", version: 1 }];
  const options = vi.fn(async (_fields, context) => ({ owner: [{ id: context.orgId, label: context.orgId }] }));
  const receipts = new Map<string, Record<string, unknown>>();
  const adapter: AdminResourceAdapter = {
    async resolveContext({ actor, requestedOrgId }) {
      if (actor.role !== requiredRole || requestedOrgId !== "org-a") throw AppError.forbidden();
      return { actor, orgId: requestedOrgId };
    },
    bind(context, mutation): AdminResource {
      const own = () => rows.filter(row => row.orgId === context.orgId);
      const find = (id: string) => own().find(row => row.id === id) ?? null;
      return { list: async () => own(), listAll: async () => own(), count: async () => own().length, getById: async id => find(id),
        create: async data => ({ id: randomUUID(), ...data }),
        update: async (id, data) => {
          const row = find(id); if (!row) throw AppError.notFound();
          if (mutation && receipts.has(mutation.operationId)) return receipts.get(mutation.operationId)!;
          if (versioned && mutation?.expectedVersion !== row.version) throw AppError.conflict("Stale version");
          const result = { ...row, ...data, version: row.version + 1 }; Object.assign(row, result);
          if (mutation) receipts.set(mutation.operationId, result);
          return result;
        }, remove: async id => { const row = find(id); if (!row) throw AppError.notFound(); return row; },
      };
    },
    parse: async input => z.object({ name: z.string(), enabled: z.boolean(), extra: z.object({ rate: z.number().nullable(), tags: z.array(z.string()) }) }).strict().parse(input),
    options, transport: "json", formValues: record => ({ name: record.name ?? "", enabled: false, extra: { rate: null, tags: [] } }),
    ...(versioned ? { version: record => Number(record.version) } : {}),
  };
  const schema: AdminSchema = { key, label: key, labelPlural: key, category: "application", listColumns: ["name"], fields: [{ key: "name", type: "text" }], adapter };
  state.schemas.set(key, schema);
  return { schema, options, rows, receipts };
}
const invoke = async (method: keyof Pick<AdminController, "list" | "editForm" | "update" | "createForm">, key: string, role: string, input = {}) => {
  const res = { render: vi.fn(), redirect: vi.fn() }; const next = vi.fn();
  await new AdminController()[method]({ params: { model: key, id: `${key}-a` }, query: { orgId: "org-a" }, body: {}, user: { id: "actor", role }, ...input } as never, res as never, next);
  return { res, next };
};
beforeEach(() => { state.schemas.clear(); state.legacy.mockReset(); state.permission.mockReset(); state.permission.mockResolvedValue(undefined); });

it("registers two independent tenant policies without generic controller branches or global option reads", async () => {
  const document = fixture("documentFixture", "EDITOR", true);
  fixture("equipmentFixture", "STEWARD", false);
  for (const [key, role] of [["documentFixture", "EDITOR"], ["equipmentFixture", "STEWARD"]]) {
    const { res, next } = await invoke("list", key, role);
    expect(next).not.toHaveBeenCalled();
    expect(res.render.mock.calls[0][1].records.map(row => row.orgId)).toEqual(["org-a"]);
    const edit = await invoke("editForm", key, role);
    expect(edit.res.render.mock.calls[0][1]).toMatchObject({ adminQuery: "?orgId=org-a", adminMetadata: { orgId: "org-a" } });
  }
  document.options.mockClear();
  const create = await invoke("createForm", "documentFixture", "EDITOR");
  expect(create.next).not.toHaveBeenCalled();
  expect(create.res.render.mock.calls[0][1].adminMetadata.versionSet).toBe(false);
  document.options.mockClear();
  const denied = await invoke("editForm", "documentFixture", "STEWARD");
  expect(denied.next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  expect(document.options).not.toHaveBeenCalled();
  const wrongOrg = await invoke("list", "documentFixture", "EDITOR", { query: { orgId: "org-b" } });
  expect(wrongOrg.next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  const wrongRecord = await invoke("editForm", "documentFixture", "EDITOR", { params: { model: "documentFixture", id: "documentFixture-b" } });
  expect(wrongRecord.next.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  expect(state.legacy).not.toHaveBeenCalled();
});

it("round-trips nested false/null data, keeps operation identity and delegates stale-version/retry semantics", async () => {
  const fixtureData = fixture("versioned", "EDITOR", true);
  const body = { _csrf: "not-domain-data", _adminOrgId: "org-a", _adminOperationId: randomUUID(), _adminVersion: "1",
    _adminPayload: JSON.stringify({ name: "Changed", enabled: false, extra: { rate: null, tags: ["a"] } }) };
  const updated = await invoke("update", "versioned", "EDITOR", { body });
  expect(updated.next).not.toHaveBeenCalled();
  expect(fixtureData.rows[0]).toMatchObject({ version: 2, enabled: false, extra: { rate: null, tags: ["a"] } });
  expect(updated.res.redirect).toHaveBeenCalledWith("/admin/versioned/versioned-a?orgId=org-a");
  const retry = await invoke("update", "versioned", "EDITOR", { body }); expect(retry.next).not.toHaveBeenCalled();
  expect(fixtureData.rows[0].version).toBe(2);
  const stale = await invoke("update", "versioned", "EDITOR", { body: { ...body, _adminOperationId: randomUUID() } });
  expect(stale.next.mock.calls[0][0]).toMatchObject({ statusCode: 409 });
  const oversized = await invoke("update", "versioned", "EDITOR", { body: { ...body, _adminPayload: "x".repeat(65537) } });
  expect(oversized.next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
  const polluted = await invoke("update", "versioned", "EDITOR", { body: { ...body, _adminPayload: '{"__proto__":{}}' } });
  expect(polluted.next.mock.calls[0][0]).toMatchObject({ statusCode: 400 });
});

it("preserves the inherited unscoped resource interface", async () => {
  const { schema } = fixture("legacy", "EDITOR", false); delete schema.adapter;
  state.legacy.mockReturnValue({ list: async () => [{ id: "legacy-a", name: "Legacy" }], count: async () => 1 });
  const result = await invoke("list", "legacy", "ADMIN");
  expect(result.next).not.toHaveBeenCalled(); expect(state.legacy).toHaveBeenCalledWith("legacy");
  expect(new AdminResourceService().form(schema)).toEqual({});
});

it("rejects readonly records and excludes undeclared/readonly mutation fields in legacy forms", async () => {
  const { schema } = fixture("legacy", "EDITOR", false); delete schema.adapter;
  schema.fields.push({ key: "managed", type: "boolean", readonly: true });
  schema.fieldsForRecord = () => schema.fields.filter(field => field.key !== "managed");
  const update = vi.fn().mockResolvedValue({ id: "legacy-a" });
  state.legacy.mockReturnValue({ getById: async () => ({ id: "legacy-a" }), update });
  const result = await invoke("update", "legacy", "ADMIN", { body: { name: "Safe", managed: false, deletedAt: "forged", _csrf: "token" } });
  expect(result.next).not.toHaveBeenCalled();
  expect(update).toHaveBeenCalledWith("legacy-a", { name: "Safe" }, "actor");
  schema.isRecordReadonly = () => true;
  const denied = await invoke("update", "legacy", "ADMIN", { body: { name: "changed" } });
  expect(denied.next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  expect(update).toHaveBeenCalledOnce();
});
