import { describe, expect, it } from "vitest";
import {
  readRouteCache,
  readRouteCacheEntry,
  routeDataKey,
  searchDataKey,
  writeRouteCache,
} from "./route-cache";

describe("routeDataKey", () => {
  it("follows the screen, not the history entry", () => {
    expect(routeDataKey({ name: "inbox", filter: "all" })).toBe("/inbox");
    expect(routeDataKey({ name: "inbox", filter: "question" })).toBe("/inbox");
    expect(routeDataKey({ name: "sessions", newSession: false })).toBe(
      "/sessions",
    );
    expect(routeDataKey({ name: "sessions", newSession: true })).toBe(
      "/sessions",
    );
    expect(routeDataKey({ name: "foundation" })).toBe("/foundation");
  });

  it("keeps chat and search state distinct but stable", () => {
    expect(
      routeDataKey({ name: "chat", ref: "desktop:ses/a b", details: false }),
    ).toBe("/sessions/desktop%3Ases%2Fa%20b");
    expect(
      routeDataKey({ name: "chat", ref: "desktop:ses/a b", details: true }),
    ).toBe("/sessions/desktop%3Ases%2Fa%20b");

    const first = searchDataKey({
      query: "auth race",
      provider: "opencode",
      status: "running",
      scope: "messages",
    });
    const second = searchDataKey({
      query: "auth race",
      provider: "opencode",
      status: "running",
      scope: "messages",
    });
    expect(first).toBe(second);
    expect(first).toContain("q=auth+race");
    expect(first).toContain("scope=messages");
    expect(first).not.toBe(
      searchDataKey({
        query: "auth race",
        provider: "all",
        status: "all",
        scope: "sessions",
      }),
    );
  });
});

describe("route cache entries", () => {
  it("stores a value with a timestamp", () => {
    const key = "/test-entry";
    writeRouteCache(key, "items", [1, 2, 3]);
    const entry = readRouteCacheEntry<number[]>(key, "items");
    expect(entry?.value).toEqual([1, 2, 3]);
    expect(entry?.savedAt).toEqual(expect.any(Number));
    expect(readRouteCache<number[]>(key, "items")).toEqual([1, 2, 3]);
  });

  it("treats a cached empty list as a cache hit", () => {
    const key = "/test-empty";
    writeRouteCache(key, "items", []);
    expect(readRouteCacheEntry<never[]>(key, "items")?.value).toEqual([]);
  });

  it("keeps names separate inside one route", () => {
    const key = "/test-names";
    writeRouteCache(key, "first", "a");
    writeRouteCache(key, "second", "b");
    expect(readRouteCache<string>(key, "first")).toBe("a");
    expect(readRouteCache<string>(key, "second")).toBe("b");
  });
});
