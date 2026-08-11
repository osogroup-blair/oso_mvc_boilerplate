import type { AdminSchema } from "../schema.types.js";

export const navigationItemSchema: AdminSchema = {
  key: "navigationItem",
  label: "Navigation Link",
  labelPlural: "Navigation Links",
  category: "system",
  listColumns: ["label", "url", "order", "parentId"],
  fields: [
    { key: "label", type: "text", required: true },
    { key: "url", type: "text", required: true, help: "URL path, e.g. '/about-us' or 'https://google.com'" },
    { key: "order", type: "number", required: true, help: "Order to display in the menu (lower numbers appear first)." },
    { key: "parentId", type: "relation", relation: { model: "navigationItem", labelField: "label" }, help: "Optional parent link for nesting." }
  ],
};
