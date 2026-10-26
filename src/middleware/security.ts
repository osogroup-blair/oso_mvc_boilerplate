// Baseline HTTP security: headers + rate limiting.
import { randomBytes } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.locals.cspNonce = randomBytes(24).toString("base64");
  return helmet({ contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'", `'nonce-${res.locals.cspNonce}'`],
    scriptSrcAttr: ["'none'"], styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", "data:", "https:"], connectSrc: ["'self'"],
    objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
    upgradeInsecureRequests: null,
  } } })(req, res, next);
}

export const rateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
