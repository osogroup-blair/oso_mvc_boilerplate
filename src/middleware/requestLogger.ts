// HTTP request logging bound to the correlation ID.
import pinoHttp from "pino-http";
import { logger, safeLogError } from "../lib/logger.js";

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as unknown as { id: string }).id,
  // Do not serialize headers, URLs, query strings, cookies or token path values.
  serializers: {
    req: (req) => ({ id: req.id, method: req.method, route: req.raw?.route?.path ?? "unmatched" }),
    res: (res) => ({ statusCode: res.statusCode }),
    err: safeLogError,
  },
  customProps: (req) => ({ route: (req as unknown as { route?: { path?: string } }).route?.path ?? "unmatched" }),
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
});
