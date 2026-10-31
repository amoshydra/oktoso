import type { StateStore } from "@agent-hub/storage";

export interface IdempotencyServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1_000;

export class IdempotencyService {
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: StateStore,
    options: IdempotencyServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async get(key: string): Promise<unknown | undefined> {
    const entry = this.store.getState().idempotency[key];
    if (!entry) return undefined;
    if (entry.expiresAt > this.now()) return entry.response;

    await this.store.update((state) => {
      if (state.idempotency[key]?.expiresAt <= this.now()) {
        delete state.idempotency[key];
      }
    });
    return undefined;
  }

  async set(key: string, response: unknown): Promise<void> {
    const now = this.now();
    await this.store.update((state) => {
      for (const [existingKey, entry] of Object.entries(state.idempotency)) {
        if (entry.expiresAt <= now) delete state.idempotency[existingKey];
      }
      state.idempotency[key] = {
        response,
        expiresAt: now + this.ttlMs,
      };
    });
  }
}
