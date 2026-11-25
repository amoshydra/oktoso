import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../types";
import type { AuthScope } from "../../auth/profiles";
import { AppError } from "../../domain/errors";

function isRead(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/**
 * The scope an API route requires for a paired profile. Owner credentials
 * bypass this; unknown routes require admin so a new endpoint cannot silently
 * become available to a phone or glasses session.
 */
export function requiredApiScope(
  method: string,
  path: string,
): AuthScope | undefined {
  if (method === "OPTIONS") return undefined;
  if (path === "/api/v1/health" || path.startsWith("/api/v1/auth/")) {
    return undefined;
  }
  if (path.startsWith("/api/v1/mcp/tokens")) return "admin";
  if (path.startsWith("/api/v1/providers")) {
    return isRead(method) ? "providers.read" : "providers.write";
  }
  if (
    path.startsWith("/api/v1/settings/local-data") ||
    path.startsWith("/api/v1/settings/transcripts")
  ) {
    return isRead(method) ? "data.read" : "data.write";
  }
  if (path.startsWith("/api/v1/settings")) {
    return isRead(method) ? "settings.read" : "settings.write";
  }
  if (path.startsWith("/api/v1/assistant")) return "assistant";
  if (path.startsWith("/api/v1/automation/approvals")) {
    return isRead(method) ? "automation.read" : "automation.act";
  }
  if (path.startsWith("/api/v1/automation")) {
    return isRead(method) ? "automation.read" : "automation.write";
  }
  if (path.startsWith("/api/v1/notifications")) return "notifications";
  if (
    path.startsWith("/api/v1/reply-feedback") ||
    path.endsWith("/reply-audit")
  ) {
    return "reply";
  }
  if (path.startsWith("/api/v1/transcribe")) return "transcribe";
  if (path.startsWith("/api/v1/search")) return "search.read";
  if (path.startsWith("/api/v1/attention")) {
    return isRead(method) ? "attention.read" : "attention.act";
  }
  if (path.startsWith("/api/v1/questions")) return "sessions.read";
  if (
    path.startsWith("/api/v1/sessions") ||
    path.startsWith("/api/v1/attachments")
  ) {
    return isRead(method) ? "sessions.read" : "sessions.write";
  }
  if (path.startsWith("/api/v1/events")) return "events";
  if (path.startsWith("/api/v1/diagnostics")) return "settings.read";
  return "admin";
}

export function apiScopeGuard(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const identity = c.get("auth");
    if (!identity || identity.kind === "owner") return next();

    const required = requiredApiScope(c.req.method, c.req.path);
    if (!required || identity.scopes.includes(required)) return next();

    throw new AppError(
      "forbidden",
      `This device profile cannot access ${required}`,
      403,
    );
  };
}
