import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { OrganizationModel, organizationModel } from "../models/organization.model.js";
import { OrgMemberModel, orgMemberModel } from "../models/orgMember.model.js";
import { UserModel, userModel } from "../models/user.model.js";
import type { OrgRoleValue } from "../lib/orgRoles.js";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export class OrganizationService extends BaseService {
  constructor(
    private readonly orgs: OrganizationModel = organizationModel,
    private readonly members: OrgMemberModel = orgMemberModel,
    private readonly users: UserModel = userModel
  ) {
    super("OrganizationService");
  }

  async getAll() {
    return this.orgs.findAll();
  }

  async getById(id: string) {
    const org = await this.orgs.findById(id);
    if (!org) throw AppError.notFound("Organization not found");
    return org;
  }

  async create(data: { name: string; logoUrl?: string }, creatorUserId: string) {
    let slug = slugify(data.name);

    const existing = await this.orgs.findBySlug(slug);
    if (existing) {
      slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const org = await this.orgs.create({ name: data.name, slug, logoUrl: data.logoUrl });

    await this.members.add(org.id, creatorUserId, "OWNER");

    this.log.info({ orgId: org.id, creatorUserId }, "Organization created");
    return org;
  }

  async update(id: string, data: { name?: string; logoUrl?: string }) {
    await this.getById(id);
    return this.orgs.update(id, data);
  }

  async delete(id: string) {
    await this.getById(id);
    await this.orgs.softDelete(id);
    this.log.info({ orgId: id }, "Organization deleted");
  }

  async addMember(orgId: string, userId: string, role: OrgRoleValue = "MEMBER") {
    await this.getById(orgId);

    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound("User not found");

    const existing = await this.members.findMembership(orgId, userId);
    if (existing) throw AppError.conflict("User is already a member of this organization");

    return this.members.add(orgId, userId, role);
  }

  async changeRole(orgId: string, memberId: string, newRole: OrgRoleValue) {
    const membership = await this.members.findByIdInOrg(orgId, memberId);
    if (!membership) throw AppError.notFound("Membership not found");

    if (membership.role === "OWNER" && newRole !== "OWNER") {
      const ownerCount = await this.members.countOwners(orgId);
      if (ownerCount <= 1) {
        throw AppError.badRequest("Organization must have at least one owner");
      }
    }

    return this.members.changeRole(memberId, newRole);
  }

  async removeMember(orgId: string, memberId: string) {
    const membership = await this.members.findByIdInOrg(orgId, memberId);
    if (!membership) throw AppError.notFound("Membership not found");

    if (membership.role === "OWNER") {
      const ownerCount = await this.members.countOwners(orgId);
      if (ownerCount <= 1) {
        throw AppError.badRequest("Cannot remove the last owner of an organization");
      }
    }

    return this.members.remove(memberId);
  }
}

export const organizationService = new OrganizationService();

