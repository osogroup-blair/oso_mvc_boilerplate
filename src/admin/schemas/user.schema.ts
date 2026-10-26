import type { AdminSchema } from "../schema.types.js";

// The User admin page — exercises every field type:
//   text, email, select, boolean, textarea, object (address),
//   array of primitives (tags), array of objects / relation (posts).
export const userSchema: AdminSchema = {
  key: "user",
  label: "User",
  labelPlural: "Users",
  category: "system",
  listColumns: ["name", "email", "roleId", "isActive"],
  fields: [
    { key: "name", type: "text", required: true },
    { key: "email", type: "email", required: true },
    { key: "roleId", label: "Role", type: "relation", relation: { model: "role", labelField: "name" }, required: true },
    { key: "password", type: "password", required: false, help: "Required for new accounts (8+ characters). Leave blank on edit to keep the current password." },
    { key: "isActive", type: "boolean" },
    { key: "bio", type: "textarea", help: "Short biography, plain text." },
    {
      key: "address",
      type: "object",
      label: "Address",
      fields: [
        { key: "street", type: "text" },
        { key: "city", type: "text" },
        { key: "zip", type: "text" },
      ],
    },
    { key: "tags", type: "array", itemType: "text", help: "Free-form labels." },
    {
      key: "posts",
      readonly: true,
      type: "array",
      itemType: "object",
      label: "Posts",
      help: "Inline-editable. Each row is a post authored by this user.",
      fields: [
        { key: "id", type: "text", readonly: true },
        { key: "title", type: "text" },
        { key: "published", type: "boolean" },
      ],
    },
  ],
};
