---
name: creating-routes
description: Use when adding or mounting Express routes. Covers the router-per-feature convention, binding controller methods, applying auth/permission middleware, and mounting in routes/index.ts.
---

# SKILL: Creating Routes

Routers map URLs to controller methods and apply middleware. No logic here.

## Rules
- One router file per feature: `src/routes/<name>.routes.ts`.
- Export a named `Router` (e.g. `widgetRoutes`).
- Bind controller methods: `controller.method.bind(controller)`.
- Apply `requireAuth` (and permission middleware) on mutating routes.
- Mount the router in `src/routes/index.ts`.

## Template
```ts
import { Router } from "express";
import { widgetController } from "../controllers/widget.controller.js";
import { requireAuth } from "../middleware/auth.js";

export const widgetRoutes = Router();

widgetRoutes.get("/", widgetController.list.bind(widgetController));
widgetRoutes.get("/:id", widgetController.getOne.bind(widgetController));
widgetRoutes.post("/", requireAuth, widgetController.create.bind(widgetController));
```

## Mount it
In `src/routes/index.ts`:
```ts
import { widgetRoutes } from "./widget.routes.js";
router.use("/api/widgets", widgetRoutes);
```

## Reference implementation
`src/routes/user.routes.ts` and `src/routes/index.ts`.
