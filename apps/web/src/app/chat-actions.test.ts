import { describe, expect, it } from "vitest";
import type { Message } from "@amoshydra/oktoso-contracts";
import {
  appendTranscript,
  formatDictationDuration,
  messageCopyText,
} from "./chat-actions";

function message(parts: Message["parts"]): Message {
  return {
    id: "msg_1",
    sessionRef: "desktop-opencode:ses_1",
    role: "assistant",
    parts,
    createdAt: 1,
  };
}

describe("messageCopyText", () => {
  it("joins text parts and ignores activity", () => {
    expect(
      messageCopyText(
        message([
          { type: "reasoning", text: "private thought" },
          { type: "text", text: "First paragraph." },
          { type: "text", text: "Second paragraph." },
          { type: "tool", id: "t1", name: "read", status: "done" },
        ]),
      ),
    ).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("returns an empty string when there is no text", () => {
    expect(
      messageCopyText(
        message([
          { type: "reasoning", text: "private thought" },
          { type: "tool", id: "t1", name: "read", status: "done" },
        ]),
      ),
    ).toBe("");
  });

  it("trims surrounding whitespace", () => {
    expect(
      messageCopyText(message([{ type: "text", text: "  hello  " }])),
    ).toBe("hello");
  });
});

describe("appendTranscript", () => {
  it("uses the transcript when the draft is empty", () => {
    expect(appendTranscript("", "hello")).toBe("hello");
  });

  it("adds a separating space when needed", () => {
    expect(appendTranscript("hello", "world")).toBe("hello world");
    expect(appendTranscript("hello ", "world")).toBe("hello world");
    expect(appendTranscript("hello\n", "world")).toBe("hello\nworld");
  });

  it("trims the transcript and ignores empty speech", () => {
    expect(appendTranscript("hello", "  world  ")).toBe("hello world");
    expect(appendTranscript("hello", "   ")).toBe("hello");
  });
});

describe("formatDictationDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatDictationDuration(0)).toBe("0:00");
    expect(formatDictationDuration(65_000)).toBe("1:05");
    expect(formatDictationDuration(120_000)).toBe("2:00");
  });
});
