import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthService } from "../../src/services/auth.service.js";

vi.mock("../../src/lib/prisma.js", () => ({
  prisma: {
    session: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      create: vi.fn(),
      update: vi.fn(),
    },
    role: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    passwordResetToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    emailVerificationToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    siteSetting: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn(),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(),
  },
}));

const makeUserModel = () => ({
  findByEmail: vi.fn(),
  findById: vi.fn(),
  createAuthUser: vi.fn(),
  resetPasswordAndRevokeSessions: vi.fn().mockResolvedValue([]),
  verifyEmailAndClearTokens: vi.fn().mockResolvedValue([]),
});

describe("AuthService", () => {
  let userModel: ReturnType<typeof makeUserModel>;
  let service: AuthService;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("../../src/lib/prisma.js");
    vi.mocked(prisma.$transaction).mockImplementation(((operation: any) => typeof operation === "function" ? operation(prisma) : Promise.all(operation)) as any);
    userModel = makeUserModel();
    service = new AuthService(userModel as any);
    vi.spyOn(service.log, "info");
  });

  it("hashes password and verifies successfully", () => {
    const password = "mySecurePassword123";
    const hash = service.hashPassword(password);
    
    expect(hash).toContain(":");
    expect(service.comparePassword(password, hash)).toBe(true);
    expect(service.comparePassword("wrongPassword", hash)).toBe(false);
  });

  it("fails login with incorrect password", async () => {
    const password = "mySecurePassword123";
    const hash = service.hashPassword(password);
    
    userModel.findByEmail.mockResolvedValue({
      id: "u1",
      email: "test@example.com",
      passwordHash: hash,
      isActive: true,
    });

    await expect(service.login("test@example.com", "wrongPassword")).rejects.toMatchObject({
      statusCode: 401,
      message: "Invalid credentials",
    });
  });

  it("succeeds login with correct password", async () => {
    const password = "mySecurePassword123";
    const hash = service.hashPassword(password);
    
    userModel.findByEmail.mockResolvedValue({
      id: "u1",
      email: "test@example.com",
      passwordHash: hash,
      isActive: true,
    });

    const result = await service.login("test@example.com", password);
    expect(result).toHaveProperty("token");
    expect(result.user.id).toBe("u1");
  });

  it("registers a new user and generates verification token", async () => {
    const { prisma } = await import("../../src/lib/prisma.js");
    userModel.findByEmail.mockResolvedValue(null);
    (prisma.role.findUnique as any).mockResolvedValue({ id: "r-user", name: "User" });
    userModel.createAuthUser.mockResolvedValue({
      id: "u-new",
      name: "New User",
      email: "newuser@example.com",
      roleId: "r-user",
    });

    const result = await service.register({
      name: "New User",
      email: "newuser@example.com",
      password: "Password123!",
    });

    expect(result.user.id).toBe("u-new");
    expect(result).toHaveProperty("verificationToken");
    expect(prisma.emailVerificationToken.create).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(service.log.info).mock.calls)).not.toContain(result.verificationToken);
  });

  it("requests password reset for existing active user", async () => {
    const { prisma } = await import("../../src/lib/prisma.js");
    userModel.findByEmail.mockResolvedValue({
      id: "u1",
      email: "test@example.com",
      isActive: true,
    });

    const result = await service.requestPasswordReset("test@example.com");

    expect(result).toHaveProperty("resetToken");
    expect(prisma.passwordResetToken.create).toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(service.log.info).mock.calls)).not.toContain(result.resetToken);
  });

  it("resets password successfully given valid token", async () => {
    const { prisma } = await import("../../src/lib/prisma.js");
    (prisma.passwordResetToken.findUnique as any).mockResolvedValue({
      id: "t1",
      userId: "u1",
      token: "hashed-token",
      expiresAt: new Date(Date.now() + 3600000),
    });

    const result = await service.resetPassword("raw-token", "NewSecretPassword123");

    expect(result.message).toContain("updated successfully");
    expect(userModel.resetPasswordAndRevokeSessions).toHaveBeenCalled();
  });

  it("verifies email successfully given valid token", async () => {
    const { prisma } = await import("../../src/lib/prisma.js");
    (prisma.emailVerificationToken.findUnique as any).mockResolvedValue({
      id: "v1",
      userId: "u1",
      token: "hashed-token",
      expiresAt: new Date(Date.now() + 3600000),
    });

    const result = await service.verifyEmail("raw-token");

    expect(result.message).toContain("Email verified successfully");
    expect(userModel.verifyEmailAndClearTokens).toHaveBeenCalled();
  });
  it("never falls back to the first available role during public registration", async () => {
    const { prisma } = await import("../../src/lib/prisma.js");
    userModel.findByEmail.mockResolvedValue(null);
    vi.mocked(prisma.role.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.role.findFirst).mockResolvedValue({ id: "privileged-role", name: "ADMIN" } as never);
    await expect(service.register({ name: "Test", email: "no-default@example.invalid", password: "explicit-password" })).rejects.toMatchObject({ statusCode: 500 });
    expect(userModel.createAuthUser).not.toHaveBeenCalled();
  });
  it("never puts credential records into session view payloads", async () => {
    const { prisma } = await import("../../src/lib/prisma.js");
    vi.mocked(prisma.session.findUnique).mockResolvedValue({ expiresAt: new Date(Date.now() + 60000), user: {
      id: "user", name: "Test", email: "test@example.invalid", roleId: "role", isActive: true,
      passwordHash: "HASH_CANARY", sessions: [{ token: "TOKEN_CANARY" }], role: { id: "role", name: "USER" },
    } } as never);
    const result = await service.verifySession("synthetic-token");
    expect(result).toMatchObject({ id: "user", role: "USER", roleId: "role" });
    expect(JSON.stringify(result)).not.toContain("CANARY");
  });

});

