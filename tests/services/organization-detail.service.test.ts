import { expect, it, vi } from "vitest";
import { OrganizationService } from "../../src/services/organization.service.js";

it("assembles organization detail from active users without controller model access", async () => {
  const org = { id: "org", members: [{ userId: "member" }] };
  const service = new OrganizationService({ findById: vi.fn().mockResolvedValue(org) } as never, { findMembership: async () => ({ role: "OWNER" }) } as never,
    { listActiveBasic: vi.fn().mockResolvedValue([{ id: "member" }, { id: "available" }]) } as never, { actor: async () => ({ id: "actor" }), can: () => true } as never);
  expect(await service.getDetailWithAvailableUsers("org", "actor")).toMatchObject({ org, availableUsers: [{ id: "available" }] });
});
