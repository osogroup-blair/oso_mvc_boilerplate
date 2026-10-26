---
name: building-views
description: Use when creating or editing any server-rendered UI — a Handlebars
  template, layout, partial, or view helper. Covers the data-in/HTML-out
  contract, layouts vs partials vs pages, escaping and security, the data-driven
  block-rendering pattern, and when to write a helper. Read before touching any
  .hbs file or views/helpers/*.
---

# SKILL: Building Views

Views turn a **JSON payload** into HTML. They are the V in MVC and obey one
rule above all others: **a view never fetches data.** The controller assembles
everything the view needs; the view only renders.

## The contract
- Controllers `res.render("template", payload)`. The view reads `payload` fields.
- No DB calls, no service calls, no business logic in a template.
- Anything dynamic the view needs (relation options, computed labels, block
  data) is prepared by the controller and placed in the payload.
- If you find yourself wanting data inside a template, stop — add it to the
  controller's payload instead.

## Anatomy
```
views/
  layouts/         Page shells (<html>…). Body injected via {{{body}}}.
    main.hbs         Admin shell
    public.hbs       Visitor-facing shell (SEO meta, minimal chrome)
  partials/        Reusable fragments, auto-registered by name.
    fields/          Admin form field partials
    blocks/          CMS content-block partials (one per block type)
  admin/           Admin pages (list.hbs, form.hbs, index.hbs)
  pages/           Public CMS pages (show.hbs)
  error.hbs        Shared error page
  helpers/         TS helper modules registered in app.ts
```

Pick a layout with `res.render("x", { layout: "public" | "main", ... })`.

## Escaping — security-critical
- `{{value}}` escapes HTML. **This is the default. Use it for all user data.**
- `{{{value}}}` does NOT escape — only for trusted, pre-sanitized HTML you built
  yourself (e.g. the admin `renderFields` helper output). Never wrap user input
  in triple braces.
- Text persisted through the admin is already run through `sanitize.ts`, but the
  template still uses double braces as defense in depth.

## Layouts vs partials vs helpers — which to reach for
- **Layout**: the outer page shell. One per audience (admin, public).
- **Partial**: a reusable chunk of markup. Pure presentation, driven by the
  context passed to it: `{{> blocks/quote this}}`.
- **Helper**: logic a template can't express. Handlebars is logic-less by
  design — no loops-with-index math, no type switches, no recursion. When you
  need those, write a helper in `views/helpers/` and register it in `app.ts`.
  Keep helpers small and presentational; never put business logic there.

## The data-driven view pattern (the important one)
When a payload contains a **list of typed items** and each type renders
differently, do NOT write a giant `{{#if}}` ladder. Use a dynamic partial:

```hbs
{{#each blocks}}
  {{> (blockPartial this.type) this}}
{{/each}}
```

- `blockPartial` (a helper) maps `type` → a partial name, with a safe fallback
  for unknown types so one bad item never crashes the page.
- Each block type gets its own partial in `partials/blocks/`.
- **Adding a new block type = add a partial + list it in the helper's set.**
  No controller or page-template changes.

This is exactly how the CMS renders a Page: the controller hands over the
`blocks` JSON array, the view walks it, and each block renders via its partial.

## Steps to add a public page type
1. Controller fetches data, builds a payload, `res.render("pages/<name>", payload)`.
2. Create `views/pages/<name>.hbs` — presentation only.
3. Reuse or add partials for repeated fragments.
4. Need logic a template can't do? Add a helper in `views/helpers/` and register
   it in `app.ts`.

## Steps to add a CMS block type
1. Add `views/partials/blocks/<type>.hbs`.
2. Add `<type>` to the `BLOCK_PARTIALS` set in `views/helpers/viewHelpers.ts`.
3. (If editable in admin) add the block's fields to the `blocks` field in
   `src/admin/schemas/page.schema.ts`.

## Reference implementations
- Data-driven public view: `src/views/pages/show.hbs` + `partials/blocks/*`
- Dispatch helper: `src/views/helpers/viewHelpers.ts` (`blockPartial`, `eq`)
- Controller that feeds it: `src/controllers/page.controller.ts`
- Recursive admin form helper: `src/views/helpers/renderField.ts`
- Layouts: `src/views/layouts/{main,public}.hbs`


## October 26 audit remediation contract

Scripts must be external or carry nonce="{{@root.cspNonce}}". Do not add inline event-handler attributes; use explicit data actions handled by public/js/ui-actions.js, never eval or Function. Current CSP intentionally retains inline styling but forbids inline script handlers, plugins and framing. Show capability-based controls; services/routes remain the security boundary.

See `docs/blueprint/EXTERNAL-AUDIT-IMPLEMENTATION-2026-10-26.md` and
`docs/blueprint/MUTATION-EVIDENCE-MATRIX.md` for scope and verification.
