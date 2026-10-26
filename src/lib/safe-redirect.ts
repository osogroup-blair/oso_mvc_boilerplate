/* eslint-disable no-control-regex -- Explicitly reject browser control characters. */
/** Browser redirects may only target an application-relative path. */
export function safeRedirect(value: unknown, fallback = "/admin"): string {
  if (typeof value !== "string" || value.length > 2048) return fallback;
  let decoded = value;
  for (let i = 0; i < 4; i++) {
    if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded)) return fallback;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch { return fallback; }
  }
  if (!decoded.startsWith("/") || decoded.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(decoded)) return fallback;
  return new URL(value, "https://application.invalid").origin === "https://application.invalid" ? value : fallback;
}
