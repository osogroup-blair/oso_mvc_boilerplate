// Central error type. Throw this from any layer; the global handler formats it.
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code = "INTERNAL_ERROR",
    details?: unknown
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // expected, handled error (vs a programmer bug)
    this.details = details;
    Error.captureStackTrace(this, this.constructor);
  }

  static notFound(entity = "Resource") {
    return new AppError(`${entity} not found`, 404, "NOT_FOUND");
  }
  static badRequest(message = "Bad request", details?: unknown) {
    return new AppError(message, 400, "BAD_REQUEST", details);
  }
  static unauthorized(message = "Unauthorized") {
    return new AppError(message, 401, "UNAUTHORIZED");
  }
  static forbidden(message = "Forbidden") {
    return new AppError(message, 403, "FORBIDDEN");
  }
  static conflict(message = "Conflict") {
    return new AppError(message, 409, "CONFLICT");
  }
}
