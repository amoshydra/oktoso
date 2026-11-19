import { describe, expect, it } from "vitest";
import { MENU_ID, menuForScreen } from "./menu";

describe("G2 contextual menu", () => {
  it("offers one shortcut on the chat", () => {
    expect(menuForScreen("chat")).toEqual([
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
      "pairing",
    ]) {
      expect(menuForScreen(screen)).toEqual([]);
    }
  });

  it("keeps the label within the 32-byte limit", () => {
    for (const item of menuForScreen("chat")) {
      expect(item.id).toBeGreaterThan(0);
      expect(new TextEncoder().encode(item.label).length).toBeLessThanOrEqual(32);
    }
  });
});
