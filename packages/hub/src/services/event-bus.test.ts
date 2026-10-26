import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "@agent-hub/storage";
import { EventBus } from "./event-bus";
import { createLogger } from "../lib/logger";

const logger = createLogger({ level: "silent" });

describe("EventBus", () => {
  it("assigns monotonic sequences and replays events", async () => {
    const store = new MemoryStateStore();
    const bus = new EventBus(store, logger, { now: () => 100 });
    await bus.init();

    await bus.publish("session.updated", { title: "one" }, { sessionRef: "a" });
    await bus.publish("session.updated", { title: "two" }, { sessionRef: "b" });

    expect(bus.lastSeq).toBe(2);
    expect(bus.replay(0)).toMatchObject({
      gap: false,
      events: [{ seq: 1 }, { seq: 2 }],
    });
    expect(bus.replay(1).events).toHaveLength(1);
    expect(store.getState().lastSeq).toBe(2);
  });

  it("reports a gap when the cursor is behind the buffer", async () => {
    const store = new MemoryStateStore();
    const bus = new EventBus(store, logger, { bufferSize: 2 });
    await bus.init();

    await bus.publish("error", { n: 1 });
    await bus.publish("error", { n: 2 });
    await bus.publish("error", { n: 3 });

    expect(bus.replay(0).gap).toBe(true);
    expect(bus.replay(2).events).toHaveLength(1);
  });

  it("preserves the sequence across bus restarts", async () => {
    const store = new MemoryStateStore();
    const first = new EventBus(store, logger);
    await first.init();
    await first.publish("session.read", {});

    const second = new EventBus(store, logger);
    await second.init();
    expect(second.lastSeq).toBe(1);
    const event = await second.publish("session.read", {});
    expect(event.seq).toBe(2);
  });

  it("notifies subscribers and stops after unsubscribe", async () => {
    const store = new MemoryStateStore();
    const bus = new EventBus(store, logger);
    await bus.init();
    const received: number[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event.seq));

    await bus.publish("provider.status", {});
    unsubscribe();
    await bus.publish("provider.status", {});

    expect(received).toEqual([1]);
    expect(bus.subscriberCount).toBe(0);
  });
});
