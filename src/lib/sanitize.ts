// Strip HTML from user-supplied strings to prevent stored XSS.
// Applied in the admin controller before persisting text/textarea fields.
import sanitizeHtml from "sanitize-html";

export function clean(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).trim();
}

export function cleanDeep<T>(value: T): T {
  if (typeof value === "string") return clean(value) as unknown as T;
  if (Array.isArray(value)) return value.map(cleanDeep) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = cleanDeep(v);
    return out as T;
  }
  return value;
}
