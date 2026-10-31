import { describe, expect, it } from "vitest";
import { isPairingUrl } from "./qr-scanner";

const origin = "https://hub.example.com";

describe("isPairingUrl", () => {
  it("accepts same-origin pairing links", () => {
    expect(isPairingUrl(`${origin}/pair/abc`, origin)).toBe(true);
    expect(isPairingUrl(`${origin}/pair/abc?x=1`, origin)).toBe(true);
  });

  it("rejects other origins, paths, and malformed values", () => {
    expect(isPairingUrl("https://evil.example/pair/abc", origin)).toBe(false);
    expect(isPairingUrl(`${origin}/api/v1/auth/connect/abc`, origin)).toBe(false);
    expect(isPairingUrl("not a url", origin)).toBe(false);
  });
});
