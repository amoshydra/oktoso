import { describe, expect, it } from "vitest";
import type { AssistantStep } from "@amoshydra/oktoso-contracts";
import {
  ACTIVITY_ICONS,
  activityStatusLabel,
  flattenActivity,
  itemsFromAssistantSteps,
  itemsFromChatSteps,
  type ActivityItem,
} from "./activity-model";
import type { ActivityStep } from "./activity";

function hubStep(over: Partial<AssistantStep> = {}): AssistantStep {
  return {
    id: "stp_1",
    kind: "context",
    label: "Read session",
    status: "ok",
    at: 1_000,
    ...over,
  };
}

describe("itemsFromAssistantSteps", () => {
  it("normalizes ok to completed and keeps the hub record", () => {
    const [item] = itemsFromAssistantSteps([hubStep({ durationMs: 7 })]);
    expect(item.status).toBe("completed");
    expect(item.durationMs).toBe(7);
    expect(item.data?.id).toBe("stp_1");
  });

  it("prefers a count over the duration for the tile label", () => {
    const [reads, search, model] = itemsFromAssistantSteps([
      hubStep({ id: "a", metrics: { turns: 3 }, durationMs: 7 }),
      hubStep({ id: "b", kind: "search", metrics: { hits: 1 }, durationMs: 5 }),
      hubStep({ id: "c", kind: "model", durationMs: 4_400 }),
    ]);
    expect(reads.metric).toBe("3 turns");
    expect(search.metric).toBe("1 hit");
    expect(model.metric).toBe("4.4s");
  });

  it("carries cancelled through unchanged", () => {
    const [item] = itemsFromAssistantSteps([hubStep({ status: "cancelled" })]);
    expect(item.status).toBe("cancelled");
    expect(activityStatusLabel(item.status)).toBe("cancelled");
  });

  it("has an icon for every hub kind", () => {
    for (const kind of [
      "context",
      "history",
      "model",
      "tool",
      "search",
      "fetch",
      "subagent",
      "other",
    ] as const) {
      expect(ACTIVITY_ICONS[kind]).toBeTruthy();
    }
  });
});

describe("itemsFromChatSteps", () => {
  it("uses the step key as the identity and keeps the provider part", () => {
    const step = {
      key: "msg:0",
      kind: "read" as const,
      label: "Read",
      status: "completed" as const,
      metric: "12 lines",
      part: { type: "tool" as const, id: "t1", name: "read", status: "completed" },
    } satisfies ActivityStep;
    const [item] = itemsFromChatSteps([step]);
    expect(item.id).toBe("msg:0");
    expect(item.metric).toBe("12 lines");
    expect(item.data).toBe(step);
  });
});

describe("flattenActivity", () => {
  const item = (id: string, parentId?: string): ActivityItem => ({
    id,
    kind: "tool",
    label: id,
    status: "completed",
    ...(parentId ? { parentId } : {}),
  });

  it("puts children directly after their parent", () => {
    const flat = flattenActivity([
      item("a"),
      item("a1", "a"),
      item("b"),
      item("a2", "a"),
    ]);
    expect(flat.map((entry) => `${entry.depth}:${entry.item.id}`)).toEqual([
      "0:a",
      "1:a1",
      "1:a2",
      "0:b",
    ]);
  });

  it("promotes an orphan instead of dropping it", () => {
    const flat = flattenActivity([item("orphan", "missing")]);
    expect(flat).toHaveLength(1);
    expect(flat[0]?.depth).toBe(0);
  });

  it("does not treat an item as its own parent", () => {
    const flat = flattenActivity([item("self", "self")]);
    expect(flat).toHaveLength(1);
    expect(flat[0]?.depth).toBe(0);
  });
});
