import type { MiddlewareHandler } from "hono";
import { randomUUID } from "node:crypto";
import type { Logger } from "../../lib/logger";
import type { AppEnv } from "../types";

export function requestContext(baseLogger: Logger): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = randomUUID();
    const logger = baseLogger.child({ requestId });
    c.set("requestId", requestId);
    c.set("logger", logger);
    c.header("X-Request-Id", requestId);

    const started = performance.now();
    try {
      await next();
    } finally {
      const durationMs = Math.round(performance.now() - started);
      const path = c.req.path.startsWith("/pair/")
        ? "/pair/[REDACTED]"
        : c.req.path.startsWith("/api/v1/auth/connect/")
          ? "/api/v1/auth/connect/[REDACTED]"
          : c.req.path;
      const fields = {
        method: c.req.method,
        path,
        status: c.res.status,
        durationMs,
      };
      if (path === "/api/v1/health") logger.debug("request", fields);
      else logger.info("request", fields);
    }
  };
}
