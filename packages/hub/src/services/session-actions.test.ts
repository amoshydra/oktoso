import { describe, expect, it } from "vitest";
import type { SendInput, SendResult } from "@amoshydra/oktoso-contracts";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { IdempotencyService } from "./idempotency";
import { SessionActions } from "./session-actions";
import type { QuestionService } from "./question-service";
import type { SessionService } from "./session-service";

function createActions(): {
  actions: SessionActions;
  sent: SendInput[];
} {
  const sent: SendInput[] = [];
  const sessions = {
    sendMessage: async (
      _ref: string,
      input: SendInput,
    ): Promise<SendResult> => {
      sent.push(input);
      return { accepted: true, messageID: `msg_${sent.length}` };
    },
  } as unknown as SessionService;
  const questions = {
    get: async () => undefined,
    invalidate: () => undefined,
  } as unknown as QuestionService;

  return {
    actions: new SessionActions(
      sessions,
      questions,
      new IdempotencyService(new MemoryStateStore()),
    ),
    sent,
  };
}

describe("SessionActions idempotency", () => {
  it("returns the cached result for a retry of the same payload", async () => {
    const { actions, sent } = createActions();

    const first = await actions.send("session:1", { text: "hello" }, "key-1");
    const second = await actions.send("session:1", { text: "hello" }, "key-1");

    expect(second).toEqual(first);
    expect(sent).toHaveLength(1);
  });

  it("sends when a reused key carries a different payload", async () => {
    const { actions, sent } = createActions();

    await actions.send("session:1", { text: "hello" }, "key-1");
    const second = await actions.send(
      "session:1",
      { text: "goodbye" },
      "key-1",
    );

    expect(sent).toHaveLength(2);
    expect(second.messageID).toBe("msg_2");
  });

  it("does not dedupe sends without a key", async () => {
    const { actions, sent } = createActions();

    await actions.send("session:1", { text: "hello" });
    await actions.send("session:1", { text: "hello" });

    expect(sent).toHaveLength(2);
  });

  it("dedupes concurrent sends with the same key", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const sessions = {
      sendMessage: async (): Promise<SendResult> => {
        calls += 1;
        await gate;
        return { accepted: true, messageID: "msg_1" };
      },
    } as unknown as SessionService;
    const questions = {
      get: async () => undefined,
      invalidate: () => undefined,
    } as unknown as QuestionService;
    const actions = new SessionActions(
      sessions,
      questions,
      new IdempotencyService(new MemoryStateStore()),
    );

    const first = actions.send("session:1", { text: "hello" }, "key-1");
    const second = actions.send("session:1", { text: "hello" }, "key-1");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    release();
    expect(await first).toEqual({ accepted: true, messageID: "msg_1" });
    expect(await second).toEqual({ accepted: true, messageID: "msg_1" });
    expect(calls).toBe(1);
  });
});
