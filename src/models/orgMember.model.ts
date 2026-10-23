import { BaseModel } from "./BaseModel.js";
import type { OrgRoleValue } from "../lib/orgRoles.js";

export class OrgMemberModel extends BaseModel {
  findByOrg(orgId: string) {
    return this.db.orgMember.findMany({
      where: { orgId, deletedAt: null },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { joinedAt: "asc" },
    });
  }

  findByUser(userId: string) {
    return this.db.orgMember.findMany({
      where: { userId, deletedAt: null, org: { deletedAt: null } },
      include: { org: true },
      orderBy: { joinedAt: "asc" },
    });
  }

  findMembership(orgId: string, userId: string) {
    return this.db.orgMember.findFirst({
      where: { orgId, userId, deletedAt: null },
    });
  }

  findByIdInOrg(orgId: string, id: string) {
    return this.db.orgMember.findFirst({
      where: { id, orgId, deletedAt: null },
    });
  }

  add(orgId: string, userId: string, role: OrgRoleValue = "MEMBER") {
    return this.db.orgMember.create({ data: { orgId, userId, role } });
  }

  changeRole(id: string, role: OrgRoleValue) {
    return this.db.orgMember.update({ where: { id }, data: { role } });
  }

  remove(id: string) {
    return this.db.orgMember.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  countOwners(orgId: string) {
    return this.db.orgMember.count({
      where: { orgId, role: "OWNER", deletedAt: null },
    });
  }
}

export const orgMemberModel = new OrgMemberModel();
