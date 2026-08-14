import { describe, it, expect, vi, beforeEach } from "vitest";
import { EmailService } from "../../src/services/email.service.js";
import { settingService } from "../../src/services/setting.service.js";
import nodemailer from "nodemailer";

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ messageId: "smtp-test-id" }),
    }),
  },
}));

vi.mock("../../src/services/setting.service.js", () => ({
  settingService: {
    get: vi.fn(),
  },
}));

describe("EmailService", () => {
  let service: EmailService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new EmailService();
    // Spy on the logger to verify output
    vi.spyOn(service.log, "info");
    vi.spyOn(service.log, "error");
  });

  it("sends email via mock provider by default when EMAIL_PROVIDER is mock", async () => {
    vi.mocked(settingService.get).mockImplementation(async (key) => {
      if (key === "EMAIL_PROVIDER") return "mock";
      if (key === "EMAIL_FROM") return "noreply@example.com";
      if (key === "SITE_NAME") return "Test App";
      return "";
    });

    const result = await service.send({
      to: "recipient@example.com",
      subject: "Welcome",
      templateName: "welcome",
      context: { name: "John Doe", verificationUrl: "http://localhost/verify" },
    });

    expect(result.mock).toBe(true);
    expect(service.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "recipient@example.com",
        subject: "Welcome",
        context: expect.objectContaining({ verificationUrl: "[redacted]" }),
      }),
      expect.stringContaining("Mock Email Sent")
    );
  });

  it("redacts workflow task token URLs from mock email logs", async () => {
    vi.mocked(settingService.get).mockImplementation(async (key) => {
      if (key === "EMAIL_PROVIDER") return "mock";
      if (key === "EMAIL_FROM") return "noreply@example.com";
      if (key === "SITE_NAME") return "Test App";
      return "";
    });

    await service.send({
      to: "recipient@example.com",
      subject: "Workflow task awaiting your response",
      templateName: "workflow-task",
      context: {
        taskUrl: "https://app.example.com/workflow-task-tokens/raw-token",
        expiresAt: "2026-08-14T00:00:00.000Z",
      },
    });

    expect(service.log.info).toHaveBeenCalledWith(
      expect.objectContaining({
        context: {
          taskUrl: "[redacted]",
          expiresAt: "2026-08-14T00:00:00.000Z",
        },
      }),
      expect.stringContaining("Mock Email Sent")
    );
  });

  it("sends email via SMTP when EMAIL_PROVIDER is smtp", async () => {
    vi.mocked(settingService.get).mockImplementation(async (key) => {
      if (key === "EMAIL_PROVIDER") return "smtp";
      if (key === "EMAIL_FROM") return "noreply@example.com";
      if (key === "SITE_NAME") return "Test App";
      if (key === "SMTP_HOST") return "mail.example.com";
      if (key === "SMTP_PORT") return "587";
      return "";
    });

    const result = await service.send({
      to: "recipient@example.com",
      subject: "Welcome",
      templateName: "welcome",
      context: { name: "John Doe", verificationUrl: "http://localhost/verify" },
    });

    expect(result.messageId).toBe("smtp-test-id");
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "mail.example.com",
        port: 587,
      })
    );
    expect(service.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: "smtp-test-id" }),
      expect.stringContaining("Email sent successfully via SMTP")
    );
  });

  it("handles errors gracefully during template compilation or sending", async () => {
    vi.mocked(settingService.get).mockImplementation(async (key) => {
      if (key === "EMAIL_PROVIDER") return "mock";
      return "";
    });

    // Provide a non-existent template
    await expect(
      service.send({
        to: "recipient@example.com",
        subject: "Welcome",
        templateName: "invalid-template" as any,
        context: { resetUrl: "https://app.example.com/reset/token-value" },
      })
    ).rejects.toThrow();

    expect(service.log.error).toHaveBeenCalled();
    expect(service.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          context: { resetUrl: "[redacted]" },
        }),
      }),
      expect.stringContaining("Failed to send email")
    );
  });
});
