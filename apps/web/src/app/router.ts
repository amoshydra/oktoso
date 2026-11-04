import type { SessionStatus } from "@amoshydra/oktoso-contracts";

export type SearchStatus = SessionStatus | "all";

export type Route =
  | { name: "foundation" }
  | { name: "inbox"; filter: string }
  | { name: "sessions"; newSession?: boolean }
  | { name: "chat"; ref: string; details: boolean }
  | {
      name: "search";
      query: string;
      provider: string;
      status: SearchStatus;
    }
  | {
      name: "providers";
      editor?: { mode: "add" } | { mode: "edit"; id: string };
    }
  | { name: "settings" }
  | { name: "login"; next?: string };

export const DEFAULT_ROUTE: Route = { name: "foundation" };

const SESSION_STATUSES: readonly SessionStatus[] = [
  "running",
  "idle",
  "error",
  "offline",
];

function decodeSegment(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function searchStatus(value: string | null): SearchStatus {
  return value && (SESSION_STATUSES as readonly string[]).includes(value)
    ? (value as SessionStatus)
    : "all";
}

export function parseRoute(pathname: string, search = ""): Route | null {
  const segments = pathname.split("/").filter(Boolean);
  const params = new URLSearchParams(search);

  if (segments.length === 0) return { name: "foundation" };

  const [head, ...rest] = segments;
  switch (head) {
    case "foundation":
      return rest.length === 0 ? { name: "foundation" } : null;

    case "inbox":
      return rest.length === 0
        ? { name: "inbox", filter: params.get("filter") ?? "all" }
        : null;

    case "sessions": {
      if (rest.length === 0) {
        return {
          name: "sessions",
          newSession: params.get("new") === "1",
        };
      }
      if (rest.length !== 1) return null;
      const ref = decodeSegment(rest[0]!);
      if (!ref) return null;
      return {
        name: "chat",
        ref,
        details: params.get("details") === "1",
      };
    }

    case "search":
      if (rest.length !== 0) return null;
      return {
        name: "search",
        query: params.get("q") ?? "",
        provider: params.get("provider") ?? "all",
        status: searchStatus(params.get("status")),
      };

    case "providers": {
      if (rest.length !== 0) return null;
      const add = params.get("add") === "1";
      const edit = params.get("edit");
      if (add) return { name: "providers", editor: { mode: "add" } };
      if (edit) {
        return { name: "providers", editor: { mode: "edit", id: edit } };
      }
      return { name: "providers" };
    }

    case "settings":
      return rest.length === 0 ? { name: "settings" } : null;

    case "login": {
      if (rest.length !== 0) return null;
      const next = params.get("next");
      return {
        name: "login",
        ...(next && isInternalNext(next) ? { next } : {}),
      };
    }

    default:
      return null;
  }
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case "foundation":
      return "/foundation";
    case "inbox": {
      const params = new URLSearchParams();
      if (route.filter !== "all") params.set("filter", route.filter);
      return withQuery("/inbox", params);
    }
    case "sessions": {
      const params = new URLSearchParams();
      if (route.newSession) params.set("new", "1");
      return withQuery("/sessions", params);
    }
    case "chat": {
      const params = new URLSearchParams();
      if (route.details) params.set("details", "1");
      return withQuery(`/sessions/${encodeURIComponent(route.ref)}`, params);
    }
    case "search": {
      const params = new URLSearchParams();
      if (route.query) params.set("q", route.query);
      if (route.provider !== "all") params.set("provider", route.provider);
      if (route.status !== "all") params.set("status", route.status);
      return withQuery("/search", params);
    }
    case "providers": {
      const params = new URLSearchParams();
      if (route.editor?.mode === "add") params.set("add", "1");
      if (route.editor?.mode === "edit") {
        params.set("edit", route.editor.id);
      }
      return withQuery("/providers", params);
    }
    case "settings":
      return "/settings";
    case "login": {
      const params = new URLSearchParams();
      if (route.next) params.set("next", route.next);
      return withQuery("/login", params);
    }
  }
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export function parseRouteHref(href: string): Route | null {
  try {
    const url = new URL(href, "http://oktoso.local");
    if (url.origin !== "http://oktoso.local") return null;
    return parseRoute(url.pathname, url.search);
  } catch {
    return null;
  }
}

export function isInternalNext(value: string | undefined): value is string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return false;
  const path = value.split(/[?#]/, 1)[0];
  if (!path || path === "/login" || path.startsWith("/login/")) return false;
  return parseRouteHref(value) !== null;
}

export function currentHref(): string {
  return `${window.location.pathname}${window.location.search}`;
}
