// The heart of the schema-driven admin: a recursive Handlebars helper.
// Handlebars is logic-less and cannot recurse, so all field rendering —
// including nested objects and arrays of objects — happens here in TS.
//
// The helper emits form controls whose `name` attributes encode the path,
// e.g. address[city], posts[0][title]. A standard body parser reconstructs
// the nested structure on submit.
import Handlebars from "handlebars";
import type { FieldDef, RelationOption } from "../../admin/schema.types.js";

function esc(v: unknown): string {
  return Handlebars.escapeExpression(v == null ? "" : String(v));
}

function humanize(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").replace(/^./, (c) => c.toUpperCase()).trim();
}

interface RenderCtx {
  // dot/bracket path prefix for the name attribute, e.g. "" or "address" or "posts[0]"
  namePrefix: string;
  // pre-fetched relation options, keyed by field key
  relationOptions: Record<string, RelationOption[]>;
}

function nameFor(prefix: string, key: string): string {
  return prefix ? `${prefix}[${key}]` : key;
}

function labelHtml(field: FieldDef): { open: string; close: string } {
  const text = esc(field.label ?? humanize(field.key));
  const req = field.required ? ' <span class="text-red-500">*</span>' : "";
  const help = field.help ? `<p class="text-xs text-gray-500 mt-1">${esc(field.help)}</p>` : "";
  return {
    open: `<label class="block mb-4"><span class="block text-sm font-medium text-gray-700 mb-1">${text}${req}</span>`,
    close: `${help}</label>`,
  };
}

// Render a single scalar input.
function scalarInput(field: FieldDef, name: string, value: unknown): string {
  const ro = field.readonly ? "readonly" : "";
  const base = `name="${esc(name)}" ${ro} class="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none ${field.readonly ? "bg-gray-100" : ""}"`;

  switch (field.type) {
    case "textarea":
      return `<textarea ${base} rows="3">${esc(value)}</textarea>`;
    case "boolean":
      return `<input type="checkbox" name="${esc(name)}" ${value ? "checked" : ""} ${ro} class="h-4 w-4 rounded border-gray-300" />`;
    case "number":
      return `<input type="number" ${base} value="${esc(value)}" />`;
    case "password":
      return `<input type="password" ${base} value="" />`;
    case "email":
      return `<input type="email" ${base} value="${esc(value)}" />`;
    case "url":
      return `<input type="url" ${base} value="${esc(value)}" />`;
    case "date":
      return `<input type="date" ${base} value="${esc(value)}" />`;
    case "datetime":
      return `<input type="datetime-local" ${base} value="${esc(value)}" />`;
    case "select": {
      const opts = (field.options ?? [])
        .map((o) => `<option value="${esc(o)}" ${o === value ? "selected" : ""}>${esc(o)}</option>`)
        .join("");
      return `<select ${base}>${opts}</select>`;
    }
    default:
      return `<input type="text" ${base} value="${esc(value)}" />`;
  }
}

