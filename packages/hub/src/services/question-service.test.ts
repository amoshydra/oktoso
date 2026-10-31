import { describe, expect, it, vi } from "vitest";
import type { Message } from "@amoshydra/oktoso-contracts";
import type { SessionService } from "./session-service";
import { QuestionService } from "./question-service";

function message(id: string, text: string): Message {
  return {
    id,
    sessionRef: "provider:session",
    role: "assistant",
    parts: [{ type: "text", text }],
    createdAt: 1_793_000_000_000,
  };
}

describe("QuestionService summaries", () => {
  it("returns compact summaries and reports provider failures", async () => {
    const messages = vi.fn(async (ref: string) => {
      if (ref === "provider:offline") throw new Error("provider offline");
      return {
        data: [message(`${ref}:m1`, "Should I proceed?")],
        cursor: { next: null, previous: null },
      };
    });
    const service = new QuestionService(
      { messages } as unknown as SessionService,
      { now: () => 1_000, summaryTtlMs: 5_000 },
    );

    const result = await service.summaries([
      "provider:one",
      "provider:offline",
    ]);
    expect(result.failed).toEqual(["provider:offline"]);
    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toMatchObject({
      sessionRef: "provider:one",
      questionCount: 1,
      text: "Should I proceed?",
    });
  });

  it("reuses a summary until its TTL expires", async () => {
    let now = 1_000;
    const messages = vi.fn(async (ref: string) => ({
      data: [message(`${ref}:m1`, "Should I proceed?")],
      cursor: { next: null, previous: null },
    }));
    const service = new QuestionService(
      { messages } as unknown as SessionService,
      { now: () => now, summaryTtlMs: 5_000 },
    );

    await service.summaries(["provider:one"]);
    await service.summaries(["provider:one"]);
    expect(messages).toHaveBeenCalledTimes(1);

    now = 6_000;
    await service.summaries(["provider:one"]);
    expect(messages).toHaveBeenCalledTimes(2);
  });
});
