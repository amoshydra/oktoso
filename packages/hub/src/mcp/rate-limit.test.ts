import { describe, expect, it } from "vitest";
import { FixedWindowRateLimiter } from "./rate-limit";

describe("FixedWindowRateLimiter", () => {
  it("allows up to the limit and reports retry time", () => {
    const limiter = new FixedWindowRateLimiter();
    const policy = { max: 2, windowMs: 1_000 };

    expect(limiter.consume("client", policy, 0)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(limiter.consume("client", policy, 100)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    expect(limiter.consume("client", policy, 200)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 800,
    });
  });

  it("resets after the window", () => {
    const limiter = new FixedWindowRateLimiter();
    const policy = { max: 1, windowMs: 1_000 };

    expect(limiter.consume("client", policy, 0).allowed).toBe(true);
    expect(limiter.consume("client", policy, 500).allowed).toBe(false);
    expect(limiter.consume("client", policy, 1_000).allowed).toBe(true);
  });

  it("keeps separate buckets per client", () => {
    const limiter = new FixedWindowRateLimiter();
    const policy = { max: 1, windowMs: 1_000 };

    expect(limiter.consume("a", policy, 0).allowed).toBe(true);
    expect(limiter.consume("b", policy, 0).allowed).toBe(true);
    expect(limiter.consume("a", policy, 0).allowed).toBe(false);
  });

  it("sweeps expired windows", () => {
    const limiter = new FixedWindowRateLimiter({ maxKeys: 2 });
    const policy = { max: 5, windowMs: 1_000 };

    limiter.consume("a", policy, 0);
    limiter.consume("b", policy, 0);
    limiter.consume("c", policy, 2_000);
    limiter.sweep(2_000);
    expect(limiter.size).toBe(1);
  });
});
