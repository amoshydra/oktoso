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
