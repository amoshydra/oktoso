import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import type { AuthIdentity, AuthService } from "../../auth/service";
import { unauthorized, AppError } from "../../domain/errors";
import { getHubSessionCookie, setHubSessionCookie } from "../auth-cookie";
import { isSameOriginRequest } from "../origin";

const PUBLIC_PATHS = new Set([
  "/api/v1/health",
  "/api/v1/auth/signout",
  "/api/v1/auth/connect",
]);

function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path);
}

function isMutating(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

function fromBearer(header: string, auth: AuthService): AuthIdentity | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return undefined;

  const token = match[1]!.trim();
  if (!token) return undefined;

  if (auth.isOwner(token)) return { kind: "owner" };
  const session = auth.verifySession(token);
  return session ? { kind: "session", expiresAt: session.expiresAt } : undefined;
}

export function bearerAuth(auth: AuthService): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (isPublicPath(c.req.path)) return next();

    const header = c.req.header("authorization") ?? "";
    let identity = fromBearer(header, auth);

    if (!identity) {
      const cookie = getHubSessionCookie(c);
      if (cookie) {
        const session = auth.verifySession(cookie);
        if (session) {
          if (isMutating(c.req.method) && !isSameOriginRequest(c)) {
            throw new AppError(
              "forbidden",
              "Cross-origin cookie request rejected",
              403,
            );
          }

          // Keep active browser sessions alive without re-pairing. The new
          // token replaces the cookie; the old token stays valid until its
          // original expiry because sessions are stateless.
          if (auth.shouldRefresh(session.expiresAt)) {
            const refreshed = auth.mintSession();
            setHubSessionCookie(c, refreshed.token);
            identity = {
              kind: "session",
              expiresAt: refreshed.expiresAt,
            };
          } else {
            identity = { kind: "session", expiresAt: session.expiresAt };
          }
        }
      }
    }

    if (!identity) {
      c.header("WWW-Authenticate", "Bearer");
      throw unauthorized();
    }

    c.set("auth", identity);
    await next();
  };
}
