# Skills Index

Each skill teaches one pattern so the codebase is extended **the same way every
time**. Skills carry YAML frontmatter (`name` + `description`) so an agent can
pick the right one without reading them all. Before building, read the relevant
skill; before *anything*, read `SKILL-conventions.md`.

> New to the repo? Start with `../ARCHITECTURE.md` (mental model, file map,
> worked example), then `SKILL-conventions.md`.

## The skills
| When you're… | Read |
|--------------|------|
| Doing anything (gotchas, layering, naming, anti-patterns) | `SKILL-conventions.md` |
| Adding or changing a DB model / running migrations | `SKILL-data-modeling.md` |
| Adding a data-access model | `SKILL-model.md` |
| Adding business logic | `SKILL-service.md` |
| Using auth · permissions · cache · storage · audit | `SKILL-cross-cutting.md` |
| Validating input or handling errors | `SKILL-validation-errors.md` |
| Adding a REST endpoint | `SKILL-controller.md` + `SKILL-route.md` |
| Adding an admin CRUD page | `SKILL-admin.md` |
| Building a server-rendered view / CMS block | `SKILL-views.md` |
| Adding or changing Temporal client, Worker, Workflow, Activity, workflow execution, human task, integration, schedule, operations behavior, or migrated standalone/showcase workflow behavior | `SKILL-temporal.md` |
| Writing or running tests | `SKILL-testing.md` |

## The layered flow (never skip a layer)
```
Route → Controller → Service → Model → Prisma → PostgreSQL
                        ↓
              (permissions · audit · cache · storage)

Temporal Worker → Workflow → Activity → Service → Model → Prisma
```
- Route: URL → controller. No logic.
- Controller: validate + call one service + shape response. No DB.
- Service: business logic. Calls models + cross-cutting services. No Prisma, no req/res.
- Model: Prisma queries only. Soft-delete aware. No logic.
- View: renders a payload. Never fetches.
- Migrated Temporal workflows: register generic start/action forms and
  integration requirements first; use `/workflows` and `/workflow-tasks` unless
  the generic renderer genuinely cannot express the interaction.

Dependency direction is a hard rule — see `SKILL-conventions.md` for the table.

## Adding a whole resource end-to-end
A resource is a vertical slice through every layer. The full worked example
(adding a `Product`) lives in `../ARCHITECTURE.md`. In short:
1. `schema.prisma` → migrate  (SKILL-data-modeling)
2. model  (SKILL-model)
3. service  (SKILL-service)
4. REST controller + routes, optional  (SKILL-controller, SKILL-route)
5. admin page  (SKILL-admin)
6. public view, optional  (SKILL-views)
7. test  (SKILL-testing)
8. seed  (SKILL-data-modeling)

The `user.*` and `page.*` files are the reference implementations to copy.
