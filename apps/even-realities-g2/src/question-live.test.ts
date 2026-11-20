import { describe, expect, it } from "vitest";
import type { Message } from "@amoshydra/oktoso-contracts";
import {
  hasPendingQuestionTool,
  holdsQuestionDraft,
  shouldRefreshQuestion,
} from "./question-live";

function message(parts: Message["parts"]): Message {
  return {
    id: "m1",
    sessionRef: "desktop-opencode:ses_a",
    role: "assistant",
    createdAt: 1,
    parts,
  };
}

describe("live question refresh", () => {
  it("treats an open question tool call as pending", () => {
    expect(
      hasPendingQuestionTool(
        message([
          {
            type: "tool",
            id: "t1",
            name: "question",
            status: "running",
            input: { questions: [{ question: "Ship it?" }] },
          },
        ]),
      ),
    ).toBe(true);
  });

  it("ignores completed, failed, and non-question tools", () => {
    const statuses = ["completed", "error"];
    for (const status of statuses) {
      expect(
        hasPendingQuestionTool(
          message([{ type: "tool", id: "t1", name: "question", status }]),
        ),
      ).toBe(false);
    }
    expect(
      hasPendingQuestionTool(
        message([{ type: "tool", id: "t2", name: "bash", status: "running" }]),
      ),
    ).toBe(false);
  });

  it("never refreshes over a draft screen", () => {
    for (const screen of [
      "answer",
      "answer-type",
      "answer-confirm",
      "answer-suggestions",
      "answer-stale",
    ]) {
      expect(holdsQuestionDraft(screen)).toBe(true);
    }
    expect(holdsQuestionDraft("answer-sent")).toBe(false);
    expect(holdsQuestionDraft("chat")).toBe(false);
    expect(holdsQuestionDraft("reply")).toBe(false);
  });

  it("skips the fetch when the revision already matches", () => {
    expect(
      shouldRefreshQuestion({ summaryRevision: "r1", currentRevision: "r1" }),
    ).toBe(false);
    expect(
      shouldRefreshQuestion({ summaryRevision: "r2", currentRevision: "r1" }),
    ).toBe(true);
    expect(shouldRefreshQuestion({ currentRevision: "r1" })).toBe(true);
  });
});
