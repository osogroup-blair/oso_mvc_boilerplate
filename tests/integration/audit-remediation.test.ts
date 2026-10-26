import { beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../src/lib/prisma.js";
import { ProjectService } from "../../src/services/project.service.js";
import { TaskService } from "../../src/services/task.service.js";
import { UserService } from "../../src/services/user.service.js";
import { OrganizationService } from "../../src/services/organization.service.js";
import { RoleModel } from "../../src/models/role.model.js";
import { SessionModel } from "../../src/models/session.model.js";
import { PageModel } from "../../src/models/page.model.js";
import { settingModel } from "../../src/models/setting.model.js";
import { commandMetadata } from "../../src/lib/command-contracts.js";
const projects = new ProjectService(); const tasks = new TaskService(); const organizations = new OrganizationService();
let owner: string; let other: string; let administrator: string; let roleId: string;
beforeAll(async () => {
  const role = await prisma.role.create({ data: { name: `audit-owner-${randomUUID()}`, permissions: ["organization:create"] } }); roleId = role.id;
  const unprivileged = await prisma.role.create({ data: { name: `audit-outsider-${randomUUID()}`, permissions: [] } });
  const adminRole = await prisma.role.create({ data: { name: `audit-admin-${randomUUID()}`, permissions: ["admin:access", "project:update", "task:update", "user:create", "role:update", "organization:admin"] } });
  const create = (roleId: string) => prisma.user.create({ data: { roleId, name: "Synthetic actor", email: `${randomUUID()}@example.invalid`, passwordHash: "HASH_CANARY_NEVER_SERIALIZE" } });
  owner = (await create(role.id)).id; other = (await create(unprivileged.id)).id; administrator = (await create(adminRole.id)).id;
});
it("enforces ownership and nested parent IDs on real SQL without unauthorized writes", async () => {
  const project = await projects.create({ name: "Owned", owner: { connect: { id: owner } } }, owner);
  const task = await tasks.create({ title: "Original", project: { connect: { id: project.id } } }, owner);
  const second = await projects.create({ name: "Second", owner: { connect: { id: owner } } }, owner);
  const tag = await prisma.tag.create({ data: { name: `tag-${randomUUID()}` } });
  for (const operation of [() => projects.update(project.id, { name: "Unauthorized" }, other), () => projects.remove(project.id, other), () => tasks.create({ title: "Unauthorized", project: { connect: { id: project.id } } }, other), () => tasks.update(task.id, { title: "Unauthorized" }, other, project.id), () => tasks.remove(task.id, other, project.id), () => tasks.addTag(task.id, tag.id, other), () => tasks.removeTag(task.id, tag.id, other)]) await expect(operation()).rejects.toMatchObject({ statusCode: 403 });
  await expect(tasks.update(task.id, { title: "Wrong parent" }, owner, second.id)).rejects.toMatchObject({ statusCode: 404 });
  await expect(tasks.remove(task.id, owner, second.id)).rejects.toMatchObject({ statusCode: 404 });
  expect(await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({ title: "Original", deletedAt: null });
  await projects.update(project.id, { name: "Authorized admin" }, administrator);
  await tasks.addTag(task.id, tag.id, owner);
  await tasks.removeTag(task.id, tag.id, owner);
});
it("returns safe user projections for list/detail/create/update", async () => {
  const service = new UserService();
  const created = await service.create({ name: "Safe", email: `${randomUUID()}@example.invalid`, password: "explicit-test-password", roleId }, administrator);
  const detail = await service.getById(owner);
  const rows = await service.list({ skip: 0, take: 1000, orderBy: { name: "asc" } });
  for (const result of [created, detail, rows]) {
    expect(JSON.stringify(result)).not.toContain("passwordHash");
    expect(JSON.stringify(result)).not.toContain("HASH_CANARY");
    expect(JSON.stringify(result)).not.toContain("explicit-test-password");
  }
});
it("converges concurrent create/update receipts and rejects changed input", async () => {
  const project = await projects.create({ name: "Receipt parent", owner: { connect: { id: owner } } }, owner);
  const key = randomUUID();
  const [a, b] = await Promise.all([projects.update(project.id, { name: "One update" }, owner, key), projects.update(project.id, { name: "One update" }, owner, key)]);
  expect(a.id).toBe(b.id);
  const evidence = await prisma.auditLog.findMany({ where: { entityId: project.id, action: "project.update", id: { startsWith: "command-" } } });
  expect(evidence).toHaveLength(1);
  await expect(projects.update(project.id, { name: "Different input" }, owner, key)).rejects.toMatchObject({ statusCode: 409 });
  const taskKey = randomUUID(); const data = { title: "One task", project: { connect: { id: project.id } } };
  const [first, second] = await Promise.all([tasks.create(data, owner, taskKey), tasks.create(data, owner, taskKey)]);
  expect(first.id).toBe(second.id);
  const tag = await prisma.tag.create({ data: { name: `receipt-tag-${randomUUID()}` } });
  const tagKey = randomUUID();
  const [tagA, tagB] = await Promise.all([tasks.addTag(first.id, tag.id, owner, tagKey), tasks.addTag(first.id, tag.id, owner, tagKey)]);
  expect(tagA.id).toBe(tagB.id);
  const removeKey = randomUUID();
  expect(await tasks.removeTag(first.id, tag.id, owner, removeKey)).toEqual(await tasks.removeTag(first.id, tag.id, owner, removeKey));
  await prisma.user.update({ where: { id: owner }, data: { isActive: false } });
  try { await expect(projects.update(project.id, { name: "One update" }, owner, key)).rejects.toMatchObject({ statusCode: 403 }); }
  finally { await prisma.user.update({ where: { id: owner }, data: { isActive: true } }); }
  expect(await prisma.task.count({ where: { projectId: project.id, title: data.title } })).toBe(1);
});
it("scopes organization reads and protects promotions and concurrent last-owner removal", async () => {
  const org = await organizations.create({ name: "Ownership race" }, owner);
  await expect(organizations.getById(org.id, other)).rejects.toMatchObject({ statusCode: 403 });
  await expect(organizations.update(org.id, { name: "stolen" }, other)).rejects.toMatchObject({ statusCode: 403 });
  await expect(organizations.addMember(org.id, other, "OWNER", other)).rejects.toMatchObject({ statusCode: 403 });
  const secondOwner = await organizations.addMember(org.id, other, "OWNER", owner);
  const firstOwner = await prisma.orgMember.findUniqueOrThrow({ where: { orgId_userId: { orgId: org.id, userId: owner } } });
  const results = await Promise.allSettled([organizations.removeMember(org.id, firstOwner.id, owner), organizations.removeMember(org.id, secondOwner.id, other)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(await prisma.orgMember.count({ where: { orgId: org.id, role: "OWNER", deletedAt: null } })).toBe(1);
});
it("rolls back consequential mutations and grouped settings when evidence fails", async () => {
  const project = await projects.create({ name: "Before fault", owner: { connect: { id: owner } } }, owner);
  const role = await prisma.role.create({ data: { name: `rollback-${randomUUID()}`, permissions: [] } });
  const session = await prisma.session.create({ data: { userId: owner, token: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
  const slug = `rollback-${randomUUID()}`;
  const settingKey = `synthetic-${randomUUID()}`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION audit_remediation_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic evidence fault'; END; $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER audit_remediation_fault BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION audit_remediation_fault()`);
  try {
    await expect(projects.update(project.id, { name: "Must roll back" }, owner)).rejects.toThrow();
    await expect(new RoleModel().update(role.id, { permissions: ["user:delete"] }, owner, commandMetadata({ permissions: ["user:delete"] }))).rejects.toThrow();
    await expect(new RoleModel().replacePermissions([{ id: role.id, permissions: ["user:delete"] }, { id: roleId, permissions: [] }], owner)).rejects.toThrow();
    await expect(new SessionModel().deleteById(session.id, owner)).rejects.toThrow();
    await expect(new PageModel().create({ slug, title: "No partial page" }, owner, undefined, [role.id])).rejects.toThrow();
    await expect(organizations.create({ name: "No orphan org" }, owner)).rejects.toThrow();
    await expect(settingModel.setMany({ [settingKey]: "PRIVATE_VALUE_CANARY" }, owner)).rejects.toThrow();
    expect((await prisma.project.findUniqueOrThrow({ where: { id: project.id } })).name).toBe("Before fault");
    expect((await prisma.role.findUniqueOrThrow({ where: { id: role.id } })).permissions).toEqual([]);
    expect(await prisma.session.count({ where: { id: session.id } })).toBe(1);
    expect((await prisma.role.findUniqueOrThrow({ where: { id: roleId } })).permissions).toEqual(["organization:create"]);
    expect(await prisma.page.count({ where: { slug } })).toBe(0);
    expect(await prisma.organization.count({ where: { name: "No orphan org" } })).toBe(0);
    expect(await prisma.siteSetting.count({ where: { key: settingKey } })).toBe(0);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER audit_remediation_fault ON "AuditLog"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION audit_remediation_fault()`);
  }
});
