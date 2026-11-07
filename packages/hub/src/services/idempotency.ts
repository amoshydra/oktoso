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

  constructor(
    private readonly store: StateStore,
    options: IdempotencyServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.now = options.now ?? Date.now;
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
