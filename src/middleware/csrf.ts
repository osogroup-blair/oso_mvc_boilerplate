import type { Request, Response, NextFunction } from "express";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config/index.js";
import { AppError } from "../lib/AppError.js";

const COOKIE_NAME = "csrf";

function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const parts = cookie.split("=");
        return [parts[0], parts.slice(1).join("=")];
      })
  );
}

function sign(nonce: string) {
  return createHmac("sha256", config.JWT_SECRET).update(nonce).digest("base64url");
}

function makeToken() {
  const nonce = randomBytes(24).toString("base64url");
  return `${nonce}.${sign(nonce)}`;
}

function isValid(token: string | undefined) {
  if (!token) return false;
  const [nonce, mac] = token.split(".");
  if (!nonce || !mac) return false;
  const expected = sign(nonce);
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function ensureCsrfToken(req: Request, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const token = isValid(cookies[COOKIE_NAME]) ? cookies[COOKIE_NAME] : makeToken();

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "lax",
    path: "/",
  });
  res.locals.csrfToken = token;
  next();
}

export function verifyCsrfToken(req: Request, res: Response, next: NextFunction) {
  const cookies = parseCookies(req.headers.cookie);
  const bodyToken = typeof req.body?._csrf === "string" ? req.body._csrf : undefined;
  const cookieToken = cookies[COOKIE_NAME];

  if (!isValid(cookieToken) || !bodyToken || bodyToken !== cookieToken) {
    return next(AppError.forbidden("Invalid CSRF token"));
  }

  res.locals.csrfToken = cookieToken;
  next();
}
