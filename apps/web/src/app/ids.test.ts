import { afterEach, describe, expect, it, vi } from "vitest";
import { createID } from "./ids";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createID", () => {
  it("uses crypto.randomUUID when the context exposes it", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    expect(createID()).toBe("uuid-1");
  });

  it("falls back to getRandomValues on an insecure origin", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0x11);
        return bytes;
      },
    });

    expect(createID()).toBe("11111111-1111-4111-9111-111111111111");
  });

  it("falls back to time and randomness without web crypto", () => {
    vi.stubGlobal("crypto", undefined);
    expect(createID()).toMatch(/^[0-9a-z]+-[0-9a-z]+$/);
  });
});
