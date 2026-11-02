import { describe, expect, it } from "vitest";
import { hubBaseUrls, pairingRequestUrl, webUrl } from "./urls";

const local = { host: "127.0.0.1", port: 8787 };

describe("hub URLs", () => {
  it("uses the public URL when configured", () => {
    const config = {
      ...local,
      publicUrl: "https://oktoso.example.com/",
    };

    expect(webUrl(config)).toBe("https://oktoso.example.com");
    expect(pairingRequestUrl(config)).toBe("https://oktoso.example.com");
    expect(hubBaseUrls(config)).toEqual(["https://oktoso.example.com"]);
  });

  it("falls back to host and port", () => {
    expect(webUrl(local)).toBe("http://127.0.0.1:8787");
    expect(pairingRequestUrl(local)).toBe("http://127.0.0.1:8787");
    expect(hubBaseUrls(local)).toEqual(["http://127.0.0.1:8787"]);
  });

  it("formats IPv6 hosts", () => {
    const config = { host: "::1", port: 8787 };
    expect(webUrl(config)).toBe("http://[::1]:8787");
  });
});
