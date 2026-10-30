import { describe, expect, it } from "vitest";
import { clampLine, pageChoices, parseNumberedChoices, wrapText } from "./index";

describe("wearable core", () => {
  it("wraps text and marks truncation", () => {
    const lines = wrapText("one two three four five six", 8, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
    expect(clampLine("a long title here", 8)).toBe("a long …");
  });

  it("preserves newlines and paragraph breaks", () => {
    expect(wrapText("first line\nsecond line", 40, 10)).toEqual([
      "first line",
      "second line",
    ]);
    expect(wrapText("para one\n\npara two", 40, 10)).toEqual([
      "para one",
      "",
      "para two",
    ]);
    expect(wrapText("windows\r\nline", 40, 10)).toEqual([
      "windows",
      "line",
    ]);
  });

  it("extracts numbered and bulleted choices", () => {
    expect(
      parseNumberedChoices("1. Add retry\n- Use fallback\n2) Explain"),
    ).toEqual(["Add retry", "Use fallback", "Explain"]);
  });

  it("pages choices", () => {
    expect(pageChoices([1, 2, 3, 4], 1, 3)).toEqual({
      items: [4],
      page: 1,
      pages: 2,
    });
  });
});
