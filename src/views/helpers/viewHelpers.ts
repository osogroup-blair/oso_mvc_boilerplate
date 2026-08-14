// General-purpose view helpers (non-admin). Registered in app.ts.
import type Handlebars from "handlebars";

// Known CMS block types → their partial. Adding a block type means adding a
// partial in views/partials/blocks/ AND listing it here.
const BLOCK_PARTIALS = new Set([
  "heading",
  "paragraph",
  "image",
  "quote",
  "list",
  "cta",
]);

export function registerViewHelpers(hbs: typeof Handlebars) {
  // Equality helper for template conditionals: {{#if (eq level 2)}}
  hbs.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  hbs.registerHelper("concat", (...args: unknown[]) => args.slice(0, -1).map((part) => String(part ?? "")).join(""));

  // Active-link helper for the admin sidebar.
  // Returns true when currentPath starts with href.
  // Special-cases "/admin" exact match so Dashboard doesn't stay active
  // while navigating into sub-sections. Trailing slashes are normalised.
  hbs.registerHelper("isActive", (href: unknown, currentPath: unknown) => {
    const h = String(href ?? "").replace(/\/$/, "");
    const p = String(currentPath ?? "").replace(/\/$/, "");
    if (h === "/admin") return p === "/admin";
    return p.startsWith(h);
  });

  // Resolve a block type to a safe partial path. Unknown types fall back to a
  // no-op partial so a bad block never crashes the whole page render.
  hbs.registerHelper("blockPartial", (type: unknown) => {
    const t = String(type ?? "");
    return BLOCK_PARTIALS.has(t) ? `blocks/${t}` : "blocks/unknown";
  });

  // Serialize objects/arrays to JSON string for JS injection
  hbs.registerHelper("json", (context: unknown) => {
    return JSON.stringify(context ?? []);
  });
}
