import { describe, expect, it } from "vitest";
import {
  deviceAwake,
  glassesStatusLabel,
  type GlassesSnapshot,
} from "./device";

function snapshot(overrides: GlassesSnapshot = {}): GlassesSnapshot {
  return { batteryLevel: 82, wearing: true, charging: false, inCase: false, ...overrides };
}

describe("G2 device status", () => {
  it("stays awake when the host reports nothing", () => {
    expect(deviceAwake({}, false)).toBe(true);
    expect(deviceAwake({}, true)).toBe(true);
  });

  it("sleeps in the case or when not worn", () => {
    expect(deviceAwake(snapshot({ inCase: true }), true)).toBe(false);
    expect(deviceAwake(snapshot({ wearing: false }), true)).toBe(false);
    expect(deviceAwake(snapshot(), true)).toBe(true);
  });

  it("labels the battery for Settings", () => {
    expect(glassesStatusLabel(snapshot(), true)).toBe("Glasses · 82%");
    expect(glassesStatusLabel(snapshot({ charging: true }), true)).toBe(
      "Glasses · 82% · charging",
    );
    expect(glassesStatusLabel(snapshot({ inCase: true }), true)).toBe(
      "Glasses · 82% · in case",
    );
    expect(glassesStatusLabel(snapshot({ wearing: false }), true)).toBe(
      "Glasses · 82% · not worn",
    );
  });

  it("has no label before the first report", () => {
    expect(glassesStatusLabel({}, false)).toBe("");
    expect(glassesStatusLabel({}, true)).toBe("");
  });
});
