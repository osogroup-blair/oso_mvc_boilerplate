import nodemailer from "nodemailer";
import Handlebars from "handlebars";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BaseService } from "./BaseService.js";
import { settingService } from "./setting.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface SendMailOptions {
  to: string;
  subject: string;
  templateName: "welcome" | "reset-password" | "workflow-task";
  context: Record<string, unknown>;
}

export class EmailService extends BaseService {
  private transporter: nodemailer.Transporter | null = null;

  constructor() {
    super("EmailService");
  }

  private async getTransporter(): Promise<nodemailer.Transporter | null> {
    const provider = await settingService.get("EMAIL_PROVIDER");

    if (provider !== "smtp") {
      this.transporter = null;
      return null;
    }

    const host = await settingService.get("SMTP_HOST");
    const port = Number(await settingService.get("SMTP_PORT") || "1025");
    const user = await settingService.get("SMTP_USER") || "";
    const pass = await settingService.get("SMTP_PASS") || "";
    const secure = (await settingService.get("SMTP_SECURE")) === "true";

    const config: any = {
      host,
      port,
      secure,
    };

    if (user || pass) {
      config.auth = { user, pass };
    }

    this.transporter = nodemailer.createTransport(config);
    return this.transporter;
  }

  async send(options: SendMailOptions): Promise<{ messageId?: string; mock?: boolean }> {
    try {
      const from = await settingService.get("EMAIL_FROM") || "noreply@example.com";
      const siteName = await settingService.get("SITE_NAME") || "My App";
      const accentColor = await settingService.get("ACCENT_COLOR") || "#6366f1";
      const footerText = await settingService.get("FOOTER_TEXT") || "";

      // Load and compile Handlebars template
      // Express project's source sits in src/, built in dist/
      const templatePath = join(__dirname, "../views/emails", `${options.templateName}.hbs`);
      const templateSource = await readFile(templatePath, "utf-8");
      const compiledTemplate = Handlebars.compile(templateSource);

      const html = compiledTemplate({
        siteName,
        accentColor,
        footerText,
        ...options.context,
      });

      const transporter = await this.getTransporter();

      if (!transporter) {
        // Fallback Mock Mode: Log the email
        this.log.info(
          {
            to: options.to,
            from,
            subject: options.subject,
            template: options.templateName,
            context: this.redactContext(options.context),
          },
          "Mock Email Sent (EMAIL_PROVIDER is not set to smtp)"
        );
        return { mock: true };
      }

      const info = await transporter.sendMail({
        from: `"${siteName}" <${from}>`,
        to: options.to,
        subject: options.subject,
        html,
      });

      this.log.info({ messageId: info.messageId, to: options.to }, "Email sent successfully via SMTP");
      return { messageId: info.messageId };
    } catch (err) {
      this.log.error({ err, options: this.redactOptions(options) }, "Failed to send email");
      throw err;
    }
  }

  private redactOptions(options: SendMailOptions) {
    return {
      to: options.to,
      subject: options.subject,
      templateName: options.templateName,
      context: this.redactContext(options.context),
    };
  }

  private redactContext(context: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(context).map(([key, value]) => [
        key,
        this.isSensitiveContextKey(key) ? "[redacted]" : value,
      ])
    );
  }

  private isSensitiveContextKey(key: string) {
    return /(url|token|secret|password|credential)/i.test(key);
  }
}

export const emailService = new EmailService();
