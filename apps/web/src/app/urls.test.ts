import { describe, expect, it } from "vitest";
import { isProviderResource, resolveProviderUrl } from "./urls";

const base = "http://127.0.0.1:4096";

describe("resolveProviderUrl", () => {
  it("keeps absolute provider links", () => {
    expect(resolveProviderUrl("https://example.com/a", base)).toBe(
      "https://example.com/a",
    );
  });

  it("resolves relative provider links against the provider base", () => {
    expect(resolveProviderUrl("/session/abc", base)).toBe(
      "http://127.0.0.1:4096/session/abc",
    );
    expect(resolveProviderUrl("./src/auth.ts", base)).toBe(
      "http://127.0.0.1:4096/src/auth.ts",
    );
    expect(resolveProviderUrl("//cdn.example.com/a.png", base)).toBe(
      "http://cdn.example.com/a.png",
    );
  });

  it("does not resolve relative links without a provider base", () => {
    expect(resolveProviderUrl("/session/abc", undefined)).toBeUndefined();
    expect(resolveProviderUrl("./src/auth.ts", "")).toBeUndefined();
  });

  it("allows mail and phone links in prose but not images", () => {
    expect(resolveProviderUrl("mailto:me@example.com", base)).toBe(
      "mailto:me@example.com",
    );
    expect(resolveProviderUrl("tel:+123", base)).toBe("tel:+123");
    expect(resolveProviderUrl("mailto:me@example.com", base, "image")).toBeUndefined();
  });

  it("rejects executable and unknown schemes", () => {
    expect(resolveProviderUrl("javascript:alert(1)", base)).toBeUndefined();
    expect(resolveProviderUrl("file:///etc/passwd", base)).toBeUndefined();
    expect(resolveProviderUrl("blob:http://127.0.0.1/abc", base)).toBeUndefined();
  });

  it("allows safe inline images and rejects svg data URLs", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(resolveProviderUrl(png, base, "image")).toBe(png);
    expect(
      resolveProviderUrl("data:image/svg+xml;base64,PHN2Zz4=", base, "image"),
    ).toBeUndefined();
  });

  it("leaves document anchors alone for links", () => {
    expect(resolveProviderUrl("#section", base)).toBe("#section");
    expect(resolveProviderUrl("#section", base, "image")).toBeUndefined();
  });
});

describe("isProviderResource", () => {
  it("matches the configured provider origin", () => {
    expect(isProviderResource("http://127.0.0.1:4096/file.png", base)).toBe(true);
    expect(isProviderResource("/file.png", base)).toBe(false);
  });

  it("does not match other origins or data URLs", () => {
    expect(isProviderResource("https://example.com/file.png", base)).toBe(false);
    expect(isProviderResource("data:image/png;base64,abc", base)).toBe(false);
    expect(isProviderResource("http://127.0.0.1:5000/file.png", base)).toBe(false);
  });
});
