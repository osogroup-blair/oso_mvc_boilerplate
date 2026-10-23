import { beforeAll, afterAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { ProjectModel } from "../../src/models/project.model.js";
const model = new ProjectModel();
let userId: string;
beforeAll(async () => {
  // This suite is opt-in behind the exact owned runtime setup. No app seed/reset.
  const role = await prisma.role.create({ data: { name: `platform-test-${randomUUID()}`, permissions: [] } });
  const user = await prisma.user.create({ data: { name: "Synthetic platform test", email: `${randomUUID()}@example.invalid`, passwordHash: "not-a-real-login", roleId: role.id } });
  userId = user.id;
});
afterAll(async () => { await prisma.$disconnect(); });
it("commits one project/receipt across identical concurrent commands and rejects changed input", async () => {
  const key = randomUUID(); const data = { name: `race-${key}`, description: "PRIVATE DOCUMENT CANARY", owner: { connect: { id: userId } } };
  const [first, second] = await Promise.all([model.createWithReceipt(data, userId, key), model.createWithReceipt(data, userId, key)]);
  expect(first.id).toBe(second.id);
  expect(await prisma.project.count({ where: { name: data.name } })).toBe(1);
  const audits = await prisma.auditLog.findMany({ where: { entityId: first.id, action: "project.create" } });
  expect(audits).toHaveLength(1); expect(JSON.stringify(audits)).not.toContain("PRIVATE DOCUMENT CANARY");
  await expect(model.createWithReceipt({ ...data, name: "changed" }, userId, key)).rejects.toMatchObject({ statusCode: 409 });
});
it("rolls back project creation when the authoritative receipt cannot commit", async () => {
  const key = randomUUID(); const name = `rollback-${key}`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION bp_reject_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic receipt fault'; END; $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER bp_reject_receipt BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION bp_reject_receipt()`);
  try {
    await expect(model.createWithReceipt({ name, owner: { connect: { id: userId } } }, userId, key)).rejects.toThrow();
    expect(await prisma.project.count({ where: { name } })).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER bp_reject_receipt ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION bp_reject_receipt()`);
  }
});
