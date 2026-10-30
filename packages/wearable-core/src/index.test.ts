import { describe, expect, it } from "vitest";
import {
  chatScrollStep,
  clampLine,
  frameSignature,
  pageChoices,
  parseNumberedChoices,
  plainTextForGlass,
  wrapText,
} from "./index";

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

  it("strips Markdown while preserving code and paragraphs", () => {
    expect(
      plainTextForGlass(
        "## Heading\n**bold** and `code` and [link](https://example.com)\n\n```ts\nconst x = 1;\n```",
      ),
    ).toBe("Heading\nbold and code and link\n\nconst x = 1;");
    expect(plainTextForGlass("- one\n- two")).toBe("• one\n• two");
    expect(plainTextForGlass("<b>safe</b>")).toBe("safe");
    expect(plainTextForGlass("<https://example.com>")).toBe("https://example.com");
  });

  it("deduplicates unchanged glass frames", () => {
    expect(frameSignature("h", "b", "f")).toBe(frameSignature("h", "b", "f"));
    expect(frameSignature("h", "b", "f", ["a"])).not.toBe(
      frameSignature("h", "b", "f", ["b"]),
    );
    expect(frameSignature("h", "b", "f")).not.toBe(
      frameSignature("h", "b", "f", ["a"]),
    );
  });

  it("only accelerates after several rapid swipes", () => {
    expect([0, 1, 2, 3, 4, 10].map(chatScrollStep)).toEqual([
      1, 1, 2, 2, 4, 4,
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
