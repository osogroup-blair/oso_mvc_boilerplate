import { BaseModel } from "./BaseModel.js";

export class OrganizationModel extends BaseModel {
  findAll() {
    return this.db.organization.findMany({
      where: { deletedAt: null },
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

  create(data: { name: string; slug: string; logoUrl?: string }) {
    return this.db.organization.create({ data });
  }

  update(id: string, data: { name?: string; logoUrl?: string }) {
    return this.db.organization.update({ where: { id }, data });
  }

  softDelete(id: string) {
    return this.db.organization.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export const organizationModel = new OrganizationModel();

