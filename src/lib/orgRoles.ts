export const ORG_ROLES = ["OWNER", "ADMIN", "MEMBER"] as const;

export type OrgRoleValue = (typeof ORG_ROLES)[number];
