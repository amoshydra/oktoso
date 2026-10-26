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
      const fields = {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs,
      };
      if (c.req.path === "/api/v1/health") logger.debug("request", fields);
      else logger.info("request", fields);
    }
  };
}
