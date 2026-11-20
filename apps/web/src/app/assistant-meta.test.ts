import { describe, expect, it } from "vitest";
import type { AssistantTurn } from "@amoshydra/oktoso-contracts";
import { historyLabel, timeLabel, turnMetaParts } from "./assistant-meta";

function turn(context: AssistantTurn["context"]): AssistantTurn {
  return {
    id: "atn_1",
    threadId: "ath_1",
    role: "assistant",
    text: "answer",
    createdAt: Date.now(),
    context,
  };
}

describe("assistant evidence line", () => {
  it("places the history clause after the session stamp", () => {
    const asOf = Date.now() - 2 * 60_000;
    const historyAt = Date.now() - 7 * 86_400_000;
    const parts = turnMetaParts(
      turn({ messages: 4, omitted: 0, failures: 1, asOf, historyAt }),
    );

    const session = parts.findIndex((part) => part.startsWith("session as of "));
    const history = parts.findIndex((part) => part.startsWith("history "));
    expect(session).toBeGreaterThanOrEqual(0);
    expect(history).toBe(session + 1);
    expect(parts[history]).toBe(`history ${historyLabel(historyAt)}`);
  });

  it("dates an older compaction and only times a same-day one", () => {
    const older = Date.now() - 7 * 86_400_000;
    expect(historyLabel(older)).toBe(
      new Date(older).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
    );
    expect(historyLabel(older)).not.toBe(timeLabel(older));
    expect(historyLabel(Date.now())).toBe(timeLabel(Date.now()));
  });

  it("omits the clause when the answer used no compaction", () => {
    const parts = turnMetaParts(turn({ messages: 2, asOf: Date.now() }));
    expect(parts.some((part) => part.startsWith("history "))).toBe(false);
  });
});
