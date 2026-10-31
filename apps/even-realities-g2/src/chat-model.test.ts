import { describe, expect, it } from "vitest";
import type { Message } from "@amoshydra/oktoso-contracts";
import {
  activityForMessages,
  buildChat,
  initialViewport,
  mergeChatMessages,
  nextViewport,
} from "./chat-model";

describe("G2 chat model", () => {
  it("opens at the start of the latest readable message", () => {
    const build = buildChat([
      message("u1", "user", longText("first prompt")),
      message("a1", "assistant", longText("first answer")),
      message("u2", "user", longText("second prompt")),
      message("a2", "assistant", longText("second answer")),
    ]);
    const maxOffset = Math.max(0, build.lines.length - 6);

    expect(build.latestMessageStart).toBe(build.messageStarts["a2"]);
    expect(initialViewport(build, 6)).toEqual({
      offset: Math.min(build.latestMessageStart, maxOffset),
      newBelow: false,
    });
  });

  it("preserves the reader line while the same message streams", () => {
    const first = buildChat([
      message("u1", "user", longText("prompt")),
      message("a1", "assistant", longText("partial")),
    ]);
    const next = buildChat([
      message("u1", "user", longText("prompt")),
      message("a1", "assistant", longText("partial answer with much more text added")),
    ]);
    const previousOffset = initialViewport(first, 6).offset;

    expect(
      nextViewport({
        previousOffset,
        previousLineCount: first.lines.length,
        newBelow: false,
        build: next,
        visibleLines: 6,
      }),
    ).toEqual({
      offset: previousOffset,
      newBelow: false,
    });
  });

  it("jumps to a new message start only when already at the bottom", () => {
    const first = buildChat([
      message("u1", "user", longText("prompt")),
      message("a1", "assistant", longText("answer")),
    ]);
    const next = buildChat([
      message("u1", "user", longText("prompt")),
      message("a1", "assistant", longText("answer")),
      message("u2", "user", longText("new prompt")),
      message("a2", "assistant", longText("new answer")),
    ]);
    const previousOffset = Math.max(0, first.lines.length - 6);
    const nextMax = Math.max(0, next.lines.length - 6);

    expect(
      nextViewport({
        previousOffset,
        previousLineCount: first.lines.length,
        newBelow: false,
        build: next,
        visibleLines: 6,
        newMessageID: "a2",
      }),
    ).toEqual({
      offset: Math.min(next.messageStarts["a2"]!, nextMax),
      newBelow: false,
    });
  });

  it("preserves the line and marks New below when scrolled up", () => {
    const first = buildChat([
      message("u1", "user", longText("prompt")),
      message("a1", "assistant", longText("answer")),
    ]);
    const next = buildChat([
      message("u1", "user", longText("prompt")),
      message("a1", "assistant", longText("answer")),
      message("u2", "user", longText("new prompt")),
      message("a2", "assistant", longText("new answer")),
    ]);

    expect(
      nextViewport({
        previousOffset: 0,
        previousLineCount: first.lines.length,
        newBelow: false,
        build: next,
        visibleLines: 6,
        newMessageID: "a2",
      }),
    ).toEqual({ offset: 0, newBelow: true });
  });

  it("does not jump for a new tool-only message with no text", () => {
    const first = buildChat([message("u1", "user", "prompt")]);
    const next = buildChat([
      message("u1", "user", "prompt"),
      {
        ...message("tool1", "assistant", ""),
        parts: [{ type: "tool", id: "t1", name: "read", status: "running" }],
        streaming: true,
      },
    ]);

    expect(
      nextViewport({
        previousOffset: 0,
        previousLineCount: first.lines.length,
        newBelow: false,
        build: next,
        visibleLines: 6,
        newMessageID: "tool1",
      }),
    ).toEqual({ offset: 0, newBelow: false });
  });

  it("summarizes agent activity", () => {
    expect(
      activityForMessages([
        {
          ...message("a1", "assistant", ""),
          parts: [
            { type: "tool", id: "t1", name: "read", status: "completed" },
            { type: "tool", id: "t2", name: "edit", status: "completed" },
          ],
          streaming: true,
        },
      ]),
    ).toBe("Working · 2 steps");

    expect(
      activityForMessages([
        {
          ...message("a1", "assistant", ""),
          parts: [{ type: "tool", id: "t1", name: "read", status: "error" }],
        },
      ]),
    ).toBe("Tool error");
  });

  it("merges by message id without reordering", () => {
    const merged = mergeChatMessages(
      [message("a", "user", "one", 1), message("b", "assistant", "two", 2)],
      [message("b", "assistant", "two updated", 2), message("c", "user", "three", 3)],
    );
    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
    expect(merged[1]?.parts).toEqual([{ type: "text", text: "two updated" }]);
  });
});

function longText(prefix: string): string {
  return `${prefix} ${"word ".repeat(20)}`;
}

function message(
  id: string,
  role: Message["role"],
  text: string,
  createdAt = 1,
): Message {
  return {
    id,
    sessionRef: "test:ses_1",
    role,
    parts: text ? [{ type: "text", text }] : [],
    createdAt,
  };
}
