---
name: creating-a-controller
description: Use when adding an HTTP handler — REST (JSON) or server-rendered. Covers Zod validation at the boundary, calling exactly one service, the response envelope, and next(err) error handling.
---

# SKILL: Creating a Controller

Controllers are **thin**. They validate input, call a service, and shape the
response. They contain no business logic and no direct DB access.

## Rules
- Validate `req.body` / `req.query` with a Zod schema at the top of the method.
- Call exactly one service for the primary action.
- Wrap JSON responses in the envelope from `lib/response.ts` (`ok` / `fail`).
- For server-rendered pages, build a plain payload object and `res.render()`.
- Never `try/catch` and swallow — always `next(err)` so the global handler runs.
- Bind methods when wiring routes: `controller.method.bind(controller)`.

## REST template
```ts
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { widgetService } from "../services/widget.service.js";
import { listQuerySchema, toListParams, buildMeta } from "../lib/query.js";
import { ok } from "../lib/response.js";

const createSchema = z.object({ name: z.string().min(1) });

export class WidgetController {
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const query = listQuerySchema.parse(req.query);
      const params = toListParams(query);
      const [rows, total] = await Promise.all([widgetService.list(params), widgetService.count(params.search)]);
      res.json(ok(rows, buildMeta(query, total)));
    } catch (err) { next(err); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const data = createSchema.parse(req.body);
      const created = await widgetService.create(data, req.user?.id);
      res.status(201).json(ok(created));
    } catch (err) { next(err); }
  }
}

export const widgetController = new WidgetController();
```

## Server-rendered controller
Build a JSON payload, then render. The view receives data only — it never
queries. Pre-fetch anything the view needs (e.g. relation options) here.

## Reference implementations
- REST: `src/controllers/user.controller.ts`
- Server-rendered + schema-driven: `src/controllers/admin.controller.ts`
