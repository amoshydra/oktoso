import { describe, expect, it } from "vitest";
import { decodeBase64URL } from "./pwa";

describe("decodeBase64URL", () => {
  it("decodes a URL-safe VAPID key", () => {
    expect([...decodeBase64URL("AQID-_8")]).toEqual([1, 2, 3, 251, 255]);
  });

  it("accepts unpadded input", () => {
    expect([...decodeBase64URL("AQID")]).toEqual([1, 2, 3]);
  });
});
