// Consistent response envelope for every controller.
// JSON consumers and the view layer both rely on this shape.
export interface SuccessEnvelope<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  success: false;
  error: { code: string; message: string; details?: unknown };
}

export function ok<T>(data: T, meta?: Record<string, unknown>): SuccessEnvelope<T> {
  return { success: true, data, ...(meta ? { meta } : {}) };
}

export function fail(code: string, message: string, details?: unknown): ErrorEnvelope {
  return { success: false, error: { code, message, ...(details ? { details } : {}) } };
}
