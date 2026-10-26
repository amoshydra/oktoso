import {
  createInitialState,
  zHubState,
  type HubState,
  type StateStore,
} from "./state";

export class MemoryStateStore implements StateStore {
  readonly kind = "memory";
  private state: HubState;
  private queue: Promise<void> = Promise.resolve();

  constructor(initial: HubState = createInitialState()) {
    this.state = structuredClone(initial);
  }

  getState(): HubState {
    return this.state;
  }

  async update(
    mutator: (state: HubState) => void | Promise<void>,
  ): Promise<HubState> {
    let result!: HubState;
    const next = this.queue.then(async () => {
      const draft = structuredClone(this.state);
      await mutator(draft);
      result = zHubState.parse(draft);
      this.state = result;
    });
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    await next;
    return result;
  }

  async close(): Promise<void> {
    await this.queue;
  }
}
