import type { CommandMetadata } from "../lib/command-contracts.js";
// User data access. Every query respects the soft-delete convention
// (deletedAt = null) unless explicitly stated otherwise.
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

const safeSelect = {
  id: true, name: true, email: true, roleId: true, isActive: true,
  bio: true, address: true, tags: true, emailVerifiedAt: true,
  createdAt: true, updatedAt: true, deletedAt: true,
  role: { select: { id: true, name: true } },
  posts: { where: { deletedAt: null }, select: { id: true, title: true, published: true } },
} satisfies Prisma.UserSelect;

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
      select: safeSelect,
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
      select: safeSelect,
    });
  }

  findAuthorizationById(id: string) {
    return this.db.user.findFirst({ where: { id, deletedAt: null },
      select: { id: true, isActive: true, deletedAt: true, role: { select: { id: true, name: true, permissions: true, deletedAt: true } } } });
  }

  // Credential lookup: only authentication services may use this record.
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

  create(data: Prisma.UserCreateInput, actorId?: string, command?: CommandMetadata) {
    return this.mutate("user.create", "User", actorId, tx => tx.user.create({ data, select: safeSelect }), undefined, command, (tx, resultId) => tx.user.findUniqueOrThrow({ where: { id: resultId }, select: safeSelect }));
  }

  createAuthUser(data: { name: string; email: string; passwordHash: string; roleId: string }, actorId?: string) {
    return this.mutate("user.createAuthUser", "User", actorId, tx => tx.user.create({
      data,
      select: safeSelect,
    }));
  }

  update(id: string, data: Prisma.UserUpdateInput, actorId?: string, command?: CommandMetadata) {
    return this.mutate("user.update", "User", actorId, tx => tx.user.update({ where: { id, deletedAt: null }, data, select: safeSelect }), id, command, (tx, resultId) => tx.user.findUniqueOrThrow({ where: { id: resultId }, select: safeSelect }));
  }

  updatePassword(id: string, passwordHash: string, actorId?: string) {
    return this.mutate("user.updatePassword", "User", actorId, tx => tx.user.update({ where: { id }, data: { passwordHash }, select: safeSelect }), id);
  }

  markEmailVerified(id: string, actorId?: string) {
    return this.mutate("user.markEmailVerified", "User", actorId, tx => tx.user.update({ where: { id }, data: { emailVerifiedAt: new Date() }, select: safeSelect }), id);
  }


  resetPasswordAndRevokeSessions(id: string, passwordHash: string) {
    return this.mutate("user.password_reset_complete", "User", id, async tx => {
      const user = await tx.user.update({ where: { id, deletedAt: null }, data: { passwordHash }, select: safeSelect });
      await tx.passwordResetToken.deleteMany({ where: { userId: id } });
      await tx.session.deleteMany({ where: { userId: id } });
      return user;
    }, id);
  }

  verifyEmailAndClearTokens(id: string) {
    return this.mutate("user.email_verify", "User", id, async tx => {
      const user = await tx.user.update({ where: { id, deletedAt: null }, data: { emailVerifiedAt: new Date() }, select: safeSelect });
      await tx.emailVerificationToken.deleteMany({ where: { userId: id } });
      return user;
    }, id);
  }
  softDelete(id: string, actorId?: string, command?: CommandMetadata) {
    return this.mutate("user.softDelete", "User", actorId, tx => tx.user.update({ where: { id }, data: { deletedAt: new Date() }, select: safeSelect }), id, command, (tx, resultId) => tx.user.findUniqueOrThrow({ where: { id: resultId }, select: safeSelect }));
  }
}

export const userModel = new UserModel();

