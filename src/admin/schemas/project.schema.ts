import type { AdminSchema } from "../schema.types.js";

// Demonstrates: enum select, relation dropdown, textarea.
export const projectSchema: AdminSchema = {
  key: "project",
  label: "Project",
  labelPlural: "Projects",
  category: "application",
  listColumns: ["name", "status", "ownerId"],
  fields: [
    { key: "name",        type: "text",     required: true },
    { key: "description", type: "textarea" },
    {
      key: "status",
      type: "select",
      options: ["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"],
    },
    {
      key: "ownerId",
      label: "Owner",
      type: "relation",
      relation: { model: "user", labelField: "name" },
    },
  ],
};
