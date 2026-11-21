import { describe, expect, it, vi } from "vitest";
import { capActivity, RunTrace, type StepSink } from "./activity";
import type { AssistantStep } from "@amoshydra/oktoso-contracts";

function traceAt(clock: { now: number }) {
  const emitted: AssistantStep[] = [];
  const trace = new RunTrace({
    now: () => clock.now,
    emit: (step) => emitted.push(step),
  });
  return { trace, emitted, clock };
}

describe("RunTrace", () => {
  it("turns a begun step into a finished one with a duration", () => {
    const clock = { now: 1_000 };
    const { trace, emitted } = traceAt(clock);

    const step = trace.begin("model", "Model", "m");
    expect(step.status).toBe("running");
    expect(emitted).toHaveLength(1);

    clock.now = 4_400;
    trace.finish(step, "answered", { promptTokens: 10 });

    expect(step.status).toBe("ok");
    expect(step.durationMs).toBe(3_400);
    expect(step.metrics).toEqual({ promptTokens: 10 });
    expect(emitted).toHaveLength(2);
    expect(emitted[1]).toMatchObject({ status: "ok", durationMs: 3_400 });

    // The emitted copy is a snapshot, not the live object.
    expect(emitted[1]).not.toBe(step);
  });

  it("settles abandoned steps as cancelled, not failed", () => {
    const clock = { now: 0 };
    const { trace, emitted } = traceAt(clock);
    trace.begin("tool", "Searching");
    clock.now = 250;

    trace.settle("cancelled");

    expect(trace.items()).toHaveLength(1);
    expect(trace.items()[0]).toMatchObject({
      status: "cancelled",
      durationMs: 250,
    });
    expect(emitted.at(-1)?.status).toBe("cancelled");
  });

  it("stops accepting steps once the run settled", () => {
    const clock = { now: 0 };
    const { trace, emitted } = traceAt(clock);
    trace.settle("error", "boom");
    const before = emitted.length;

    trace.done("model", "Late step");

    expect(trace.items()).toHaveLength(0);
    expect(emitted).toHaveLength(before);
  });

  it("caps what it hands back, so a store write cannot fail", () => {
    const clock = { now: 0 };
    const { trace } = traceAt(clock);
    for (let index = 0; index < 55; index += 1) {
      trace.done("tool", `call ${index}`);
    }

    const items = trace.items();
    expect(items).toHaveLength(40);
    expect(items.at(-1)?.label).toBe("16 more steps");
    // The raw count is kept for the evidence line.
    expect(trace.size).toBe(55);
  });

  it("satisfies the sink contract while owning the array", () => {
    const clock = { now: 0 };
    const { trace } = traceAt(clock);
    const sink: StepSink = trace;
    sink.done("context", "Read session", "1 turn", 7, { turns: 1 });
    expect(trace.items()[0]?.metrics).toEqual({ turns: 1 });
    expect(capActivity(trace.items())).toHaveLength(1);
    vi.restoreAllMocks();
  });
});
