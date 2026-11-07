import type { StateStore } from "@amoshydra/oktoso-storage";

export interface IdempotencyServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

// Long enough for a suspended phone or tab to retry after days. Entries are
// tiny, and the request hash prevents a reused key from swallowing a new send.
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export class IdempotencyService {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly inFlight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly store: StateStore,
    options: IdempotencyServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Run an operation at most once for a key while it is in flight. Concurrent
   * callers with the same key wait for the first result instead of both
   * reaching the provider.
   */
  async run<T>(
    key: string,
    requestHash: string | undefined,
    execute: () => Promise<T>,
  ): Promise<T> {
    for (;;) {
      const cached = await this.get(key, requestHash);
      if (cached !== undefined) return cached as T;
      const active = this.inFlight.get(key);
      if (!active) break;
      try {
        await active;
      } catch {
        // The previous attempt failed. Loop to retry or use its cached result.
      }
    }

    const promise = (async () => {
      const response = await execute();
      await this.set(key, response, requestHash);
      return response;
    })();
    this.inFlight.set(key, promise);
    try {
      return (await promise) as T;
    } finally {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    }
  }

  async get(key: string, requestHash?: string): Promise<unknown | undefined> {
    const entry = this.store.getState().idempotency[key];
    if (!entry) return undefined;
    if (entry.expiresAt > this.now()) {
      if (
        requestHash &&
        entry.requestHash &&
        entry.requestHash !== requestHash
      ) {
        return undefined;
      }
      return entry.response;
    }

    await this.store.update((state) => {
      if (state.idempotency[key]?.expiresAt <= this.now()) {
        delete state.idempotency[key];
      }
    });
    return undefined;
  }

  async set(
    key: string,
    response: unknown,
    requestHash?: string,
  ): Promise<void> {
    const now = this.now();
    await this.store.update((state) => {
      for (const [existingKey, entry] of Object.entries(state.idempotency)) {
        if (entry.expiresAt <= now) delete state.idempotency[existingKey];
      }
      state.idempotency[key] = {
        response,
        ...(requestHash ? { requestHash } : {}),
        expiresAt: now + this.ttlMs,
      };
    });
  }
}
