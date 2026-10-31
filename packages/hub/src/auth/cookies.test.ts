import { describe, expect, it } from "vitest";
import { sessionCookieName } from "./cookies";

describe("session cookie names", () => {
  it("scopes the cookie by port when the host has one", () => {
    expect(sessionCookieName("127.0.0.1:8787")).toBe(
      "oktoso_session_8787",
    );
    expect(sessionCookieName("hub.example.com:443")).toBe(
      "oktoso_session_443",
    );
  });

  it("falls back to the bare name without a port or host", () => {
    expect(sessionCookieName("hub.example.com")).toBe("oktoso_session");
    expect(sessionCookieName(undefined)).toBe("oktoso_session");
    expect(sessionCookieName("not a host")).toBe("oktoso_session");
  });
});
