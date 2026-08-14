import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { OrgMemberModel, orgMemberModel } from "../models/orgMember.model.js";

export interface ActiveOrganizationContext {
  activeOrg: {
    id: string;
    name: string;
    slug: string;
  } | null;
  memberships: Awaited<ReturnType<OrgMemberModel["findByUser"]>>;
  needsSelection: boolean;
}

export class OrganizationContextService extends BaseService {
  constructor(private readonly members: OrgMemberModel = orgMemberModel) {
    super("OrganizationContextService");
  }

  async resolveForUser(userId: string, requestedOrgId?: string): Promise<ActiveOrganizationContext> {
    const memberships = await this.members.findByUser(userId);
    const activeMemberships = memberships.filter((membership) => !membership.org.deletedAt);

    if (requestedOrgId) {
      const membership = activeMemberships.find((item) => item.orgId === requestedOrgId);
      if (!membership) throw AppError.forbidden("You are not a member of that organization");

      return {
        activeOrg: {
          id: membership.org.id,
          name: membership.org.name,
          slug: membership.org.slug,
        },
        memberships: activeMemberships,
        needsSelection: false,
      };
    }

    if (activeMemberships.length === 1) {
      const [membership] = activeMemberships;
      return {
        activeOrg: {
          id: membership.org.id,
          name: membership.org.name,
          slug: membership.org.slug,
        },
        memberships: activeMemberships,
        needsSelection: false,
      };
    }

    return {
      activeOrg: null,
      memberships: activeMemberships,
      needsSelection: activeMemberships.length > 1,
    };
  }
}

export const organizationContextService = new OrganizationContextService();
