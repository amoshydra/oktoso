import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import { unauthorized } from "../../domain/errors";

export function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function bearerAuth(expectedToken: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (c.req.path === "/api/v1/health") return next();

    const header = c.req.header("authorization") ?? "";
    if (!header.startsWith("Bearer ")) {
      c.header("WWW-Authenticate", "Bearer");
      throw unauthorized();
    }

    const provided = header.slice("Bearer ".length).trim();
    if (!provided || !tokensMatch(provided, expectedToken)) {
      c.header("WWW-Authenticate", "Bearer");
      throw unauthorized();
    }

    await next();
  };
}
