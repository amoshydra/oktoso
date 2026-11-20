import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveBatcher } from "./live-batch";

describe("LiveBatcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies one batch per window and keeps the latest value per key", () => {
    const applied: string[][] = [];
    const batcher = new LiveBatcher<string>((items) => applied.push(items), 600);

    batcher.push("a", "a1");
    batcher.push("b", "b1");
    batcher.push("a", "a2");
    expect(applied).toHaveLength(0);

    vi.advanceTimersByTime(599);
    expect(applied).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(applied).toEqual([["a2", "b1"]]);
  });

  it("does not extend the window for later pushes, and flushes the last one", () => {
    const applied: string[][] = [];
    const batcher = new LiveBatcher<string>((items) => applied.push(items), 500);

    batcher.push("a", "first");
    vi.advanceTimersByTime(400);
    batcher.push("a", "second");
    vi.advanceTimersByTime(100);
    expect(applied).toEqual([["second"]]);

    batcher.push("a", "third");
    vi.advanceTimersByTime(500);
    expect(applied).toEqual([["second"], ["third"]]);
  });

  it("drops pending items on clear", () => {
    const applied: string[][] = [];
    const batcher = new LiveBatcher<string>((items) => applied.push(items), 500);

    batcher.push("a", "stale");
    batcher.clear();
    vi.advanceTimersByTime(1_000);

    expect(applied).toHaveLength(0);
    expect(batcher.size).toBe(0);
  });

  it("is a no-op when nothing is pending", () => {
    const applied: string[][] = [];
    const batcher = new LiveBatcher<string>((items) => applied.push(items), 500);

    batcher.flush();
    expect(applied).toHaveLength(0);
  });
});
