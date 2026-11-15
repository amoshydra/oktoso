import { describe, expect, it } from "vitest";
import { highlightParts } from "./search-highlight";

describe("highlightParts", () => {
  it("marks whole-word matches case-insensitively", () => {
    const parts = highlightParts("The Refresh token rotated.", "refresh");

    expect(parts).toEqual([
      { text: "The ", match: false },
      { text: "Refresh", match: true },
      { text: " token rotated.", match: false },
    ]);
  });

  it("does not match inside a longer word", () => {
    const parts = highlightParts("authorisation and auth", "auth");

    expect(parts.filter((part) => part.match)).toHaveLength(1);
    expect(parts.find((part) => part.match)?.text).toBe("auth");
  });

  it("marks every query term once each", () => {
    const parts = highlightParts("token rotation on the token", "token rotation");

    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual([
      "token",
      "rotation",
      "token",
    ]);
  });

  it("returns the text unchanged without a usable query", () => {
    expect(highlightParts("plain text", "")).toEqual([
      { text: "plain text", match: false },
    ]);
    expect(highlightParts("plain text", "a")).toEqual([
      { text: "plain text", match: false },
    ]);
  });

  it("keeps punctuation inside the surrounding text", () => {
    const parts = highlightParts("“token”, then more", "token");
    expect(parts[0]?.text).toBe("“");
    expect(parts[1]).toEqual({ text: "token", match: true });
  });
});