// Searchable relation dropdown. Options are pre-fetched by the controller.
function relationInput(name: string, value: unknown, options: RelationOption[]): string {
  const listId = `dl-${esc(name)}`;
  const current = options.find((o) => o.id === value);
  const opts = options.map((o) => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join("");
  // A datalist gives a native searchable dropdown; the hidden input holds the id.
  return `
    <input list="${listId}" value="${esc(current?.label ?? "")}"
      data-relation-target="${esc(name)}"
      class="w-full rounded border border-gray-300 px-3 py-2 text-sm"
      placeholder="Search…"
      data-relation-input />
    <input type="hidden" name="${esc(name)}" value="${esc(value)}" />
    <datalist id="${listId}">${options.map((o) => `<option data-id="${esc(o.id)}" data-label="${esc(o.label)}" value="${esc(o.label)}"></option>`).join("")}</datalist>
    <noscript><select name="${esc(name)}" class="w-full rounded border px-3 py-2 text-sm">${opts}</select></noscript>`;
}

// Multi-select relation: scrollable checklist of all options, pre-checked by current values.
// `value` is the raw record field: an array of join objects { role: { id, name } } (from Prisma include)
// or a plain string[] of IDs (fallback).
function multiRelationInput(name: string, value: unknown, options: RelationOption[]): string {
  // Extract selected IDs from either Prisma join rows or plain string arrays
  let selectedIds: Set<string>;
  if (Array.isArray(value)) {
    selectedIds = new Set(
      value.map((v) => {
        if (typeof v === "string") return v;
        // Prisma join row: { role: { id } } or { id }
        const obj = v as Record<string, unknown>;
        const nested = (obj.role ?? obj.page ?? obj.route) as Record<string, unknown> | undefined;
        return String(nested?.id ?? obj.id ?? "");
      })
    );
  } else {
    selectedIds = new Set();
  }

  const checkboxes = options
    .map(
      (o) => `
        <label class="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
          <input type="checkbox" name="${esc(name)}[]" value="${esc(o.id)}" ${selectedIds.has(o.id) ? "checked" : ""}
            class="h-4 w-4 rounded border-gray-300 text-blue-600" />
          <span class="text-sm text-gray-700">${esc(o.label)}</span>
        </label>`
    )
    .join("");

  return `
    <div class="border border-gray-200 rounded-lg overflow-y-auto" style="max-height:14rem;">
      ${options.length === 0 ? '<p class="px-3 py-2 text-sm text-gray-400">No options available.</p>' : checkboxes}
    </div>`;
}

// Recursively render one field. Returns an HTML string.
function renderOne(field: FieldDef, value: unknown, ctx: RenderCtx): string {
  const name = nameFor(ctx.namePrefix, field.key);
  const lbl = labelHtml(field);

  // ── Nested single object ──
  if (field.type === "object") {
    const inner = (field.fields ?? [])
      .map((f) => renderOne(f, (value as Record<string, unknown>)?.[f.key], { ...ctx, namePrefix: name }))
      .join("");
    return `
      <fieldset class="border border-gray-200 rounded-lg p-4 mb-4">
        <legend class="text-sm font-semibold text-gray-700 px-2">${esc(field.label ?? humanize(field.key))}</legend>
        ${inner}
      </fieldset>`;
  }

  // ── Array of objects → inline-editable table ──
  if (field.type === "array" && field.itemType === "object") {
    const rows = (Array.isArray(value) ? value : []) as Record<string, unknown>[];
    const cols = field.fields ?? [];
    const head = cols.map((c) => `<th class="text-left text-xs font-medium text-gray-500 px-2 py-1">${esc(c.label ?? humanize(c.key))}</th>`).join("");
    const body = rows
      .map((row, i) => {
        const cells = cols
          .map((c) => `<td class="px-2 py-1">${scalarInput(c, `${name}[${i}][${c.key}]`, row?.[c.key])}</td>`)
          .join("");
        return `<tr data-row>${cells}<td class="px-2 py-1"><button type="button" class="text-red-500 text-xs" data-remove-row>Remove</button></td></tr>`;
      })
      .join("");
    // A template row (index __i__) is cloned by the Add button.
    const templateCells = cols.map((c) => `<td class="px-2 py-1">${scalarInput(c, `${name}[__i__][${c.key}]`, "")}</td>`).join("");
    return `
      <div class="mb-4">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-medium text-gray-700">${esc(field.label ?? humanize(field.key))}</span>
          <button type="button" class="text-blue-600 text-xs" data-add-row>+ Add row</button>
        </div>
        <table class="w-full border border-gray-200 rounded" data-array-table>
          <thead><tr>${head}<th></th></tr></thead>
          <tbody>${body}</tbody>
          <template>${`<tr data-row>${templateCells}<td class="px-2 py-1"><button type="button" class="text-red-500 text-xs" data-remove-row>Remove</button></td></tr>`}</template>
        </table>
        ${field.help ? `<p class="text-xs text-gray-500 mt-1">${esc(field.help)}</p>` : ""}
      </div>`;
  }

  // ── Array of primitives → repeatable inputs ──
  if (field.type === "array") {
    const items = (Array.isArray(value) ? value : []) as unknown[];
    const inputType = field.itemType === "number" ? "number" : "text";
    const rows = items
      .map(
        (v, i) => `
      <div class="flex gap-2 mb-1" data-item>
        <input type="${inputType}" name="${esc(name)}[${i}]" value="${esc(v)}" class="flex-1 rounded border border-gray-300 px-3 py-2 text-sm" />
        <button type="button" class="text-red-500 text-xs" data-remove-item>×</button>
      </div>`
      )
      .join("");
    return `
      <div class="mb-4" data-array-primitive data-name="${esc(name)}" data-input-type="${inputType}">
        <div class="flex items-center justify-between mb-1">
          <span class="text-sm font-medium text-gray-700">${esc(field.label ?? humanize(field.key))}</span>
          <button type="button" class="text-blue-600 text-xs" data-add-item>+ Add</button>
        </div>
        <div data-items>${rows}</div>
        ${field.help ? `<p class="text-xs text-gray-500 mt-1">${esc(field.help)}</p>` : ""}
      </div>`;
  }

  // ── Relation ──
  if (field.type === "relation") {
    const opts = ctx.relationOptions[field.key] ?? [];
    return `${lbl.open}${relationInput(name, value, opts)}${lbl.close}`;
  }

  // ── Multi-Relation ──
  if (field.type === "multiRelation") {
    const opts = ctx.relationOptions[field.key] ?? [];
    return `${lbl.open}${multiRelationInput(name, value, opts)}${lbl.close}`;
  }

  // ── Scalars ──
  return `${lbl.open}${scalarInput(field, name, value)}${lbl.close}`;
}

// Registered as {{{renderFields schema record relationOptions}}}
export function renderFields(fields: FieldDef[], record: unknown, relationOptions: Record<string, RelationOption[]>): Handlebars.SafeString {
  const ctx: RenderCtx = { namePrefix: "", relationOptions: relationOptions ?? {} };
  const html = fields.map((f) => renderOne(f, (record as Record<string, unknown>)?.[f.key], ctx)).join("");
  return new Handlebars.SafeString(html);
}

export function registerAdminHelpers(hbs: typeof Handlebars) {
  hbs.registerHelper("renderFields", renderFields);
  hbs.registerHelper("humanize", humanize);
  hbs.registerHelper("cell", (field: FieldDef, row: Record<string, unknown>) => {
    const v = row?.[field.key];
    if (typeof v === "boolean") return new hbs.SafeString(v ? "✓" : "—");
    
    if (field.type === "relation" && field.relation) {
      const relationKey = field.key.endsWith("Id") ? field.key.slice(0, -2) : field.key;
      const relObj = row?.[relationKey] as Record<string, unknown> | undefined;
      if (relObj && typeof relObj === "object") {
        return esc(relObj[field.relation.labelField] ?? relObj.id);
      }
    }
    return esc(v);
  });
  hbs.registerHelper("lookup_col", (schema: { fields: FieldDef[] }, key: string) =>
    schema.fields.find((f) => f.key === key)
  );
  // Pagination helpers used by admin/list.hbs
  hbs.registerHelper("gt", (a: number, b: number) => a > b);
  hbs.registerHelper("lt", (a: number, b: number) => a < b);
  hbs.registerHelper("inc", (n: number) => n + 1);
  hbs.registerHelper("dec", (n: number) => n - 1);
}
