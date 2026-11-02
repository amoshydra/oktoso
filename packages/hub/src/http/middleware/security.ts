import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { AppError } from "../../domain/errors";
import { MAX_AUDIO_BODY_BYTES, MAX_JSON_BODY_BYTES } from "../limits";

const UPLOAD_BODY_LIMITS = new Map<string, number>([
  ["/api/v1/transcribe", MAX_AUDIO_BODY_BYTES],
]);

export function securityHeaders(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    // Device apps may be embedded by the Even Hub plugin loader. They are
    // public static bundles; the API still requires an owner or session credential.
    if (!c.req.path.startsWith("/apps/")) {
      c.header("X-Frame-Options", "DENY");
      // The web client records audio locally for hub-backed dictation. The
      // browser still asks for microphone permission; this only removes the
      // blanket denial from the document policy.
      c.header(
        "Permissions-Policy",
        "geolocation=(), microphone=(self), camera=()",
      );
    }
    await next();
  };
}

export function requestLimits(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const limit = UPLOAD_BODY_LIMITS.get(c.req.path) ?? MAX_JSON_BODY_BYTES;
    const contentLength = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > limit) {
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
