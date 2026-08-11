import type { AdminSchema } from "../schema.types.js";

export const roleSchema: AdminSchema = {
  key: "role",
  label: "Role",
  labelPlural: "Roles",
  category: "system",
  listColumns: ["name", "description"],
  fields: [
    { key: "name", type: "text", required: true },
    { key: "description", type: "textarea", help: "Purpose of the role" },
    {
      key: "permissions",
      type: "array",
      itemType: "text",
      help: "List of permission actions (e.g. read, create, update, delete)",
    },
  ],
};
