import { BaseModel } from "./BaseModel.js";

export class PasswordResetTokenModel extends BaseModel {
  create(data: { userId: string; token: string; expiresAt: Date }, actorId?: string) {
    return this.mutate("passwordResetToken.create", "PasswordResetToken", actorId, tx => tx.passwordResetToken.create({ data }));
  }

  findByToken(token: string) {
    return this.db.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });
  }

  deleteByUserId(userId: string, actorId?: string) {
    return this.mutate("passwordResetToken.deleteByUserId", "PasswordResetToken", actorId, tx => tx.passwordResetToken.deleteMany({ where: { userId } }));
  }
}

export const passwordResetTokenModel = new PasswordResetTokenModel();
