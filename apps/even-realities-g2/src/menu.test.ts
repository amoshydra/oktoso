import { describe, expect, it } from "vitest";
import { MENU_ID, menuForScreen } from "./menu";

describe("G2 contextual menu", () => {
  it("puts stop first when a turn is running", () => {
    expect(menuForScreen("chat", { canInterrupt: true })).toEqual([
      { id: MENU_ID.stop, label: "Stop agent" },
      { id: MENU_ID.bottom, label: "Scroll to the bottom" },
    ]);
  });

  it("keeps the scroll shortcut when there is nothing to stop", () => {
    expect(menuForScreen("chat", { canInterrupt: false })).toEqual([
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
      expect(menuForScreen(screen, { canInterrupt: true })).toEqual([]);
    }
  });

  it("keeps ids unique and labels within the 32-byte limit", () => {
    for (const canInterrupt of [true, false]) {
      const items = menuForScreen("chat", { canInterrupt });
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
      for (const item of items) {
        expect(item.id).toBeGreaterThan(0);
        expect(new TextEncoder().encode(item.label).length).toBeLessThanOrEqual(32);
      }
    }
  });
});
