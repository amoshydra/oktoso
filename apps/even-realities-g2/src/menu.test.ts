import { describe, expect, it } from "vitest";
import { MENU_ID, menuForScreen } from "./menu";

const session = { hasSession: true, voiceEnabled: true };

describe("G2 contextual menu", () => {
  it("offers the reply shortcuts on the chat", () => {
    expect(menuForScreen("chat", session)).toEqual([
      { id: MENU_ID.voice, label: "Voice reply" },
      { id: MENU_ID.reply, label: "Reply" },
      { id: MENU_ID.phone, label: "Phone keyboard" },
      { id: MENU_ID.home, label: "Home" },
      { id: MENU_ID.back, label: "Back" },
    ]);
  });

  it("drops voice when transcription is not configured", () => {
    const items = menuForScreen("chat", {
      hasSession: true,
      voiceEnabled: false,
    });

    expect(items.map((item) => item.id)).toEqual([
      MENU_ID.reply,
      MENU_ID.phone,
      MENU_ID.home,
      MENU_ID.back,
    ]);
  });

  it("keeps the reply surface free of the reply action", () => {
    const items = menuForScreen("reply", session);

    expect(items.map((item) => item.id)).toEqual([
      MENU_ID.voice,
      MENU_ID.phone,
      MENU_ID.home,
      MENU_ID.back,
    ]);
  });

  it("gives the recording screen stop and cancel", () => {
    expect(menuForScreen("voice", session)).toEqual([
      { id: MENU_ID.stop, label: "Stop recording" },
      { id: MENU_ID.cancel, label: "Cancel" },
    ]);
  });

  it("leaves home and pairing alone", () => {
    expect(menuForScreen("home", session)).toEqual([]);
    expect(menuForScreen("pairing", session)).toEqual([]);
  });

  it("offers only navigation elsewhere", () => {
    expect(menuForScreen("inbox", session)).toEqual([
      { id: MENU_ID.home, label: "Home" },
      { id: MENU_ID.back, label: "Back" },
    ]);
    expect(menuForScreen("chat", { hasSession: false, voiceEnabled: true })).toEqual([
      { id: MENU_ID.home, label: "Home" },
      { id: MENU_ID.back, label: "Back" },
    ]);
  });

  it("keeps ids unique and labels within the 32-byte limit", () => {
    const screens = [
      "chat",
      "reply",
      "voice",
      "inbox",
      "attention",
      "sessions",
      "settings",
      "failure",
    ];
    for (const screen of screens) {
      const items = menuForScreen(screen, session);
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
      for (const item of items) {
        expect(item.id).toBeGreaterThan(0);
        expect(new TextEncoder().encode(item.label).length).toBeLessThanOrEqual(32);
      }
    }
  });
});
