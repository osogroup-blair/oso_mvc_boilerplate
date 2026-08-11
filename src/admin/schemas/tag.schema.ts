import type { AdminSchema } from "../schema.types.js";

// Demonstrates: minimal schema for a lookup/vocabulary model.
export const tagSchema: AdminSchema = {
  key: "tag",
  label: "Tag",
  labelPlural: "Tags",
  category: "application",
  listColumns: ["name", "color"],
  fields: [
    { key: "name",  type: "text", required: true },
    { key: "color", type: "text" }, // hex color, e.g. #6366f1
  ],
};
