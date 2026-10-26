import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowCapability } from "@prisma/client";
import { WorkflowCatalogService } from "../../src/services/workflow-catalog.service.js";
import { emptyForm } from "../../src/temporal/forms.js";

const makeModel = () => ({
  upsertCodeFacts: vi.fn(),
  syncIntegrationRequirements: vi.fn(),
  list: vi.fn(),
  count: vi.fn(),
  findById: vi.fn(),
  findBySlug: vi.fn(),
  update: vi.fn(),
  replaceRolePolicy: vi.fn(),
  listEnabledForRole: vi.fn(),
});

const makeRoles = () => ({
  listAll: vi.fn(),
});

const makeAudit = () => ({
  record: vi.fn().mockResolvedValue(undefined),
});

const makePermissions = () => ({
  can: vi.fn(),
});

const makeOrgContext = () => ({
  resolveForUser: vi.fn(),
});

describe("WorkflowCatalogService", () => {
  let model: ReturnType<typeof makeModel>;
  let roles: ReturnType<typeof makeRoles>;
  let audit: ReturnType<typeof makeAudit>;
  let permissions: ReturnType<typeof makePermissions>;
  let orgContext: ReturnType<typeof makeOrgContext>;
  let service: WorkflowCatalogService;

  beforeEach(() => {
    model = makeModel();
    roles = makeRoles();
    audit = makeAudit();
    permissions = makePermissions();
    orgContext = makeOrgContext();
    service = new WorkflowCatalogService(
      model as never,
      roles as never,
      audit as never,
      permissions as never,
      orgContext as never
    );
  });

  it("syncs code facts and integration requirements from registrations", async () => {
    model.upsertCodeFacts.mockResolvedValue({ id: "def-1" });

    await service.syncCodeRegistrations([
      {
        key: "workflow.one",
        slug: "workflow-one",
        workflowType: "workflowOne",
        taskQueue: "oso-workflows",
        contractVersion: 1,
        name: "Workflow One",
        startForm: emptyForm,
        validateStart: (input) => input,
        actions: {},
        integrationRequirements: [
          { key: "crm", providerKey: "synthetic.echo", capabilityKey: "echo", label: "CRM" },
        ],
        summarizeState: () => ({}),
      },
    ]);

    expect(model.upsertCodeFacts).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "workflow.one",
        workflowType: "workflowOne",
        defaultTaskQueue: "oso-workflows",
      })
    );
    expect(model.syncIntegrationRequirements).toHaveBeenCalledWith("def-1", [
      expect.objectContaining({
        workflowDefinitionId: "def-1",
        key: "crm",
        providerKey: "synthetic.echo",
      }),
    ]);
  });

  it("requires global workflow read permission when an active organization is resolved", async () => {
    orgContext.resolveForUser.mockResolvedValue({
      activeOrg: { id: "org-1", name: "Acme", slug: "acme" },
      memberships: [],
      needsSelection: false,
    });
    permissions.can.mockResolvedValue(false);

    await expect(service.getCatalogForUser("user-1", "role-1", "org-1")).rejects.toMatchObject({
      statusCode: 403,
    });
  });

  it("does not silently select an organization when selection is required", async () => {
    orgContext.resolveForUser.mockResolvedValue({
      activeOrg: null,
      memberships: [
        { orgId: "org-1", org: { id: "org-1", name: "One", slug: "one" } },
        { orgId: "org-2", org: { id: "org-2", name: "Two", slug: "two" } },
      ],
      needsSelection: true,
    });

    const result = await service.getCatalogForUser("user-1", "role-1");

    expect(result.workflows).toEqual([]);
    expect(result.needsSelection).toBe(true);
    expect(permissions.can).not.toHaveBeenCalled();
  });

  it("lists enabled workflows for the caller role after permission passes", async () => {
    orgContext.resolveForUser.mockResolvedValue({
      activeOrg: { id: "org-1", name: "Acme", slug: "acme" },
      memberships: [],
      needsSelection: false,
    });
    permissions.can.mockResolvedValue(true);
    model.listEnabledForRole.mockResolvedValue([{ id: "def-1", name: "Workflow One" }]);

    const result = await service.getCatalogForUser("user-1", "role-1", "org-1");

    expect(model.listEnabledForRole).toHaveBeenCalledWith("role-1", [
      WorkflowCapability.VIEW,
      WorkflowCapability.START,
    ]);
    expect(result.workflows).toEqual([{ id: "def-1", name: "Workflow One" }]);
  });

  it("audits role policy replacement", async () => {
    model.findById
      .mockResolvedValueOnce({
        id: "def-1",
        roles: [{ roleId: "role-1", capability: WorkflowCapability.VIEW }],
      })
      .mockResolvedValueOnce({
        id: "def-1",
        roles: [{ roleId: "role-1", capability: WorkflowCapability.START }],
      });
    roles.listAll.mockResolvedValue([{ id: "role-1", name: "ADMIN" }]);

    await service.replaceRolePolicy(
      "def-1",
      [{ roleId: "role-1", capability: WorkflowCapability.START }],
      "actor-1"
    );

    expect(model.replaceRolePolicy).toHaveBeenCalledWith("def-1", [
      { roleId: "role-1", capability: WorkflowCapability.START },
    ], "actor-1");
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "actor-1",
      action: "workflowDefinition.roles.update",
    }));
  });
});
