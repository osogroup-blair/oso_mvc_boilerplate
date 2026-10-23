// Global error handler. MUST be registered last, after all routes.
import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/AppError.js";
import { fail } from "../lib/response.js";
import { logger } from "../lib/logger.js";

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(new AppError(`Route not found: ${req.method} ${req.path}`, 404, "NOT_FOUND"));
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,  _next: NextFunction
) {
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = AppError.badRequest("Validation failed", err.flatten().fieldErrors);
  } else {
    // Errors may embed provider inputs, tokens or private document content.
    appError = new AppError("Internal server error", 500, "INTERNAL_ERROR");
  }

  if (appError.statusCode >= 500) {
    logger.error({ code: appError.code, reqId: req.id }, "Request failed");
  }

  const wantsJson = req.accepts(["html", "json"]) === "json" || req.path.startsWith("/api");
  const payload = fail(appError.code, appError.message, appError.details);

  if (wantsJson) {
    res.status(appError.statusCode).json(payload);
  } else {
    res.status(appError.statusCode).render("error", {
      layout: "main",
      title: `Error ${appError.statusCode}`,
      error: payload.error,
    });
  }
}


