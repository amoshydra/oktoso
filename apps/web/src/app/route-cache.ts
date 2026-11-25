import type { Route } from "./router";

const MAX_ENTRIES = 30;
const entries = new Map<string, Map<string, CacheEntry<unknown>>>();

export interface CacheEntry<T> {
  value: T;
  savedAt: number;
}

function entry(key: string): Map<string, CacheEntry<unknown>> {
  const existing = entries.get(key);
  if (existing) {
    entries.delete(key);
    entries.set(key, existing);
    return existing;
  }
  const created = new Map<string, CacheEntry<unknown>>();
  entries.set(key, created);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return created;
}

type SearchRoute = Extract<Route, { name: "search" }>;

/** Data key for one search state; the URL lag during typing does not change it. */
export function searchDataKey(
  state: Pick<SearchRoute, "query" | "provider" | "status" | "scope">,
): string {
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.provider !== "all") params.set("provider", state.provider);
  if (state.status !== "all") params.set("status", state.status);
  params.set("scope", state.scope);
  return `/search?${params.toString()}`;
}

/**
 * Stable data key for a route.
 *
 * History entries get a fresh key on every push, so they cannot key a data
 * cache: returning to the same screen would always look cold. This key follows
 * the screen instead. Filters that only change a local view (`inbox`) and the
 * New session overlay (`sessions?new=1`) keep the same data key.
 */
export function routeDataKey(route: Route): string {
  switch (route.name) {
    case "foundation":
      return "/foundation";
    case "inbox":
      return "/inbox";
    case "sessions":
      return "/sessions";
    case "chat":
      return `/sessions/${encodeURIComponent(route.ref)}`;
    case "search":
      return searchDataKey(route);
    case "providers":
      return "/providers";
    case "settings":
      return "/settings";
    case "login":
      return "/login";
  }
}

export function readRouteCacheEntry<T>(
  key: string,
  name: string,
): CacheEntry<T> | undefined {
  return entries.get(key)?.get(name) as CacheEntry<T> | undefined;
}

export function writeRouteCacheEntry<T>(
  key: string,
  name: string,
  value: T,
): void {
  entry(key).set(name, { value, savedAt: Date.now() });
}

export function readRouteCache<T>(key: string, name: string): T | undefined {
  return readRouteCacheEntry<T>(key, name)?.value;
}

export function writeRouteCache<T>(
  key: string,
  name: string,
  value: T,
): void {
  writeRouteCacheEntry(key, name, value);
}
