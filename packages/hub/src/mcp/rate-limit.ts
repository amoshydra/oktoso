export interface RateLimitPolicy {
  max: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

interface Window {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed-window limiter keyed by client ID. The hosted MCP surface is
 * a single-process control plane, so a shared store is not required yet.
 */
export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly maxKeys: number;

  constructor(options: { maxKeys?: number } = {}) {
    this.maxKeys = options.maxKeys ?? 1_000;
  }

  consume(
    key: string,
    policy: RateLimitPolicy,
    now = Date.now(),
  ): RateLimitResult {
    if (this.windows.size > this.maxKeys) this.sweep(now);
    let window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      window = { count: 0, resetAt: now + policy.windowMs };
      this.windows.set(key, window);
    }
    window.count += 1;
    if (window.count > policy.max) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, window.resetAt - now),
      };
    }
    return {
      allowed: true,
      remaining: policy.max - window.count,
      retryAfterMs: 0,
    };
  }

  sweep(now = Date.now()): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
  }

  get size(): number {
    return this.windows.size;
  }
}
