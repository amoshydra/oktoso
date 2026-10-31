import { describe, expect, it } from "vitest";
import {
  boxedPanel,
  buildPairingPanel,
  formatCountdown,
  primaryPairingUrl,
} from "./pairing-panel";
import { createTheme, visibleWidth } from "./terminal";

const theme = createTheme(false);

describe("terminal pairing panel", () => {
  it("keeps every boxed line at the requested width", () => {
    const lines = boxedPanel({
      lines: ["one", "a much longer line that should be truncated by the box"],
      width: 40,
      title: "Panel",
      right: "1:00",
      theme,
    });

    for (const line of lines) {
      expect(visibleWidth(line)).toBe(40);
    }
  });

  it("builds a QR panel that fits 64 columns", () => {
    const pairing = {
      code: "abcdefghijklmnopqrstuv",
      expiresAt: Date.now() + 5 * 60_000,
    };
    const lines = buildPairingPanel({
      pairing,
      urls: ["http://192.168.0.20:8787"],
      theme,
      width: 64,
      hint: "Run this command again for another link.",
    });

    for (const line of lines) {
      expect(visibleWidth(line)).toBe(64);
    }
    expect(lines.join("\n")).toContain("/pair/abcdefghijklmnopqrstuv");
  });

  it("prefers a LAN IPv4 address over loopback", () => {
    expect(
      primaryPairingUrl([
        "http://127.0.0.1:8787",
        "http://[::1]:8787",
        "http://192.168.0.20:8787",
      ]),
    ).toBe("http://192.168.0.20:8787");
  });

  it("formats a countdown", () => {
    const now = 1_700_000_000_000;
    expect(formatCountdown(now + 5 * 60_000, now)).toBe("05:00");
    expect(formatCountdown(now, now)).toBe("00:00");
  });
});
