import type { Draft } from "@agent-hub/contracts";
import type { StateStore } from "@agent-hub/storage";

export interface DraftServiceOptions {
  now?: () => number;
}

export class DraftService {
  private readonly now: () => number;

  constructor(
    private readonly store: StateStore,
    options: DraftServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  get(ref: string): Draft | null {
    const draft = this.store.getState().drafts[ref];
    if (!draft) return null;
    return {
      sessionRef: ref,
      text: draft.text,
      updatedAt: draft.updatedAt,
    };
  }

  async save(ref: string, text: string): Promise<Draft> {
    const updatedAt = this.now();
    await this.store.update((state) => {
      state.drafts[ref] = { text, updatedAt };
    });
    return { sessionRef: ref, text, updatedAt };
  }

  async delete(ref: string): Promise<void> {
    if (!this.store.getState().drafts[ref]) return;
    await this.store.update((state) => {
      delete state.drafts[ref];
    });
  }
}
