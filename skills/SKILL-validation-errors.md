---
name: validation-and-errors
description: Use when handling input validation, sanitization, or errors — adding
  a Zod schema, deciding where validation belongs, throwing the right error, or
  shaping an error response. Covers the Zod boundary, HTML sanitization, the
  AppError taxonomy, and how errors flow to JSON vs rendered pages.
---

# SKILL: Validation & Errors

## Where validation belongs
Validation happens at the **controller boundary**, before any service is called.
Services trust their inputs; controllers are the gate.

```ts
const createSchema = z.object({ name: z.string().min(1), email: z.string().email() });
// in the handler:
const data = createSchema.parse(req.body);   // throws ZodError → 400 automatically
const created = await widgetService.create(data, req.user?.id);
```
- Parse `req.body` and `req.query` with Zod at the top of the method.
- A `ZodError` is caught by the global handler and returned as a 400 with field
  details — you don't handle it manually, just let it throw and `next(err)`.
- Reuse `listQuerySchema` (in `lib/query.ts`) for list endpoints.

## Sanitization vs validation (different jobs)
- **Validation** (Zod): is the shape/type correct? Reject if not.
- **Sanitization** (`lib/sanitize.ts`): strip dangerous HTML from strings that
  will be stored and later rendered. The admin controller runs `cleanDeep()` on
  the body before persisting. Do the same anywhere you accept rich text.
- Both matter: validate the shape, sanitize the content.

## The AppError taxonomy
Throw `AppError` (from `lib/AppError.js`) for expected failures. Use the factory
methods so status codes and error codes stay consistent:

| Situation | Throw | Status |
|-----------|-------|--------|
| Record doesn't exist | `AppError.notFound("Widget")` | 404 |
| Bad/invalid input not caught by Zod | `AppError.badRequest(msg, details)` | 400 |
| Not logged in | `AppError.unauthorized()` | 401 |
| Logged in but not allowed | `AppError.forbidden()` | 403 |
| Uniqueness/state conflict | `AppError.conflict(msg)` | 409 |
| Anything unexpected | let it throw / `new AppError(msg)` | 500 |

- **Never `throw new Error("…")` for expected failures** — the global handler
  treats unknown errors as a 500 and logs them as bugs.
- Services throw; controllers just `next(err)`. Don't build error responses by
  hand.

## How errors reach the client
The global handler (`middleware/errorHandler.ts`) does this automatically:
- API/JSON requests → `{ success: false, error: { code, message, details } }`
  with the right status.
- Page requests → renders `views/error.hbs`.
- 5xx errors are logged with the request's correlation id; 4xx are not noise.

## Success responses
Wrap every JSON success in the envelope (`lib/response.ts`):
```ts
res.json(ok(data));                 // { success: true, data }
res.json(ok(rows, buildMeta(q, n))); // adds { meta: { page, total, … } }
```

## Reference
`src/controllers/user.controller.ts` (Zod + envelope),
`src/controllers/admin.controller.ts` (sanitize + permissions),
`src/lib/AppError.ts`, `src/middleware/errorHandler.ts`.
