// Route business logic.
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { RouteModel } from "../models/route.model.js";
import { auditService, AuditService } from "./audit.service.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

// The admin form submits allowedRoles as role IDs from the multiRelation field.
// We strip it before passing to Prisma and handle it via setAllowedRoles.
type RouteWriteData = Prisma.RouteCreateInput & { allowedRoles?: string[] };

const RESERVED_PREFIXES = ["/admin", "/api", "/health", "/pages", "/css", "/js"];

export class RouteService extends BaseService {
  constructor(
    private readonly model = new RouteModel(),
    private readonly audit: AuditService = auditService
  ) {
    super("RouteService");
  }

  list(params: ListParams) {
    return this.model.list(params);
  }

  count(search?: string) {
    return this.model.count(search);
  }

  async getById(id: string) {
    const route = await this.model.findById(id);
    if (!route) throw AppError.notFound("Route");
    return route;
  }

  getByPattern(pattern: string) {
    return this.model.findByPattern(pattern);
  }

  validateRoute(pattern: string, targetType: string, targetValue: string) {
    if (!pattern.startsWith("/")) {
      throw AppError.badRequest("Pattern must start with a forward slash '/'");
    }

    const lowerPattern = pattern.toLowerCase();
    for (const prefix of RESERVED_PREFIXES) {
      if (lowerPattern === prefix || lowerPattern.startsWith(prefix + "/")) {
        throw AppError.badRequest(`Pattern cannot start with reserved system prefix "${prefix}"`);
      }
    }

    if (targetType === "REDIRECT" && targetValue === pattern) {
      throw AppError.badRequest("A route cannot redirect to itself");
    }
  }

  async create(data: RouteWriteData, actorId?: string) {
    if (data.targetType === "APP") {
      throw AppError.badRequest("Application routes cannot be created manually.");
    }
    const { allowedRoles: roleIds, ...prismaData } = data;
    this.validateRoute(prismaData.pattern, prismaData.targetType as string, prismaData.targetValue);

    // Check uniqueness manually to prevent hard DB crashes if possible, throwing standard validation error
    const existing = await this.model.findByPattern(prismaData.pattern);
    if (existing) {
      throw AppError.badRequest(`Route pattern "${prismaData.pattern}" already exists`);
    }

    const created = await this.model.create(prismaData as Prisma.RouteCreateInput);
    if (roleIds !== undefined) {
      await this.model.setAllowedRoles(created.id, roleIds);
    }
    await this.audit.record({
      actorId,
      action: "route.create",
      entityType: "Route",
      entityId: created.id,
      changes: { after: created },
    });
    return created;
  }

  async update(id: string, data: RouteWriteData, actorId?: string) {
    const before = await this.getById(id);

    if (before.targetType === "APP") {
      throw AppError.badRequest("Application routes cannot be modified manually.");
    }

    const { allowedRoles: roleIds, ...prismaData } = data;
    const pattern = (prismaData.pattern as string) ?? before.pattern;
    const targetType = (prismaData.targetType as string) ?? before.targetType;
    const targetValue = (prismaData.targetValue as string) ?? before.targetValue;

    this.validateRoute(pattern, targetType, targetValue);

    if (prismaData.pattern && prismaData.pattern !== before.pattern) {
      const existing = await this.model.findByPattern(prismaData.pattern as string);
      if (existing) {
        throw AppError.badRequest(`Route pattern "${prismaData.pattern}" already exists`);
      }
    }

    const updated = await this.model.update(id, prismaData as Prisma.RouteUpdateInput);
    if (roleIds !== undefined) {
      await this.model.setAllowedRoles(id, roleIds);
    }
    await this.audit.record({
      actorId,
      action: "route.update",
      entityType: "Route",
      entityId: id,
      changes: { before, after: updated },
    });
    return updated;
  }

  async remove(id: string, actorId?: string) {
    const route = await this.getById(id);
    if (route.targetType === "APP") {
      throw AppError.badRequest("Application routes cannot be deleted manually.");
    }
    const removed = await this.model.softDelete(id);
    await this.audit.record({
      actorId,
      action: "route.delete",
      entityType: "Route",
      entityId: id,
    });
    return removed;
  }
}

export const routeService = new RouteService();
