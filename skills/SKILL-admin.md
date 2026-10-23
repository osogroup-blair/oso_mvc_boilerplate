---
name: adding-an-admin-crud-page
description: Use when adding a dynamic admin CRUD page for a model. Covers writing an AdminSchema, all field types (including nested objects, inline-editable arrays of objects, and searchable relations), registering the schema and resource adapter, and how nested-name reconstruction and relation pre-fetching work.
---

# SKILL: Adding an Admin CRUD Page (schema-driven)

The admin area is **schema-driven**: one controller + one list template + one
form template render EVERY model. To add a new admin page you write a schema and
register a resource. You do **not** write new controllers or templates.

## The 4 steps
1. Ensure the model exists (see SKILL-model.md) and a service exists (SKILL-service.md).
2. Create `src/admin/schemas/<name>.schema.ts` describing the fields.
3. Register the schema in `src/admin/schema.registry.ts`.
4. Register a resource adapter in `src/controllers/resourceRegistry.ts`.

That's it. The page is live at `/admin/<key>`.

## Field types
| type | renders as | notes |
|------|-----------|-------|
| `text` `email` `url` `number` | typed input | |
| `boolean` | checkbox | |
| `date` `datetime` | date picker | |
| `textarea` | multi-line | sanitized on save |
| `select` | dropdown | set `options: [...]` |
| `object` | nested fieldset | set `fields: [...]`, stored as JSON |
| `array` (itemType text/number) | repeatable inputs | |
| `array` (itemType object) | **inline-editable table** | set `fields: [...]` for columns |
| `relation` | **searchable dropdown** | set `relation: { model, labelField }`; options pre-fetched by the controller |

## Schema template
```ts
import type { AdminSchema } from "../schema.types.js";

export const widgetSchema: AdminSchema = {
  key: "widget",
  label: "Widget",
  labelPlural: "Widgets",
  listColumns: ["name", "status"],
  fields: [
    { key: "name", type: "text", required: true },
    { key: "status", type: "select", options: ["active", "archived"] },
    { key: "meta", type: "object", fields: [
      { key: "color", type: "text" },
      { key: "size", type: "number" },
    ]},
    { key: "tags", type: "array", itemType: "text" },
    { key: "owner", type: "relation", relation: { model: "user", labelField: "name" } },
    { key: "lineItems", type: "array", itemType: "object", fields: [
      { key: "sku", type: "text" },
      { key: "qty", type: "number" },
    ]},
  ],
};
```

## Register the schema
`src/admin/schema.registry.ts`:
```ts
import { widgetSchema } from "./schemas/widget.schema.js";
register(widgetSchema);
```

## Register the resource
`src/controllers/resourceRegistry.ts` — adapt the service to the `AdminResource`
interface (copy the `userResource` block):
```ts
import { widgetService } from "../services/widget.service.js";

const widgetResource: AdminResource = {
  list: (p) => widgetService.list(p) as any,
  listAll: () => widgetService.list({ skip: 0, take: 1000, orderBy: { name: "asc" } }) as any,
  count: (s) => widgetService.count(s),
  getById: (id) => widgetService.getById(id) as any,
  create: (d, a) => widgetService.create(d as any, a) as any,
  update: (id, d, a) => widgetService.update(id, d as any, a) as any,
  remove: (id, a) => widgetService.remove(id, a) as any,
};
resources.set("widget", widgetResource);
```

## How nesting works (important)
- Handlebars cannot recurse. All field rendering happens in the TS helper
  `src/views/helpers/renderField.ts`.
- Nested names encode the path: `address[city]`, `lineItems[0][sku]`. Express's
  `urlencoded({ extended: true })` reconstructs these into nested objects/arrays
  on submit — so `req.body` already has the right shape.
- **Relation options are pre-fetched by the controller**, never by the view.
  `fetchRelationOptions()` walks the schema, loads each relation's records via its
  resource, and injects `{ id, label }[]` into the payload keyed by field key.
- Array-of-objects rows are cloned client-side from a `<template>` (see
  `public/js/admin.js`), with `__i__` replaced by the new row index.

## Reference implementation
- Schema: `src/admin/schemas/user.schema.ts` (uses every field type)
- Controller: `src/controllers/admin.controller.ts`
- Helper: `src/views/helpers/renderField.ts`
- Templates: `src/views/admin/{list,form}.hbs`


## October 20 blueprint contract update

The current contracts and limits are in `docs/blueprint/EXTENSION-CONTRACTS.md`
and `docs/blueprint/DECISIONS.md`. Models may own transactional command/receipt
persistence while services own authorization/business policy. Private files
require an explicit policy rather than a permissive singleton. General audit
uses metadata only. Tenant admin adapters must resolve access before record or
option reads and delegate CAS/receipt semantics to resource services/models.
Existing self-hosted Temporal executions require reviewed prior histories
before Workflow command changes; an empty corpus is a blocked release gate.
