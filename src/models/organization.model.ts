import type { CommandMetadata } from "../lib/command-contracts.js";
import type { Prisma } from "@prisma/client";
import { AppError } from "../lib/AppError.js";
import type { OrgRoleValue } from "../lib/orgRoles.js";
type Scope = { actorId: string; roles: OrgRoleValue[]; override: boolean };
import { BaseModel } from "./BaseModel.js";

export class OrganizationModel extends BaseModel {
  findAll(actorId?: string) {
    return this.db.organization.findMany({
      where: { deletedAt: null, ...(actorId ? { members: { some: { userId: actorId, deletedAt: null } } } : {}) },
      include: { _count: { select: { members: { where: { deletedAt: null } } } } },
      orderBy: { createdAt: "desc" },
    });
  }

  findById(id: string) {
    return this.db.organization.findFirst({
      where: { id, deletedAt: null },
      include: {
        members: {
          where: { deletedAt: null },
          include: { user: { select: { id: true, name: true, email: true } } },
          orderBy: { joinedAt: "asc" },
        },
      },
    });
  }

  findBySlug(slug: string) {
    return this.db.organization.findFirst({
      where: { slug, deletedAt: null },
    });
  }

  private async lock(tx: Prisma.TransactionClient, id: string, scope: Scope) {
    await tx.$queryRaw`SELECT id FROM "Organization" WHERE id = ${id} FOR UPDATE`;
    const org = await tx.organization.findFirst({ where: { id, deletedAt: null } });
    if (!org) throw AppError.notFound("Organization");
    if (!scope.override && !await tx.orgMember.findFirst({ where: { orgId: id, userId: scope.actorId, deletedAt: null, role: { in: scope.roles } } })) throw AppError.forbidden();
  }

  createWithOwner(data: { name: string; slug: string; logoUrl?: string }, actorId: string, command?: CommandMetadata) {
    return this.mutate("organization.create", "Organization", actorId, tx => tx.organization.create({
      data: { ...data, members: { create: { userId: actorId, role: "OWNER" } } },
    }), undefined, command, (tx, id) => tx.organization.findUniqueOrThrow({ where: { id } }));
  }

  updateAuthorized(id: string, data: { name?: string; logoUrl?: string }, scope: Scope, command?: CommandMetadata) {
    return this.mutate("organization.update", "Organization", scope.actorId, async tx => {
      await this.lock(tx, id, scope);
      return tx.organization.update({ where: { id }, data });
    }, id, command, (tx, resultId) => tx.organization.findUniqueOrThrow({ where: { id: resultId } }));
  }

  deleteAuthorized(id: string, scope: Scope, command?: CommandMetadata) {
    return this.mutate("organization.delete", "Organization", scope.actorId, async tx => {
      await this.lock(tx, id, scope);
      return tx.organization.update({ where: { id }, data: { deletedAt: new Date() } });
    }, id, command, (tx, resultId) => tx.organization.findUniqueOrThrow({ where: { id: resultId } }));
  }

  addMemberAuthorized(orgId: string, userId: string, role: OrgRoleValue, scope: Scope, command?: CommandMetadata) {
    return this.mutate("organization.member_add", "Organization", scope.actorId, async tx => {
      await this.lock(tx, orgId, scope);
      if (!await tx.user.findFirst({ where: { id: userId, isActive: true, deletedAt: null } })) throw AppError.notFound("User");
      const existing = await tx.orgMember.findUnique({ where: { orgId_userId: { orgId, userId } } });
      if (existing && !existing.deletedAt) throw AppError.conflict("Already a member");
      return tx.orgMember.upsert({ where: { orgId_userId: { orgId, userId } },
        create: { orgId, userId, role }, update: { role, deletedAt: null } });
    }, orgId, command, (tx, resultId) => tx.orgMember.findUniqueOrThrow({ where: { id: resultId } }));
  }

  changeMemberAuthorized(orgId: string, memberId: string, role: OrgRoleValue | undefined, scope: Scope, command?: CommandMetadata) {
    return this.mutate(role ? "organization.member_role" : "organization.member_remove", "Organization", scope.actorId, async tx => {
      await this.lock(tx, orgId, scope);
      const member = await tx.orgMember.findFirst({ where: { id: memberId, orgId, deletedAt: null } });
      if (!member) throw AppError.notFound("Membership");
      // A concurrently promoted target must not be changed with MEMBER-only authority.
      if (!scope.override && scope.roles.includes("ADMIN") && member.role !== "MEMBER") throw AppError.forbidden();
      if (member.role === "OWNER" && role !== "OWNER" && await tx.orgMember.count({ where: { orgId, role: "OWNER", deletedAt: null } }) <= 1) throw AppError.conflict("Organization must retain an owner");
      return tx.orgMember.update({ where: { id: memberId }, data: role ? { role } : { deletedAt: new Date() } });
    }, orgId, command, (tx, resultId) => tx.orgMember.findUniqueOrThrow({ where: { id: resultId } }));
  }
}

export const organizationModel = new OrganizationModel();
