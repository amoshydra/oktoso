import { describe, expect, it } from "vitest";
import {
  compactNumber,
  formatBytes,
  formatChars,
  formatDiff,
  formatDuration,
  formatExit,
  formatFiles,
  formatHits,
  formatLines,
  formatPixels,
} from "./metrics";

describe("compactNumber", () => {
  it("keeps small counts exact", () => {
    expect(compactNumber(0)).toBe("0");
    expect(compactNumber(42)).toBe("42");
    expect(compactNumber(999)).toBe("999");
  });

  it("abbreviates thousands without exceeding four characters", () => {
    expect(compactNumber(1000)).toBe("1k");
    expect(compactNumber(1234)).toBe("1.2k");
    expect(compactNumber(9999)).toBe("10k");
    expect(compactNumber(12_345)).toBe("12k");
    expect(compactNumber(123_456)).toBe("123k");
    expect(compactNumber(999_499)).toBe("999k");
  });

  it("rolls over instead of printing 1000k", () => {
    expect(compactNumber(999_500)).toBe("1M");
    expect(compactNumber(1_234_567)).toBe("1.2M");
    expect(compactNumber(999_500_000)).toBe("1B");
    expect(compactNumber(1_500_000_000)).toBe("1.5B");
  });
});

describe("unit formatters", () => {
  it("formats bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1_610_612_736)).toBe("1.5 GB");
  });

  it("formats durations", () => {
    expect(formatDuration(0)).toBe("0 ms");
    expect(formatDuration(576)).toBe("576 ms");
    expect(formatDuration(1234)).toBe("1.2 s");
    expect(formatDuration(83_000)).toBe("1.4 m");
    expect(formatDuration(3_723_000)).toBe("1 h");
    expect(formatDuration(93_600_000)).toBe("1.1 d");
  });

  it("formats exits, diffs, pixels, and counts", () => {
    expect(formatExit(0)).toBe("exit 0");
    expect(formatExit(255)).toBe("exit 255");
    expect(formatExit(0, 9)).toBe("sig 9");
    expect(formatDiff(1, 0)).toBe("+1 −0");
    expect(formatDiff(12_345, 6789)).toBe("+19k");
    expect(formatPixels(1200, 320)).toBe("1k×320");
    expect(formatPixels(3840, 2160)).toBe("4k×2k");
    expect(formatChars(1300)).toBe("1.3k ch");
    expect(formatLines(240)).toBe("240 ln");
    expect(formatHits(1)).toBe("1 hit");
    expect(formatHits(49)).toBe("49 hits");
    expect(formatHits(123_456)).toBe("123k");
    expect(formatFiles(2)).toBe("2 files");
    expect(formatFiles(1500)).toBe("1.5k");
  });
});
