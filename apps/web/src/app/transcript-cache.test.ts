import { beforeEach, describe, expect, it } from "vitest";
import type { Message } from "@amoshydra/oktoso-contracts";
import {
  clearTranscriptCache,
  readTranscriptCache,
  removeTranscriptCache,
  writeTranscriptCache,
} from "./transcript-cache";

function message(id: string): Message {
  return {
    id,
    sessionRef: "desktop-opencode:ses_auth",
    role: "user",
    parts: [{ type: "text", text: id }],
    createdAt: Number(id.replace(/\D/g, "")) || 0,
  };
}

describe("transcript cache", () => {
  beforeEach(() => {
    clearTranscriptCache();
  });

  it("keeps the loaded window and its pagination cursor", () => {
    const messages = [message("m1"), message("m2")];
    writeTranscriptCache("ref-a", { messages, olderCursor: "cursor-1" });
    const entry = readTranscriptCache("ref-a");
    expect(entry?.messages.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(entry?.olderCursor).toBe("cursor-1");
    expect(entry?.savedAt).toEqual(expect.any(Number));
  });

  it("keeps the newest messages and re-anchors pagination when capped", () => {
    const messages = Array.from({ length: 305 }, (_, index) =>
      message(`m${index + 1}`),
    );
    writeTranscriptCache("ref-large", { messages, olderCursor: "cursor-old" });
    const entry = readTranscriptCache("ref-large");
    expect(entry?.messages).toHaveLength(300);
    expect(entry?.messages[0]?.id).toBe("m6");
    expect(entry?.messages.at(-1)?.id).toBe("m305");
    expect(entry?.olderCursor).toBeNull();
  });

  it("evicts the least recently read session", () => {
    for (const ref of ["ref-1", "ref-2", "ref-3", "ref-4", "ref-5", "ref-6"]) {
      writeTranscriptCache(ref, { messages: [message(ref)], olderCursor: null });
    }
    readTranscriptCache("ref-1");
    writeTranscriptCache("ref-7", {
      messages: [message("ref-7")],
      olderCursor: null,
    });
    expect(readTranscriptCache("ref-2")).toBeUndefined();
    expect(readTranscriptCache("ref-1")).toBeDefined();
    expect(readTranscriptCache("ref-7")).toBeDefined();
  });

  it("removes one session or all sessions", () => {
    writeTranscriptCache("ref-a", { messages: [], olderCursor: null });
    writeTranscriptCache("ref-b", { messages: [], olderCursor: null });
    removeTranscriptCache("ref-a");
    expect(readTranscriptCache("ref-a")).toBeUndefined();
    expect(readTranscriptCache("ref-b")).toBeDefined();
    clearTranscriptCache();
    expect(readTranscriptCache("ref-b")).toBeUndefined();
  });
});
