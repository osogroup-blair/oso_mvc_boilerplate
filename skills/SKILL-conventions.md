---
name: project-conventions
description: Read FIRST, before writing any code in this project. Covers the
  non-obvious rules that cause the most errors: ESM .js import extensions,
  file/class naming, the strict layering/dependency-direction rules, singleton
  exports, and the consolidated list of anti-patterns to never commit.
---

# SKILL: Project Conventions

Read this before writing any code. These rules are what keep the codebase
consistent and are the ones most easily gotten wrong.

## ⚠️ ESM import extensions (the #1 gotcha)
This project is ESM (`"type": "module"`). **Relative imports MUST end in `.js`,
even though the source files are `.ts`.**
```ts
import { UserModel } from "../models/user.model.js";   // ✅ correct
import { UserModel } from "../models/user.model";      // ❌ build fails
import { UserModel } from "../models/user.model.ts";   // ❌ build fails
```
Package imports (`express`, `@prisma/client`, `zod`) have no extension. Only
relative paths take `.js`. This trips up almost every first attempt — check it.

## Naming
- Files: `kebab-or-domain.layer.ts` → `user.service.ts`, `user.model.ts`,
  `user.controller.ts`, `user.routes.ts`, `user.schema.ts`.
- Classes: `PascalCase` + layer suffix → `UserService`, `UserModel`.
- Every service/model exports its class AND a shared singleton instance:
  ```ts
  export class UserService extends BaseService { /* … */ }
  export const userService = new UserService();
  ```
  Import the singleton for normal use; import the class only in tests (to inject
  mocks).

## Layering — dependency direction is a HARD rule
Each layer may import only from the layers below it. Check every import against
this table before committing:

| Layer | May import | May NOT import |
|-------|-----------|----------------|
| Route | controllers, middleware | services, models, prisma |
| Controller | services, lib, admin schemas | models, prisma directly |
| Service | models, other services, lib | prisma directly, express req/res |
| Model | lib, prisma | services, controllers |
| View (.hbs / helper) | payload data only | everything (no imports of app code that fetches) |
| Temporal Workflow | Temporal workflow SDK, deterministic contracts | services, models, prisma, config, controllers, routes, Node I/O |
| Temporal Activity | services, integration adapters, typed contracts, logger | controllers, routes, views, prisma, models directly |
| Temporal Worker bootstrap | workflow bundle, activities, config, logger | Express app, HTTP controllers, web server startup |
| Temporal Client gateway | Temporal client SDK, config, logger | controllers, models, prisma, workflow implementation modules |

If you need something from a layer you may not import, the data should be passed
IN from above, not reached UP for.

## Config & environment
- Never read `process.env` outside `src/config/index.ts`.
- To add a variable: (1) add it to the Zod schema in `config/index.ts`,
  (2) add it to `.env.example` with a safe default/placeholder, (3) import the
  typed `config` object where needed.
- Application behavior belongs in database/admin settings where possible. Use
  `.env` for infrastructure secrets and endpoints only, such as Temporal
  connection details and integration credential encryption keys.

## Workflow integration secrets
- Workflow requirements are code-owned metadata; organization bindings are
  admin-managed data.
- Credentials are write-only in admin views and must never be returned through
  safe model projections.
- Activities resolve bound connections through `integration-resolver.service.ts`
  and return only non-secret output to Workflows.
- Never store credentials in Workflow input, signals, queries, state summaries,
  audit logs, browser payloads, or Temporal history.

## Migrated workflow surfaces
- Standalone/showcase workflows should enter the app through
  `src/temporal/workflow-registry.ts`: start form, action forms, state query,
  summary functions, role policy seed, and integration requirements first.
- Use the generic `/workflows`, `/workflow-tasks`, `/workflow-task-tokens`, and
  admin binding/operations screens. Add a workflow-specific route, controller,
  or template only when the generic renderer cannot express a real
  domain-specific interaction.
- Browser action input beyond common `decision`/`comment` fields should be read
  by Workflow signal handlers from `WorkflowHumanActionInput.payload`.

## Anti-patterns — never commit these
- ❌ Prisma import anywhere outside `src/models/` and `src/lib/prisma.ts`.
- ❌ Business logic in a controller or model (belongs in a service).
- ❌ A `try/catch` that swallows an error — always `next(err)`.
- ❌ Returning an ad-hoc JSON shape — use `ok()` / `fail()` from `lib/response.ts`.
- ❌ A raw `throw new Error("…")` for expected failures — use `AppError`.
- ❌ A DB or service call inside a `.hbs` template.
- ❌ `{{{triple-brace}}}` around user-supplied data.
- ❌ Reading `process.env` directly.
- ❌ A hard delete — use the model's `softDelete`.
- ❌ Starting the Temporal Worker from `server.ts` or importing Workflow modules
  into HTTP controllers/services.
- ❌ Passing integration credentials into Workflow code, Workflow history,
  Handlebars views, or audit-log payloads.
- ❌ Adding bespoke routes/views for migrated workflows before trying the
  generic registry/form/task surfaces.

## Reference
Any existing `user.*` file demonstrates every convention above.
