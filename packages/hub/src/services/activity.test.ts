import { describe, expect, it } from "vitest";
import {
  MAX_ASSISTANT_ACTIVITY_STEPS,
  zAssistantTurn,
  type AssistantStep,
} from "@amoshydra/oktoso-contracts";
import { capActivity } from "./activity";

function step(index: number): AssistantStep {
  return {
    id: `stp_${index}`,
    kind: "tool",
    label: `step ${index}`,
    status: "ok",
    at: 1_793_000_000_000 + index,
    durationMs: 1,
  };
}

describe("capActivity", () => {
  it("leaves a run at or under the cap untouched", () => {
    const steps = Array.from({ length: MAX_ASSISTANT_ACTIVITY_STEPS }, (_, i) =>
      step(i),
    );
    expect(capActivity(steps)).toBe(steps);
    expect(capActivity(steps)).toHaveLength(MAX_ASSISTANT_ACTIVITY_STEPS);
  });

  it("folds an over-long run into one summary and still validates", () => {
    const steps = Array.from({ length: MAX_ASSISTANT_ACTIVITY_STEPS + 11 }, (_, i) =>
      step(i),
    );
    const capped = capActivity(steps);

    expect(capped).toHaveLength(MAX_ASSISTANT_ACTIVITY_STEPS);
    expect(capped[0]).toEqual(steps[0]);
    const summary = capped[capped.length - 1];
    expect(summary.label).toBe("12 more steps");
    expect(summary.detail).toContain("51 steps");
    expect(summary.at).toBe(steps[steps.length - 1].at);

    // The regression this guards: the store validates every turn write, so an
    // uncapped run threw at save time and the answer was lost.
    expect(() =>
      zAssistantTurn.parse({
        id: "atn_1",
        threadId: "ast_1",
        role: "assistant",
        text: "answer",
        createdAt: 1_793_000_000_000,
        activity: capped,
      }),
    ).not.toThrow();
  });

  it("uses the contract maximum, not a local copy", () => {
    expect(MAX_ASSISTANT_ACTIVITY_STEPS).toBe(40);
  });
});
