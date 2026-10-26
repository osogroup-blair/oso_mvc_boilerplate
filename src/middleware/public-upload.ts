import express from "express";
import type { Request, Response, NextFunction } from "express";
import { storageService } from "../services/storage.service.js";
import { publicObjectHeaders } from "../lib/public-upload-policy.js";
import { basename } from "node:path";

/** Configured upload aliases receive the same policy as the broad static mount. */
export async function publicUploads(req: Request, res: Response, next: NextFunction) {
  try {
    const prefix = await storageService.publicPrefix();
    if (!req.path.startsWith(prefix + "/")) return next();
    const { directory } = await storageService.publicLocation();
    const suffix = req.url.slice(prefix.length);
    const original = req.url;
    req.url = suffix;
    express.static(directory, { fallthrough: false, setHeaders(response, file) {
      for (const [key, value] of Object.entries(publicObjectHeaders(basename(file)))) response.setHeader(key, value);
    } })(req, res, error => { req.url = original; next(error); });
  } catch (error) { next(error); }
}
