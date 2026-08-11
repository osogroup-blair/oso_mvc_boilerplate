import { BaseModel } from "./BaseModel.js";

export class PasswordResetTokenModel extends BaseModel {
  create(data: { userId: string; token: string; expiresAt: Date }) {
    return this.db.passwordResetToken.create({ data });
  }

  findByToken(token: string) {
    return this.db.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });
  }

  deleteByUserId(userId: string) {
    return this.db.passwordResetToken.deleteMany({ where: { userId } });
  }
}

export const passwordResetTokenModel = new PasswordResetTokenModel();
