import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { AppError } from "../../domain/errors";

const MAX_BODY_BYTES = 1024 * 1024;

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    // Device apps may be embedded by the Even Hub plugin loader. They are
    // public static bundles; the API still requires an owner or session credential.
    if (!c.req.path.startsWith("/apps/")) {
      c.header("X-Frame-Options", "DENY");
      c.header("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    }
    await next();
  };
}

export function requestLimits(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      c.header("Connection", "close");
      throw new AppError(
        "payload_too_large",
        "Request body is too large",
        413,
      );
    }
    await next();
  };
}
