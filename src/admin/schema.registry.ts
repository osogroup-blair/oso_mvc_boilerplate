// Central registry. Adding a new admin CRUD page = register one schema here.
// Nothing else in the app changes.
import type { AdminSchema } from "./schema.types.js";
import { userSchema } from "./schemas/user.schema.js";
import { pageSchema } from "./schemas/page.schema.js";
import { navigationItemSchema } from "./schemas/navigationItem.schema.js";
import { routeSchema } from "./schemas/route.schema.js";
import { roleSchema } from "./schemas/role.schema.js";
import { projectSchema } from "./schemas/project.schema.js";
import { taskSchema } from "./schemas/task.schema.js";
import { tagSchema } from "./schemas/tag.schema.js";
import { AppError } from "../lib/AppError.js";

const registry = new Map<string, AdminSchema>();

function register(schema: AdminSchema) {
  registry.set(schema.key, schema);
}

// ─── Register schemas here ─────────────────────────────
register(userSchema);
register(pageSchema);
register(navigationItemSchema);
register(routeSchema);
register(roleSchema);
register(projectSchema);
register(taskSchema);
register(tagSchema);


export function getSchema(key: string): AdminSchema {
  const schema = registry.get(key);
  if (!schema) throw AppError.notFound(`Admin schema "${key}"`);
  return schema;
}

export function allSchemas(): AdminSchema[] {
  return [...registry.values()];
}
