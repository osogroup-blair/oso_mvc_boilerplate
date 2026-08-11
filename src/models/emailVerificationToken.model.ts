import { BaseModel } from "./BaseModel.js";

export class EmailVerificationTokenModel extends BaseModel {
  create(data: { userId: string; token: string; expiresAt: Date }) {
    return this.db.emailVerificationToken.create({ data });
  }

  findByToken(token: string) {
    return this.db.emailVerificationToken.findUnique({ where: { token } });
  }

  deleteByUserId(userId: string) {
    return this.db.emailVerificationToken.deleteMany({ where: { userId } });
  }
}

export const emailVerificationTokenModel = new EmailVerificationTokenModel();
