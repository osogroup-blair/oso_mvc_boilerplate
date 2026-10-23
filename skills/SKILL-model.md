---
name: creating-a-model
description: Use when adding a data-access model — a Prisma query wrapper for a table. Covers extending BaseModel, the soft-delete convention, and the standard list/count/findById/create/update/softDelete methods. For schema.prisma edits see data-modeling-and-migrations.
---

# SKILL: Creating a Model

Models are the **only** layer that touches Prisma. They wrap queries and enforce
data conventions (soft delete, search). No business logic lives here.

## Rules
- Extend `BaseModel` (gives you `this.db`, the shared Prisma client).
- Every read must respect soft delete: filter `deletedAt: null`.
- `softDelete()` sets `deletedAt`, it does not hard-delete.
- Expose thin, query-shaped methods: `list`, `count`, `findById`, `create`, `update`, `softDelete`.
- Accept `ListParams` for `list()` so pagination/sort/search is uniform.
- Return Prisma results directly — do not reshape or add logic.

## Template
```ts
import { BaseModel } from "./BaseModel.js";
import type { ListParams } from "../lib/query.js";
import type { Prisma } from "@prisma/client";

export class WidgetModel extends BaseModel {
  private notDeleted = { deletedAt: null };

  list(params: ListParams) {
    const where: Prisma.WidgetWhereInput = {
      ...this.notDeleted,
      ...(params.search ? { name: { contains: params.search, mode: "insensitive" } } : {}),
    };
    return this.db.widget.findMany({ where, skip: params.skip, take: params.take, orderBy: params.orderBy });
  }

  count(search?: string) {
    return this.db.widget.count({ where: { ...this.notDeleted, ...(search ? { name: { contains: search, mode: "insensitive" } } : {}) } });
  }

  findById(id: string) { return this.db.widget.findFirst({ where: { id, ...this.notDeleted } }); }
  create(data: Prisma.WidgetCreateInput) { return this.db.widget.create({ data }); }
  update(id: string, data: Prisma.WidgetUpdateInput) { return this.db.widget.update({ where: { id }, data }); }
  softDelete(id: string) { return this.db.widget.update({ where: { id }, data: { deletedAt: new Date() } }); }
}
```

## Steps to add a model
1. Add the model to `prisma/schema.prisma` (include `deletedAt DateTime?` + `@@index([deletedAt])`).
2. Run `npm run db:migrate`.
3. Create `src/models/<name>.model.ts` from the template above.

## Reference implementation
`src/models/user.model.ts`.


## October 20 blueprint contract update

The current contracts and limits are in `docs/blueprint/EXTENSION-CONTRACTS.md`
and `docs/blueprint/DECISIONS.md`. Models may own transactional command/receipt
persistence while services own authorization/business policy. Private files
require an explicit policy rather than a permissive singleton. General audit
uses metadata only. Tenant admin adapters must resolve access before record or
option reads and delegate CAS/receipt semantics to resource services/models.
Existing self-hosted Temporal executions require reviewed prior histories
before Workflow command changes; an empty corpus is a blocked release gate.
