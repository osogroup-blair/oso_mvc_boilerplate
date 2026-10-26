import { z } from "zod";
const orgInput = z.object({ name: z.string().min(2).max(100), logoUrl: z.string().url().optional() }).strict();
import { commandMetadata } from "../lib/command-contracts.js";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { OrganizationModel, organizationModel } from "../models/organization.model.js";
import { OrgMemberModel, orgMemberModel } from "../models/orgMember.model.js";
import { UserModel, userModel } from "../models/user.model.js";
import { actorAccessService } from "./actor-access.service.js";
import type { OrgRoleValue } from "../lib/orgRoles.js";

export class OrganizationService extends BaseService {
  constructor(
    private readonly orgs: OrganizationModel = organizationModel,
    private readonly members: OrgMemberModel = orgMemberModel,
    private readonly users: UserModel = userModel,
    private readonly access = actorAccessService,
  ) { super("OrganizationService"); }

  private async scope(orgId: string, actorId: string | undefined, roles: OrgRoleValue[]) {
    const actor = await this.access.actor(actorId);
    const override = this.access.can(actor, "organization:admin");
    const membership = await this.members.findMembership(orgId, actor.id);
    if (!override && (!membership || !roles.includes(membership.role))) throw AppError.forbidden("Organization access denied");
    return { actorId: actor.id, roles, override };
  }

  async getAll(actorId?: string) {
    const actor = await this.access.actor(actorId);
    return this.orgs.findAll(this.access.can(actor, "organization:admin") ? undefined : actor.id);
  }

  async getById(id: string, actorId?: string) {
    await this.scope(id, actorId, ["OWNER", "ADMIN", "MEMBER"]);
    const org = await this.orgs.findById(id);
    if (!org) throw AppError.notFound("Organization");
    return org;
  }

  async getDetailWithAvailableUsers(id: string, actorId?: string) {
    const org = await this.getById(id, actorId);
    const actor = await this.access.actor(actorId);
    const membership = await this.members.findMembership(id, actor.id);
    const override = this.access.can(actor, "organization:admin");
    const isOwner = override || membership?.role === "OWNER";
    const canManage = isOwner || membership?.role === "ADMIN";
    const memberIds = new Set(org.members.map(member => member.userId));
    const availableUsers = canManage && this.access.can(actor, "user:read")
      ? (await this.users.listActiveBasic()).filter(user => !memberIds.has(user.id)) : [];
    return { org: { ...org, members: org.members.map(member => ({ ...member, canManageMember: isOwner || canManage && member.role === "MEMBER" })) }, availableUsers, canManage, isOwner, canDelete: isOwner,
      assignableRoles: isOwner ? ["OWNER", "ADMIN", "MEMBER"] : ["MEMBER"] };
  }

  async create(data: { name: string; logoUrl?: string }, actorId: string, operationId?: string) {
    data = orgInput.parse(data);
    await this.access.require(actorId, "organization:create");
    const slug = data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return this.orgs.createWithOwner({ ...data, slug: `${slug}-${crypto.randomUUID().slice(0, 8)}` }, actorId, commandMetadata(data, operationId));
  }

  async update(id: string, data: { name?: string; logoUrl?: string }, actorId?: string, operationId?: string) {
    data = orgInput.partial().parse(data);
    const scope = await this.scope(id, actorId, ["OWNER", "ADMIN"]);
    return this.orgs.updateAuthorized(id, data, scope, commandMetadata({ id, data }, operationId));
  }

  async delete(id: string, actorId?: string, operationId?: string) {
    const scope = await this.scope(id, actorId, ["OWNER"]);
    return this.orgs.deleteAuthorized(id, scope, commandMetadata({ id }, operationId));
  }

  async addMember(orgId: string, userId: string, role: OrgRoleValue = "MEMBER", actorId?: string, operationId?: string) {
    const scope = await this.scope(orgId, actorId, role === "MEMBER" ? ["OWNER", "ADMIN"] : ["OWNER"]);
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) throw AppError.notFound("User");
    return this.orgs.addMemberAuthorized(orgId, userId, role, scope, commandMetadata({ orgId, userId, role }, operationId));
  }

  async changeRole(orgId: string, memberId: string, newRole: OrgRoleValue, actorId?: string, operationId?: string) {
    const scope = await this.scope(orgId, actorId, ["OWNER", "ADMIN"]);
    const member = await this.members.findByIdInOrg(orgId, memberId);
    if (!member) throw AppError.notFound("Membership");
    if (member.role !== "MEMBER" || newRole !== "MEMBER") scope.roles = ["OWNER"];
    await this.scope(orgId, actorId, scope.roles);
    return this.orgs.changeMemberAuthorized(orgId, memberId, newRole, scope, commandMetadata({ orgId, memberId, newRole }, operationId));
  }

  async removeMember(orgId: string, memberId: string, actorId?: string, operationId?: string) {
    const scope = await this.scope(orgId, actorId, ["OWNER", "ADMIN"]);
    const member = await this.members.findByIdInOrg(orgId, memberId);
    if (!member) throw AppError.notFound("Membership");
    if (member.role !== "MEMBER") scope.roles = ["OWNER"];
    await this.scope(orgId, actorId, scope.roles);
    return this.orgs.changeMemberAuthorized(orgId, memberId, undefined, scope, commandMetadata({ orgId, memberId }, operationId));
  }
}
export const organizationService = new OrganizationService();
