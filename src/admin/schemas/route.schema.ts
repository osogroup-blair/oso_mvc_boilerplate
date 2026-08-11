import type { AdminSchema } from "../schema.types.js";

export const routeSchema: AdminSchema = {
  key: "route",
  label: "Dynamic Route",
  labelPlural: "Dynamic Routes",
  category: "system",
  listColumns: ["pattern", "targetType", "targetValue", "isActive"],
  fields: [
    { key: "pattern", type: "text", required: true, help: "URL path starting with slash, e.g., '/my-about-us'" },
    { key: "targetType", type: "select", options: ["PAGE", "REDIRECT", "APP"], required: true, help: "Target type of this route." },
    { key: "targetValue", type: "text", required: true, help: "Target destination: Page Slug/ID for PAGE, or URL path/external URL for REDIRECT." },
    { key: "redirectCode", type: "number", help: "Redirect HTTP status code (typically 301 or 302, default is 302)." },
    { key: "isActive", type: "boolean", help: "Whether the route is active." },
    {
      key: "allowedRoles",
      type: "multiRelation",
      label: "Allowed Roles",
      help: "Roles allowed to access this route. Leave empty for public access.",
      multiRelation: { model: "role", labelField: "name" },
    },
  ],
  isRecordReadonly: (record: any) => record.targetType === "APP",
};
