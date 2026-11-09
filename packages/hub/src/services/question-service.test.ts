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

describe("QuestionService provider tool questions", () => {
  it("maps a question tool call to a chat prompt", async () => {
    const data: Message[] = [
      {
        id: "m2",
        sessionRef: "provider:session",
        role: "assistant",
        parts: [
          {
            type: "tool",
            id: "call_q",
            name: "question",
            status: "running",
            input: {
              questions: [
                {
                  header: "Direction",
                  question: "Which direction should I take?",
                  options: [
                    { label: "MetaHuman spike", description: "Best quality" },
                    { label: "In-house pass" },
                  ],
                },
              ],
            },
          },
        ],
        createdAt: 1_793_000_000_000,
      },
      {
        id: "m1",
        sessionRef: "provider:session",
        role: "user",
        parts: [{ type: "text", text: "Do it" }],
        createdAt: 1_793_000_000_000,
      },
    ];
    const messages = vi.fn(async () => ({
      data,
      cursor: { next: null, previous: null },
    }));
    const service = new QuestionService(
      { messages } as unknown as SessionService,
      { now: () => 1_000 },
    );

    const prompt = await service.get("provider:session");

    expect(prompt?.questions[0]).toMatchObject({
      text: "Which direction should I take?",
      kind: "choice",
      confidence: "high",
      allowsFreeText: true,
    });
    expect(prompt?.questions[0].choices.map((choice) => choice.label)).toEqual([
      "MetaHuman spike",
      "In-house pass",
    ]);
    expect(prompt?.messageId).toBe("m2");
  });

  it("marks destructive tool choices for confirmation", async () => {
    const data: Message[] = [
      {
        id: "m2",
        sessionRef: "provider:session",
        role: "assistant",
        parts: [
          {
            type: "tool",
            id: "call_q",
            name: "question",
            status: "running",
            input: {
              question: "Delete the production volume?",
              options: [{ label: "Delete production volume" }, { label: "Cancel" }],
            },
          },
        ],
        createdAt: 1_793_000_000_000,
      },
    ];
    const messages = vi.fn(async () => ({
      data,
      cursor: { next: null, previous: null },
    }));
    const service = new QuestionService(
      { messages } as unknown as SessionService,
      { now: () => 1_000 },
    );

    const prompt = await service.get("provider:session");

    expect(prompt?.questions[0].risk).toBe("destructive");
    expect(prompt?.questions[0].choices[0]).toMatchObject({
      destructive: true,
      requiresConfirmation: true,
    });
  });
});

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
