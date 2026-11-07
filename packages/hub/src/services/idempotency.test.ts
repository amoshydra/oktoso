import { describe, expect, it } from "vitest";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { IdempotencyService } from "./idempotency";

describe("IdempotencyService", () => {
  it("returns a cached response until the TTL expires", async () => {
    const store = new MemoryStateStore();
    let now = 1_000;
    const service = new IdempotencyService(store, {
      now: () => now,
      ttlMs: 100,
    });

    await service.set("session:answer-1", { accepted: true });
    expect(await service.get("session:answer-1")).toEqual({ accepted: true });

    now = 1_101;
    expect(await service.get("session:answer-1")).toBeUndefined();
  });

  it("keeps successful sends for 30 days by default", async () => {
    const store = new MemoryStateStore();
    let now = 1_000;
    const service = new IdempotencyService(store, { now: () => now });

    await service.set("session:answer-1", { accepted: true });

    now += 30 * 24 * 60 * 60 * 1_000 - 1;
    expect(await service.get("session:answer-1")).toEqual({ accepted: true });

    now += 1;
    expect(await service.get("session:answer-1")).toBeUndefined();
  });

  it("only returns a cached result when the request hash matches", async () => {
    const store = new MemoryStateStore();
    const service = new IdempotencyService(store, { now: () => 1_000 });

    await service.set("session:answer-1", { accepted: true }, "hash-a");

    expect(
      await service.get("session:answer-1", "hash-b"),
    ).toBeUndefined();
    expect(await service.get("session:answer-1", "hash-a")).toEqual({
      accepted: true,
    });
  });

  it("keeps entries written before request hashes were stored", async () => {
    const store = new MemoryStateStore();
    await store.update((state) => {
      state.idempotency.legacy = {
        response: { accepted: true },
        expiresAt: 2_000,
      };
    });
    const service = new IdempotencyService(store, { now: () => 1_000 });

    expect(await service.get("legacy", "hash-a")).toEqual({ accepted: true });
  });

  it("runs concurrent callers with the same key once", async () => {
    const store = new MemoryStateStore();
    const service = new IdempotencyService(store, { now: () => 1_000 });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const execute = async () => {
      calls += 1;
      await gate;
      return { accepted: true, messageID: `msg_${calls}` };
    };

    const first = service.run("session:answer-1", "hash-a", execute);
    const second = service.run("session:answer-1", "hash-a", execute);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(1);
    release();
    expect(await first).toEqual({ accepted: true, messageID: "msg_1" });
    expect(await second).toEqual({ accepted: true, messageID: "msg_1" });
    expect(calls).toBe(1);
  });

  it("prunes expired entries when a new response is cached", async () => {
    const store = new MemoryStateStore();
    let now = 1_000;
    const service = new IdempotencyService(store, {
      now: () => now,
      ttlMs: 100,
    });

    await service.set("old", { accepted: true });
    now = 1_101;
    await service.set("new", { accepted: true });

    expect(store.getState().idempotency.old).toBeUndefined();
    expect(store.getState().idempotency.new).toEqual({
      response: { accepted: true },
      expiresAt: 1_201,
    });
  });
});
