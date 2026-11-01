import { describe, expect, it } from "vitest";
import type { Context } from "hono";
import type { AppEnv } from "./types";
import { isSameOriginRequest } from "./origin";

function context(headers: Record<string, string>): Context<AppEnv> {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    req: {
      header: (name: string) => normalized[name.toLowerCase()],
      url: "http://hub.local/pair/code",
    },
  } as unknown as Context<AppEnv>;
}

describe("isSameOriginRequest", () => {
  it("accepts a matching origin", () => {
    expect(
      isSameOriginRequest(
        context({ host: "hub.local", origin: "http://hub.local" }),
      ),
    ).toBe(true);
  });

  it("accepts a proxy-rewritten host when Fetch Metadata says same-origin", () => {
    expect(
      isSameOriginRequest(
        context({
          host: "127.0.0.1:8787",
          origin: "https://hub.example.com",
          "sec-fetch-site": "same-origin",
        }),
      ),
    ).toBe(true);
  });

  it("rejects a cross-site post even when the host is rewritten", () => {
    expect(
      isSameOriginRequest(
        context({
          host: "127.0.0.1:8787",
          origin: "https://evil.example",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);
  });

  it("accepts Origin: null only with same-origin or none Fetch Metadata", () => {
    expect(
      isSameOriginRequest(
        context({ host: "hub.local", origin: "null", "sec-fetch-site": "none" }),
      ),
    ).toBe(true);
    expect(
      isSameOriginRequest(
        context({
          host: "hub.local",
          origin: "null",
          "sec-fetch-site": "cross-site",
        }),
      ),
    ).toBe(false);
  });

  it("keeps cookie mutations strict when neither header is present", () => {
    expect(isSameOriginRequest(context({ host: "hub.local" }))).toBe(false);
  });

});
