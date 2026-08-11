---
name: data-modeling-and-migrations
description: Use when adding or changing a database model — editing
  prisma/schema.prisma, deciding between a relation, a JSON field, or a scalar
  array, and running migrations. Covers schema conventions, the mandatory
  soft-delete pattern, indexes, enums, and the migration/seed workflow.
---

# SKILL: Data Modeling & Migrations

The database schema lives in `prisma/schema.prisma`. Model *access* is covered
by SKILL-model; this skill covers the *schema* and the migration workflow.

## Mandatory conventions for every model
- Primary key: `id String @id @default(uuid())`.
- Timestamps: `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt`.
- **Soft delete: `deletedAt DateTime?` + `@@index([deletedAt])`.** Every model
  gets this; the app never hard-deletes.
- Index anything you filter or look up by (`@@index([slug])`, foreign keys).

## Choosing a field shape
| You have… | Use | Example in this repo |
|-----------|-----|----------------------|
| A reference to another table you query/join | **relation** (`@relation`) | `Post.author → User` |
| A structured sub-object owned by this row, not queried on its own | **Json** | `User.address`, `Page.seo` |
| An ordered list of structured items owned by this row | **Json** (array) | `Page.blocks` |
| A simple list of scalars | **scalar array** (`String[]`) | `User.tags` |
| A fixed set of values | **enum** | `Role`, `PageStatus` |

Rule of thumb: reach for a relation when you need to query/filter/join the
related data; reach for JSON when it's content that only ever travels with its
parent (like CMS blocks or SEO metadata).

## Migration workflow
```bash
# after editing schema.prisma:
npm run db:migrate          # creates + applies a named migration (prompts for a name)
npm run db:generate         # regenerate the typed client (migrate does this too)
npm run db:seed             # refresh demo data
npm run db:reset            # drop, re-migrate, re-seed (destructive; dev only)
```
- Name migrations for what they do: `add_page_model`, `add_user_avatar`.
- Review the generated SQL in `prisma/migrations/` before committing.
- Never edit an applied migration; add a new one.

## Adding a model end-to-end
1. Add the model to `schema.prisma` with the mandatory conventions above.
2. `npm run db:migrate` (name it).
3. Create the model wrapper (SKILL-model), service (SKILL-service), and — if it
   needs a UI — the admin schema (SKILL-admin).
4. Add seed data in `prisma/seed.ts` (use `upsert` so it stays idempotent).

## Reference
`prisma/schema.prisma` — `User` shows relations + JSON + scalar array together;
`Page` shows JSON content blocks + an enum.
