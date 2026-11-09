import { describe, expect, it } from "vitest";
import type { Attention } from "@amoshydra/oktoso-contracts";
import { sortAttention, visibleAttention } from "./attention-model";

function item(id: string, priority: Attention["priority"]): Attention {
  return {
    id,
    sessionRef: `provider:${id}`,
    type: priority === "blocking" ? "permission" : "unread",
    priority,
    title: id,
    summary: id,
    createdAt: 1,
    actions: [],
  };
}

describe("G2 attention model", () => {
  it("keeps every blocking item past the five-row page", () => {
    const items = [
      ...Array.from({ length: 7 }, (_, index) =>
        item(`blocking-${index}`, "blocking"),
      ),
      ...Array.from({ length: 4 }, (_, index) => item(`unread-${index}`, "normal")),
    ];
    const visible = visibleAttention(items, false);

    expect(visible.filter((entry) => entry.priority === "blocking")).toHaveLength(7);
    expect(visible).toHaveLength(7);
  });

  it("fills spare page slots with unread rows and caps them", () => {
    const items = [
      item("blocking", "blocking"),
      ...Array.from({ length: 8 }, (_, index) => item(`unread-${index}`, "normal")),
    ];
    const visible = visibleAttention(items, false);

    expect(visible).toHaveLength(5);
    expect(visible[0]?.id).toBe("blocking");
    expect(visible.slice(1).every((entry) => entry.priority === "normal")).toBe(
      true,
    );
  });

  it("returns every item when expanded", () => {
    const items = Array.from({ length: 12 }, (_, index) =>
      item(`unread-${index}`, "normal"),
    );

    expect(visibleAttention(items, true)).toHaveLength(12);
  });

  it("sorts blocking items first without dropping order within a group", () => {
    const sorted = sortAttention([
      item("normal-1", "normal"),
      item("blocking-1", "blocking"),
      item("normal-2", "normal"),
      item("blocking-2", "blocking"),
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual([
      "blocking-1",
      "blocking-2",
      "normal-1",
      "normal-2",
    ]);
  });
});
