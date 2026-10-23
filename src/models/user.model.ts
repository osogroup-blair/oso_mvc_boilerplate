// User data access. Every query respects the soft-delete convention
// (deletedAt = null) unless explicitly stated otherwise.
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class UserModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.UserWhereInput = {
      ...this.notDeleted,
      ...(params.search
        ? {
            OR: [
              { name: { contains: params.search, mode: "insensitive" } },
              { email: { contains: params.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    return this.db.user.findMany({
      where,
      skip: params.skip,
      take: params.take,
      orderBy: params.orderBy,
      include: { posts: true, role: true },
    });
  }

  count(search?: string) {
    return this.db.user.count({
      where: {
        ...this.notDeleted,
        ...(search
          ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] }
          : {}),
      },
    });
  }

  findById(id: string) {
    return this.db.user.findFirst({
      where: { id, ...this.notDeleted },
      include: { posts: true, role: true },
    });
  }

  findByEmail(email: string) {
    return this.db.user.findFirst({
      where: { email, ...this.notDeleted },
      include: { role: true },
    });
  }

  listActiveBasic() {
    return this.db.user.findMany({
      where: { ...this.notDeleted, isActive: true },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    });
  }

  create(data: Prisma.UserCreateInput) {
    return this.db.user.create({ data });
  }

  createAuthUser(data: { name: string; email: string; passwordHash: string; roleId: string }) {
    return this.db.user.create({
      data,
      include: { role: true },
    });
  }

  update(id: string, data: Prisma.UserUpdateInput) {
    return this.db.user.update({ where: { id }, data });
  }

  updatePassword(id: string, passwordHash: string) {
    return this.db.user.update({ where: { id }, data: { passwordHash } });
  }

  markEmailVerified(id: string) {
    return this.db.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } });
  }


  resetPasswordAndRevokeSessions(id: string, passwordHash: string) {
    return this.db.$transaction([
      this.db.user.update({ where: { id }, data: { passwordHash } }),
      this.db.passwordResetToken.deleteMany({ where: { userId: id } }),
      this.db.session.deleteMany({ where: { userId: id } }),
    ]);
  }

  verifyEmailAndClearTokens(id: string) {
    return this.db.$transaction([
      this.db.user.update({ where: { id }, data: { emailVerifiedAt: new Date() } }),
      this.db.emailVerificationToken.deleteMany({ where: { userId: id } }),
    ]);
  }
  softDelete(id: string) {
    return this.db.user.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}

export const userModel = new UserModel();

