import { randomUUID, createHash, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { BaseService } from "./BaseService.js";
import { AppError } from "../lib/AppError.js";
import { config } from "../config/index.js";
import { UserModel, userModel } from "../models/user.model.js";
import { RoleModel, roleModel } from "../models/role.model.js";
import { SessionModel, sessionModel } from "../models/session.model.js";
import { PasswordResetTokenModel, passwordResetTokenModel } from "../models/passwordResetToken.model.js";
import { EmailVerificationTokenModel, emailVerificationTokenModel } from "../models/emailVerificationToken.model.js";
import { auditService, AuditService } from "./audit.service.js";
import { emailService, type SendMailOptions } from "./email.service.js";
import { settingService } from "./setting.service.js";
import { emailQueue, isRedisAvailable } from "../lib/queue.js";

export class AuthService extends BaseService {
  constructor(
    private readonly users: UserModel = userModel,
    private readonly audit: AuditService = auditService,
    private readonly roles: RoleModel = roleModel,
    private readonly sessions: SessionModel = sessionModel,
    private readonly passwordResetTokens: PasswordResetTokenModel = passwordResetTokenModel,
    private readonly emailVerificationTokens: EmailVerificationTokenModel = emailVerificationTokenModel,
    private readonly settings: typeof settingService = settingService
  ) {
    super("AuthService");
  }

  /** Enqueue an email if Redis is up, otherwise fire synchronously. */
  private async enqueueOrSend(opts: SendMailOptions) {
    if (isRedisAvailable() && emailQueue) {
      await emailQueue.add(opts.templateName, opts);
      this.log.info({ to: opts.to, template: opts.templateName }, "Email enqueued");
    } else {
      await emailService.send(opts);
    }
  }

  // Hash session / reset token for secure DB storage.
  private hash(input: string): string {
    return createHash("sha256").update(input + config.JWT_SECRET).digest("hex");
  }

  private async publicAppUrl() {
    const publicAppUrl = await this.settings.get("PUBLIC_APP_URL", "http://localhost:3000");
    return (publicAppUrl ?? "http://localhost:3000").replace(/\/+$/, "");
  }

  hashPassword(password: string): string {
    const salt = randomBytes(16).toString("hex");
    const derivedKey = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return `${salt}:${derivedKey.toString("hex")}`;
  }

  comparePassword(password: string, hash: string): boolean {
    const [salt, key] = hash.split(":");
    if (!salt || !key) return false;
    const derivedKey = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
    return timingSafeEqual(Buffer.from(key, "hex"), derivedKey);
  }

  async register(input: { name: string; email: string; password: string }) {
    const email = input.email.toLowerCase().trim();
    const existing = await this.users.findByEmail(email);
    if (existing) {
      throw AppError.conflict("An account with this email address already exists");
    }

    const role = (await this.roles.findByName("User")) ?? (await this.roles.findFirst());
    if (!role) {
      throw new AppError("Default user role is not configured", 500, "INTERNAL_ERROR");
    }

    const passwordHash = this.hashPassword(input.password);
    const user = await this.users.createAuthUser({
      name: input.name,
      email,
      passwordHash,
      roleId: role.id,
    });

    await this.audit.record({
      actorId: user.id,
      action: "user.register",
      entityType: "User",
      entityId: user.id,
      changes: { after: { email: user.email, name: user.name } },
    });

    const rawVerificationToken = randomUUID();
    const verificationTokenHash = this.hash(rawVerificationToken);
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000);

    await this.emailVerificationTokens.create({
      userId: user.id,
      token: verificationTokenHash,
      expiresAt,
    });

    this.log.info({ userId: user.id }, "User registered; email verification token created");

    const publicAppUrl = await this.publicAppUrl();

    this.enqueueOrSend({
      to: user.email,
      subject: "Welcome to our application! Please verify your email",
      templateName: "welcome",
      context: {
        name: user.name,
        verificationUrl: `${publicAppUrl}/auth/verify-email/${rawVerificationToken}`,
      },
    }).catch((err) => {
      this.log.error({ err, userId: user.id }, "Failed to send registration welcome email");
    });

    return {
      user,
      verificationToken: config.isProd ? undefined : rawVerificationToken,
    };
  }

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user) throw AppError.unauthorized("Invalid credentials");

    const userWithPassword = user as typeof user & { passwordHash?: string | null };
    if (!userWithPassword.passwordHash || !this.comparePassword(password, userWithPassword.passwordHash)) {
      throw AppError.unauthorized("Invalid credentials");
    }

    if (!user.isActive) {
      throw AppError.forbidden("Your account is deactivated");
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 3600 * 1000);
    await this.sessions.create({ userId: user.id, token: this.hash(token), expiresAt });

    await this.audit.record({
      actorId: user.id,
      action: "user.login",
      entityType: "User",
      entityId: user.id,
    });

    this.log.info({ userId: user.id }, "User logged in");
    return { token, user };
  }

  async verifySession(token: string) {
    const session = await this.sessions.findByToken(this.hash(token));
    if (!session || session.expiresAt < new Date()) {
      throw AppError.unauthorized("Session invalid or expired");
    }
    const user = session.user;
    if (!user.isActive || user.deletedAt) {
      throw AppError.unauthorized("Account disabled");
    }
    return {
      ...user,
      role: user.role.name,
      roleId: user.role.id,
    };
  }

  async logout(token: string) {
    const hashed = this.hash(token);
    const session = await this.sessions.findByToken(hashed);
    if (session) {
      await this.audit.record({
        actorId: session.userId,
        action: "user.logout",
        entityType: "Session",
        entityId: session.id,
      });
      await this.sessions.deleteByToken(hashed);
    }
  }

  async requestPasswordReset(email: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !user.isActive) {
      return { message: "If an active account exists with that email, password reset instructions have been generated." };
    }

    await this.passwordResetTokens.deleteByUserId(user.id);

    const rawToken = randomUUID();
    const tokenHash = this.hash(rawToken);
    const expiresAt = new Date(Date.now() + 3600 * 1000);

    await this.passwordResetTokens.create({
      userId: user.id,
      token: tokenHash,
      expiresAt,
    });

    await this.audit.record({
      actorId: user.id,
      action: "user.password_reset_request",
      entityType: "User",
      entityId: user.id,
    });

    this.log.info({ userId: user.id }, "Password reset token generated");

    const publicAppUrl = await this.publicAppUrl();

    this.enqueueOrSend({
      to: user.email,
      subject: "Reset your password",
      templateName: "reset-password",
      context: {
        name: user.name,
        resetUrl: `${publicAppUrl}/auth/reset-password/${rawToken}`,
      },
    }).catch((err) => {
      this.log.error({ err, userId: user.id }, "Failed to send password reset email");
    });

    return {
      message: "If an active account exists with that email, password reset instructions have been generated.",
      resetToken: config.isProd ? undefined : rawToken,
    };
  }

  async resetPassword(rawToken: string, newPassword: string) {
    const tokenHash = this.hash(rawToken);
    const resetTokenRecord = await this.passwordResetTokens.findByToken(tokenHash);

    if (!resetTokenRecord || resetTokenRecord.expiresAt < new Date()) {
      throw AppError.badRequest("Invalid or expired password reset token");
    }

    const userId = resetTokenRecord.userId;
    const passwordHash = this.hashPassword(newPassword);

    await this.users.resetPasswordAndRevokeSessions(userId, passwordHash);

    await this.audit.record({
      actorId: userId,
      action: "user.password_reset_complete",
      entityType: "User",
      entityId: userId,
    });

    this.log.info({ userId }, "Password successfully reset");

    return { message: "Password updated successfully. Please log in with your new password." };
  }

  async verifyEmail(rawToken: string) {
    const tokenHash = this.hash(rawToken);
    const verificationRecord = await this.emailVerificationTokens.findByToken(tokenHash);

    if (!verificationRecord || verificationRecord.expiresAt < new Date()) {
      throw AppError.badRequest("Invalid or expired verification token");
    }

    const userId = verificationRecord.userId;

    await this.users.verifyEmailAndClearTokens(userId);

    await this.audit.record({
      actorId: userId,
      action: "user.email_verify",
      entityType: "User",
      entityId: userId,
    });

    this.log.info({ userId }, "Email verified successfully");

    return { message: "Email verified successfully." };
  }
}

export const authService = new AuthService();
