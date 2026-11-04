import { describe, expect, it } from "vitest";
import {
  isInternalNext,
  parseRoute,
  parseRouteHref,
  routeHref,
} from "./router";

describe("parseRoute", () => {
  it("maps the root to the foundation screen", () => {
    expect(parseRoute("/")).toEqual({ name: "foundation" });
    expect(parseRoute("/foundation")).toEqual({ name: "foundation" });
  });

  it("parses the global destinations", () => {
    expect(parseRoute("/inbox")).toEqual({ name: "inbox", filter: "all" });
    expect(parseRoute("/inbox", "?filter=approval")).toEqual({
      name: "inbox",
      filter: "approval",
    });
    expect(parseRoute("/sessions")).toEqual({
      name: "sessions",
      newSession: false,
    });
    expect(parseRoute("/sessions", "?new=1")).toEqual({
      name: "sessions",
      newSession: true,
    });
    expect(parseRoute("/search")).toEqual({
      name: "search",
      query: "",
      provider: "all",
      status: "all",
    });
    expect(parseRoute("/providers")).toEqual({ name: "providers" });
    expect(parseRoute("/settings")).toEqual({ name: "settings" });
  });

  it("accepts trailing slashes", () => {
    expect(parseRoute("/sessions/")).toEqual({
      name: "sessions",
      newSession: false,
    });
    expect(parseRoute("/inbox/")).toEqual({ name: "inbox", filter: "all" });
  });

  it("decodes opaque session references as one segment", () => {
    expect(
      parseRoute(
        "/sessions/desktop-opencode%3Ases%2Fa%20b",
        "?details=1",
      ),
    ).toEqual({
      name: "chat",
      ref: "desktop-opencode:ses/a b",
      details: true,
    });
  });

  it("parses search filters and ignores invalid status values", () => {
    expect(
      parseRoute(
        "/search",
        "?q=auth+race&provider=desktop-opencode&status=running",
      ),
    ).toEqual({
      name: "search",
      query: "auth race",
      provider: "desktop-opencode",
      status: "running",
    });
    expect(parseRoute("/search", "?status=bogus")).toEqual({
      name: "search",
      query: "",
      provider: "all",
      status: "all",
    });
  });

  it("parses provider editors", () => {
    expect(parseRoute("/providers", "?add=1")).toEqual({
      name: "providers",
      editor: { mode: "add" },
    });
    expect(parseRoute("/providers", "?edit=desktop-opencode")).toEqual({
      name: "providers",
      editor: { mode: "edit", id: "desktop-opencode" },
    });
  });

  it("keeps only internal login destinations", () => {
    expect(parseRoute("/login", "?next=%2Fsessions%2Fabc")).toEqual({
      name: "login",
      next: "/sessions/abc",
    });
    expect(parseRoute("/login", "?next=https%3A%2F%2Fevil.example")).toEqual({
      name: "login",
    });
    expect(parseRoute("/login", "?next=%2Flogin")).toEqual({
      name: "login",
    });
  });

  it("rejects unknown and malformed routes", () => {
    expect(parseRoute("/nope")).toBeNull();
    expect(parseRoute("/sessions/a/b")).toBeNull();
    expect(parseRoute("/settings/extra")).toBeNull();
  });
});

describe("routeHref", () => {
  it("round-trips every route", () => {
    const routes = [
      { name: "foundation" },
      { name: "inbox", filter: "unread" },
      { name: "sessions", newSession: true },
      { name: "sessions", newSession: false },
      { name: "chat", ref: "openwebui:chat_1", details: true },
      {
        name: "search",
        query: "auth race",
        provider: "openwebui",
        status: "idle",
      },
      { name: "providers" },
      { name: "providers", editor: { mode: "add" } },
      { name: "providers", editor: { mode: "edit", id: "desktop" } },
      { name: "settings" },
      { name: "login", next: "/sessions/abc" },
    ] as const;

    for (const route of routes) {
      const href = routeHref(route);
      expect(parseRouteHref(href)).toEqual(route);
    }
  });

  it("omits default query values", () => {
    expect(
      routeHref({
        name: "search",
        query: "",
        provider: "all",
        status: "all",
      }),
    ).toBe("/search");
    expect(routeHref({ name: "inbox", filter: "all" })).toBe("/inbox");
    expect(routeHref({ name: "sessions", newSession: false })).toBe("/sessions");
  });

  it("encodes session references", () => {
    expect(
      routeHref({ name: "chat", ref: "desktop-opencode:ses/a b", details: true }),
    ).toBe("/sessions/desktop-opencode%3Ases%2Fa%20b?details=1");
  });
});

describe("isInternalNext", () => {
  it("accepts app paths and rejects external or login loops", () => {
    expect(isInternalNext("/sessions/abc")).toBe(true);
    expect(isInternalNext("/search?q=auth")).toBe(true);
    expect(isInternalNext("https://evil.example")).toBe(false);
    expect(isInternalNext("//evil.example/sessions")).toBe(false);
    expect(isInternalNext("/login")).toBe(false);
    expect(isInternalNext("/login?next=%2Fsessions")).toBe(false);
    expect(isInternalNext("/nope")).toBe(false);
  });
});
