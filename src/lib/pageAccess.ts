import { AppError } from "./AppError.js";

/** Accept the real PageRole/RouteRole projection and explicit legacy string lists. */
export function allowedRoleNames(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw AppError.forbidden("Invalid page access policy");
  return value.map(row => {
    if (typeof row === "string" && row) return row;
    if (row && typeof row === "object" && row.role && typeof row.role.name === "string" && row.role.name) return row.role.name as string;
    throw AppError.forbidden("Invalid page access policy");
  });
}
