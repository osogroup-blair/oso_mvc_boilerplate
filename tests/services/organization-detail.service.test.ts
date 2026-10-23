import { expect, it, vi } from "vitest";
import { OrganizationService } from "../../src/services/organization.service.js";

it("assembles organization detail from active users without controller model access", async () => {
  const org = { id: "org", members: [{ userId: "member" }] };
  const service = new OrganizationService({ findById: vi.fn().mockResolvedValue(org) } as never, {} as never,
    { listActiveBasic: vi.fn().mockResolvedValue([{ id: "member" }, { id: "available" }]) } as never);
  expect(await service.getDetailWithAvailableUsers("org")).toEqual({ org, availableUsers: [{ id: "available" }] });
});
