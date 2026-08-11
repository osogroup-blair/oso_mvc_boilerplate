import type { AdminSchema } from "../schema.types.js";

// Demonstrates: two enum selects, date picker, relation dropdown, nested JSON object.
export const taskSchema: AdminSchema = {
  key: "task",
  label: "Task",
  labelPlural: "Tasks",
  category: "application",
  listColumns: ["title", "status", "priority", "projectId"],
  fields: [
    { key: "title",       type: "text",     required: true },
    { key: "description", type: "textarea" },
    {
      key: "status",
      type: "select",
      options: ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"],
    },
    {
      key: "priority",
      type: "select",
      options: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
    },
    { key: "dueDate", type: "date" },
    {
      key: "projectId",
      label: "Project",
      type: "relation",
      relation: { model: "project", labelField: "name" },
    },
    // Nested "object" field — demonstrates the admin's JSON sub-object fieldset.
    {
      key: "meta",
      type: "object",
      fields: [
        { key: "estimatedHours", type: "number" },
        { key: "storyPoints",    type: "number" },
      ],
    },
  ],
};
