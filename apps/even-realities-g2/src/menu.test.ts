import { describe, expect, it } from "vitest";
import { MENU_ID, menuForScreen } from "./menu";

describe("G2 contextual menu", () => {
  it("always offers stop first on the chat", () => {
    expect(menuForScreen("chat")).toEqual([
      { id: MENU_ID.stop, label: "Stop agent" },
      { id: MENU_ID.bottom, label: "Scroll to the bottom" },
    ]);
  });

  it("leaves every other screen to the system items", () => {
    for (const screen of [
      "home",
      "inbox",
      "attention",
      "sessions",
      "reply",
      "voice",
      "settings",
      "failure",
      "interrupt-confirm",
      "pairing",
    ]) {
      expect(menuForScreen(screen)).toEqual([]);
    }
  });

  it("keeps ids unique and labels within the 32-byte limit", () => {
    const items = menuForScreen("chat");
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const item of items) {
      expect(item.id).toBeGreaterThan(0);
      expect(new TextEncoder().encode(item.label).length).toBeLessThanOrEqual(32);
    }
  });
});
