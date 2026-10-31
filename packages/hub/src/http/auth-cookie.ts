import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sessionCookieName } from "../auth/cookies";
import { SESSION_TTL_SECONDS } from "../auth/session";
import type { AppEnv } from "./types";
import { requestHost } from "./origin";

export function hubSessionCookieName(c: Context<AppEnv>): string {
  return sessionCookieName(requestHost(c));
}

export function getHubSessionCookie(c: Context<AppEnv>): string | undefined {
  return getCookie(c, hubSessionCookieName(c));
}

export function isSecureRequest(c: Context<AppEnv>): boolean {
  const forwarded = c.req
    .header("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwarded) return forwarded === "https";

  try {
    return new URL(c.req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function setHubSessionCookie(
  c: Context<AppEnv>,
  token: string,
): void {
  setCookie(c, hubSessionCookieName(c), token, {
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    maxAge: SESSION_TTL_SECONDS,
    secure: isSecureRequest(c),
  });
}

export function clearHubSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, hubSessionCookieName(c), {
    path: "/",
    secure: isSecureRequest(c),
  });
}
