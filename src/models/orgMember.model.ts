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

  add(orgId: string, userId: string, role: OrgRoleValue = "MEMBER", actorId?: string) {
    return this.mutate("orgMember.add", "OrgMember", actorId, tx => tx.orgMember.create({ data: { orgId, userId, role } }));
  }

  changeRole(id: string, role: OrgRoleValue, actorId?: string) {
    return this.mutate("orgMember.changeRole", "OrgMember", actorId, tx => tx.orgMember.update({ where: { id }, data: { role } }), id);
  }

  remove(id: string, actorId?: string) {
    return this.mutate("orgMember.remove", "OrgMember", actorId, tx => tx.orgMember.update({
      where: { id },
      data: { deletedAt: new Date() },
    }), id);
  }

  countOwners(orgId: string) {
    return this.db.orgMember.count({
      where: { orgId, role: "OWNER", deletedAt: null },
    });
  }
}

export const orgMemberModel = new OrgMemberModel();
