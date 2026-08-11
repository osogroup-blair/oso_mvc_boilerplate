import { settingModel } from "../models/setting.model.js";
import { auditService } from "./audit.service.js";

// Canonical list of all supported keys and their metadata
export const SETTING_KEYS = {
  // Site Identity
  SITE_NAME: { key: "SITE_NAME", group: "Identity", type: "text", label: "Site Name", help: "The name of this website. Used in page titles.", defaultValue: "My App" },
  SITE_DESCRIPTION: { key: "SITE_DESCRIPTION", group: "Identity", type: "textarea", label: "Site Description", help: "Default meta description for SEO.", defaultValue: "A schema-driven MVC boilerplate application." },
  HOME_PAGE_SLUG: { key: "HOME_PAGE_SLUG", group: "Identity", type: "select", label: "Home Page", help: "Select the published CMS page to serve as the homepage.", defaultValue: "welcome" },

  // Content
  DEFAULT_PAGE_STATUS: { key: "DEFAULT_PAGE_STATUS", group: "Content", type: "select", label: "Default Page Status", help: "Default status for newly created CMS pages.", defaultValue: "DRAFT", options: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
  MAX_BLOCKS_PER_PAGE: { key: "MAX_BLOCKS_PER_PAGE", group: "Content", type: "number", label: "Max Blocks Per Page", help: "Limits the number of content blocks allowed per CMS page.", defaultValue: "20" },

  // Email
  CONTACT_EMAIL: { key: "CONTACT_EMAIL", group: "Email", type: "email", label: "Contact Email", help: "Contact email shown in the footer and main layouts.", defaultValue: "contact@example.com" },
  SUPPORT_URL: { key: "SUPPORT_URL", group: "Email", type: "url", label: "Support Portal URL", help: "URL pointing to your support site.", defaultValue: "https://support.example.com" },
  EMAIL_PROVIDER: { key: "EMAIL_PROVIDER", group: "Email", type: "select", label: "Email Provider", help: "Select mock for logging only, or smtp for actual mail sending.", defaultValue: "mock", options: ["mock", "smtp"] },
  EMAIL_FROM: { key: "EMAIL_FROM", group: "Email", type: "text", label: "Sender Email (From)", help: "Default sender email address for all outgoing communications.", defaultValue: "noreply@example.com" },
  SMTP_HOST: { key: "SMTP_HOST", group: "Email", type: "text", label: "SMTP Host", help: "Hostname of the SMTP server.", defaultValue: "localhost" },
  SMTP_PORT: { key: "SMTP_PORT", group: "Email", type: "number", label: "SMTP Port", help: "Port number of the SMTP server.", defaultValue: "1025" },
  SMTP_USER: { key: "SMTP_USER", group: "Email", type: "text", label: "SMTP User", help: "Username for SMTP server authentication.", defaultValue: "" },
  SMTP_PASS: { key: "SMTP_PASS", group: "Email", type: "text", label: "SMTP Password", help: "Password for SMTP server authentication.", defaultValue: "" },
  SMTP_SECURE: { key: "SMTP_SECURE", group: "Email", type: "boolean", label: "SMTP Secure (SSL/TLS)", help: "Use secure SSL/TLS connection (port 465). If false, standard TLS will upgrade automatically if supported.", defaultValue: "false" },

  // Storage
  STORAGE_PROVIDER: { key: "STORAGE_PROVIDER", group: "Storage", type: "select", label: "Storage Provider", help: "Select local for filesystem storage, or s3 for AWS S3 / Cloudflare R2 storage.", defaultValue: "local", options: ["local", "s3"] },
  STORAGE_LOCAL_DIR: { key: "STORAGE_LOCAL_DIR", group: "Storage", type: "text", label: "Local Uploads Directory", help: "Relative path inside the project root for local file storage.", defaultValue: "public/uploads" },
  STORAGE_PUBLIC_URL_PREFIX: { key: "STORAGE_PUBLIC_URL_PREFIX", group: "Storage", type: "text", label: "Public URL Prefix", help: "Public URL prefix mapping to uploaded files.", defaultValue: "/uploads" },
  S3_BUCKET: { key: "S3_BUCKET", group: "Storage", type: "text", label: "S3 Bucket Name", help: "The name of your cloud storage bucket.", defaultValue: "" },
  S3_REGION: { key: "S3_REGION", group: "Storage", type: "text", label: "S3 Region", help: "S3 bucket region.", defaultValue: "us-east-1" },
  S3_ENDPOINT: { key: "S3_ENDPOINT", group: "Storage", type: "text", label: "S3 Endpoint URL", help: "Custom endpoint (e.g. for Cloudflare R2, MinIO, DigitalOcean Spaces). Leave empty for standard AWS S3.", defaultValue: "" },
  S3_ACCESS_KEY_ID: { key: "S3_ACCESS_KEY_ID", group: "Storage", type: "text", label: "S3 Access Key ID", help: "S3 compatible access key credential.", defaultValue: "" },
  S3_SECRET_ACCESS_KEY: { key: "S3_SECRET_ACCESS_KEY", group: "Storage", type: "text", label: "S3 Secret Access Key", help: "S3 compatible secret key credential.", defaultValue: "" },


  // Security
  MAX_LOGIN_ATTEMPTS: { key: "MAX_LOGIN_ATTEMPTS", group: "Security", type: "number", label: "Max Login Attempts", help: "Number of failed login attempts allowed before lockout.", defaultValue: "10" },
  SESSION_TTL_HOURS: { key: "SESSION_TTL_HOURS", group: "Security", type: "number", label: "Session Expiry (Hours)", help: "Default login session duration in hours.", defaultValue: "24" },
  MAINTENANCE_MODE: { key: "MAINTENANCE_MODE", group: "Security", type: "boolean", label: "Maintenance Mode", help: "Take the visitor-facing site offline.", defaultValue: "false" },
  MAINTENANCE_MESSAGE: { key: "MAINTENANCE_MESSAGE", group: "Security", type: "textarea", label: "Maintenance Message", help: "Message to display on the maintenance screen.", defaultValue: "We are currently performing scheduled maintenance. Please check back shortly." },

  // UI/Appearance
  FOOTER_TEXT: { key: "FOOTER_TEXT", group: "UI & Appearance", type: "text", label: "Footer Copyright Text", help: "Footer disclaimer / copyright notice.", defaultValue: "© 2026 My App. All rights reserved." },
  ACCENT_COLOR: { key: "ACCENT_COLOR", group: "UI & Appearance", type: "text", label: "Accent Color (Hex)", help: "Primary brand accent color for frontend CSS styles.", defaultValue: "#6366f1" },
  LOGO_URL: { key: "LOGO_URL", group: "UI & Appearance", type: "url", label: "Logo Image URL", help: "Optional URL for the website brand logo.", defaultValue: "" },
} as const;

export type SettingKeyName = keyof typeof SETTING_KEYS;

// Cache settings in memory to avoid hitting the DB on every page load
const cache = new Map<string, string>();
let cachePopulated = false;

export const settingService = {
  async initCache(): Promise<void> {
    const allSettings = await settingModel.getAll();
    cache.clear();
    for (const setting of allSettings) {
      cache.set(setting.key, setting.value);
    }
    // Set fallback defaults for any not set in database
    for (const [key, meta] of Object.entries(SETTING_KEYS)) {
      if (!cache.has(key)) {
        cache.set(key, meta.defaultValue);
      }
    }
    cachePopulated = true;
  },

  async get(key: string, defaultValue?: string): Promise<string | undefined> {
    if (!cachePopulated) {
      await this.initCache();
    }
    
    if (cache.has(key)) {
      return cache.get(key);
    }
    
    return defaultValue;
  },

  async set(key: string, value: string, actorId?: string): Promise<void> {
    const before = cache.get(key);
    await settingModel.set(key, value);
    cache.set(key, value);
    
    await auditService.record({
      actorId,
      action: "settings.update",
      entityType: "SiteSetting",
      entityId: key,
      changes: { before, after: value }
    });
  },

  async setMany(entries: Record<string, string>, actorId?: string): Promise<void> {
    const before = await this.getAll();
    
    for (const [key, value] of Object.entries(entries)) {
      await settingModel.set(key, value);
      cache.set(key, value);
    }

    await auditService.record({
      actorId,
      action: "settings.updateMany",
      entityType: "SiteSetting",
      entityId: "global",
      changes: { before, after: entries }
    });
  },
  
  async getAll(): Promise<Record<string, string>> {
    if (!cachePopulated) {
      await this.initCache();
    }
    return Object.fromEntries(cache.entries());
  }
};
