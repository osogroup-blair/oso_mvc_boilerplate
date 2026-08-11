import type { AdminSchema } from "../schema.types.js";

// CMS Page admin. The `blocks` field is an inline-editable table of content
// blocks; `seo` is a nested object. Editors manage page content here, and the
// public renderer at /pages/:slug turns the same JSON into HTML.
export const pageSchema: AdminSchema = {
  key: "page",
  label: "Page",
  labelPlural: "Pages",
  category: "system",
  listColumns: ["title", "slug", "status", "isHardcoded", "filePath"],
  fields: [
    { key: "isHardcoded", type: "boolean", readonly: true, help: "System flag indicating this is a hardcoded view." },
    { key: "filePath", type: "text", readonly: true, help: "The source code file for this hardcoded page (read-only)." },
    { key: "title", type: "text", required: true },
    { key: "slug", type: "text", required: true, help: "URL path, e.g. 'about-us' → /pages/about-us" },
    { key: "status", type: "select", options: ["DRAFT", "PUBLISHED", "ARCHIVED"], required: true },
    {
      key: "allowedRoles",
      type: "multiRelation",
      label: "Allowed Roles",
      help: "Roles allowed to access this page. Leave empty for public access.",
      multiRelation: { model: "role", labelField: "name" },
    },
    {
      key: "seo",
      type: "object",
      label: "SEO",
      fields: [
        { key: "description", type: "textarea", help: "Meta description for search engines." },
        { key: "ogImage", type: "url", label: "OG image URL" },
      ],
    },
    {
      key: "blocks",
      type: "array",
      itemType: "object",
      label: "Content blocks",
      help: "Ordered blocks rendered top-to-bottom on the public page. (Note: Content blocks are ignored for hardcoded pages since their content is defined in the source code.)",
      fields: [
        { key: "type", type: "select", options: ["heading", "paragraph", "image", "quote", "list", "cta"] },
        { key: "text", type: "text" },
        { key: "url", type: "text" },
        { key: "href", type: "text" },
        { key: "label", type: "text" },
      ],
    },
  ],
};
