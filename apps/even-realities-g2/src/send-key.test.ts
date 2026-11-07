import { afterEach, describe, expect, it, vi } from "vitest";
import { newSendKey, selectSendKey } from "./send-key";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("selectSendKey", () => {
  it("reuses the key for an unchanged payload", () => {
    const current = { key: "key-1", text: "Yes" };
    expect(selectSendKey(current, "Yes", () => "unused")).toEqual({
      key: "key-1",
      text: "Yes",
    });
  });

  it("creates a new key when the payload changes", () => {
    const create = vi.fn(() => "key-2");
    expect(selectSendKey({ key: "key-1", text: "Yes" }, "No", create)).toEqual({
      key: "key-2",
      text: "No",
    });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("creates a key when none exists", () => {
    expect(selectSendKey({}, "Yes", () => "key-3")).toEqual({
      key: "key-3",
      text: "Yes",
    });
  });
});

describe("newSendKey", () => {
  it("uses crypto.randomUUID when available", () => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    expect(newSendKey()).toBe("uuid-1");
  });

  it("falls back without randomUUID", () => {
    vi.stubGlobal("crypto", undefined);
    expect(newSendKey()).toMatch(/^send-/);
  });
});
