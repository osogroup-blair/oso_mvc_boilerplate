import { BaseModel } from "./BaseModel.js";

export class EmailVerificationTokenModel extends BaseModel {
  create(data: { userId: string; token: string; expiresAt: Date }, actorId?: string) {
    return this.mutate("emailVerificationToken.create", "EmailVerificationToken", actorId, tx => tx.emailVerificationToken.create({ data }));
  }

  findByToken(token: string) {
    return this.db.emailVerificationToken.findUnique({ where: { token } });
  }

  deleteByUserId(userId: string, actorId?: string) {
    return this.mutate("emailVerificationToken.deleteByUserId", "EmailVerificationToken", actorId, tx => tx.emailVerificationToken.deleteMany({ where: { userId } }));
  }
}

export const emailVerificationTokenModel = new EmailVerificationTokenModel();
