import { Request, Response, NextFunction } from "express";
import { settingService, SETTING_KEYS } from "../../services/setting.service.js";
import { pageService } from "../../services/page.service.js";
import { z } from "zod";

const additionalSettings = Object.fromEntries(Object.entries(SETTING_KEYS).map(([key, meta]) => {
  let field: z.ZodTypeAny = z.string().max(20000);
  if (meta.type === "number") field = z.coerce.number().finite().int().nonnegative();
  if (meta.type === "boolean") field = z.preprocess(value => value === "true" || value === "on" || value === true, z.boolean());
  if (meta.type === "url") field = z.string().url().or(z.literal(""));
  if (meta.type === "email") field = z.string().email();
  if ("options" in meta) field = z.string().refine(value => (meta.options as readonly string[]).includes(value), "Unsupported option");
  return [key, field];
}));
const updateSettingsSchema = z.object(additionalSettings).extend({
  SITE_NAME: z.string().min(1, "Site name is required"),
  SITE_DESCRIPTION: z.string().optional().default(""),
  HOME_PAGE_SLUG: z.string().min(1, "Home page slug is required"),
  DEFAULT_PAGE_STATUS: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
  MAX_BLOCKS_PER_PAGE: z.coerce.number().int().positive().default(20),
  CONTACT_EMAIL: z.string().email("Invalid email address"),
  SUPPORT_URL: z.string().url("Invalid URL").or(z.literal("")),
  MAX_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(10),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24),
  MAINTENANCE_MODE: z.preprocess(val => val === "true" || val === "on" || val === true, z.boolean()),
  MAINTENANCE_MESSAGE: z.string().optional().default(""),
  FOOTER_TEXT: z.string().optional().default(""),
  ACCENT_COLOR: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a valid hex color code"),
  LOGO_URL: z.string().url("Invalid URL").or(z.literal("")),
}).partial();

export const settingAdminController = {
  async index(_req: Request, res: Response, next: NextFunction) {
    try {
      const settings = await settingService.getAll();
      const publishedPages = await pageService.getPublishedPages();

      // Group settings by their metadata categories
      const groupsMap: Record<string, any[]> = {};
      
      for (const [key, meta] of Object.entries(SETTING_KEYS)) {
        const val = settings[key] ?? meta.defaultValue;
        const field = {
          ...meta,
          value: val,
          isBoolean: meta.type === "boolean",
          isText: meta.type === "text" || meta.type === "email" || meta.type === "url",
          isTextarea: meta.type === "textarea",
          isNumber: meta.type === "number",
          isSelect: meta.type === "select",
          isCheckboxChecked: meta.type === "boolean" && (String(val) === "true" || String(val) === "on"),
          options: (meta as any).options || []
        };
        
        if (!groupsMap[meta.group]) {
          groupsMap[meta.group] = [];
        }
        groupsMap[meta.group].push(field);
      }

      const sections = Object.entries(groupsMap).map(([name, fields]) => ({
        name,
        fields
      }));
      
      res.render("admin/settings/index", {
        title: "Site Settings",
        layout: "main",
        sections,
        publishedPages,
        messages: {
          success: _req.query.success ? "Settings updated successfully." : null,
          error: _req.query.error ? decodeURIComponent(_req.query.error as string) : null,
        }
      });
    } catch (error) {
      next(error);
    }
  },

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      // Form submits booleans as checkboxes, if not checked it won't be sent.
      // Pre-assign MAINTENANCE_MODE to false if not sent.
      const body = { ...req.body };
      if (body._fullSettings === "true") for (const [key, meta] of Object.entries(SETTING_KEYS)) {
        if (meta.type === "boolean" && body[key] === undefined) body[key] = "false";
      }
      const data = updateSettingsSchema.parse(body);

      // Convert all values back to string format for storage
      const entries: Record<string, string> = {};
      for (const [key, value] of Object.entries(data)) {
        entries[key] = String(value);
      }
      
      await settingService.setMany(entries, req.user?.id, z.string().uuid().optional().parse(req.body._operationId));
      
      res.redirect("/admin/settings?success=true");
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMsg = error.errors.map(e => `${e.path.join(".")}: ${e.message}`).join(", ");
        res.redirect(`/admin/settings?error=${encodeURIComponent(errorMsg)}`);
      } else {
        next(error);
      }
    }
  },
};
