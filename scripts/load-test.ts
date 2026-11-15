import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  JsonStateStore,
  MemoryStateStore,
  type StateStore,
} from "@amoshydra/oktoso-storage";
import { EventBus } from "../packages/hub/src/services/event-bus";
import { createLogger } from "../packages/hub/src/lib/logger";

/**
 * SSE fan-out load check.
 *
 * Subscribes many listeners (the SSE path serializes each event per client),
 * then publishes a burst and reports latency percentiles. Run with:
 *   pnpm exec tsx scripts/load-test.ts
 */

const LISTENERS = Number(process.env.LOAD_LISTENERS ?? 200);
const BURST = Number(process.env.LOAD_BURST ?? 500);

// Memory measures the bus; json measures production, where every publish is a
// clone, a schema parse, a full rewrite, and two fsyncs.
const useJson = process.env.LOAD_STORE === "json";
const scratch = useJson ? await mkdtemp(join(tmpdir(), "oktoso-load-")) : undefined;
const store: StateStore = scratch
  ? await JsonStateStore.open({ filePath: join(scratch, "state.json") })
  : new MemoryStateStore();
const logger = createLogger({ level: "silent" });
const bus = new EventBus(store, logger, { heartbeatMs: 60_000 });
await bus.init();

let frames = 0;
for (let index = 0; index < LISTENERS; index += 1) {
  bus.subscribe((event) => {
    // Approximates the SSE write: serialize the frame per client.
    JSON.stringify({ id: event.seq, type: event.type, data: event.data });
    frames += 1;
  });
}

const samples: number[] = [];
const started = performance.now();
for (let index = 0; index < BURST; index += 1) {
  const at = Date.now();
  const before = performance.now();
  await bus.publish("automation.run", {
    id: `run_${index}`,
    watcherID: "load",
    trigger: "schedule",
    decision: "skipped",
    reason: "budget",
    at,
  } as never);
  samples.push(performance.now() - before);
}
const totalMs = performance.now() - started;

samples.sort((left, right) => left - right);
const at = (p: number) => samples[Math.min(samples.length - 1, Math.floor(samples.length * p))]!;

console.log(
  JSON.stringify(
    {
      listeners: LISTENERS,
      events: BURST,
      frames,
      totalMs: +totalMs.toFixed(0),
      perEventMs: +(totalMs / BURST).toFixed(3),
      publishP50Ms: +at(0.5).toFixed(3),
      publishP95Ms: +at(0.95).toFixed(3),
      publishMaxMs: +at(1).toFixed(3),
      framesPerSecond: Math.round(frames / (totalMs / 1000)),
      store: useJson ? "json" : "memory",
      rssMB: +(process.memoryUsage().rss / 1_000_000).toFixed(1),
    },
    null,
    2,
  ),
);
if (scratch) await rm(scratch, { recursive: true, force: true });
