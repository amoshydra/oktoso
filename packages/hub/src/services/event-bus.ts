import type { HubEvent } from "@agent-hub/contracts";
import type { StateStore } from "@agent-hub/storage";
import type { Logger } from "../lib/logger";

export interface EventBusOptions {
  bufferSize?: number;
  heartbeatMs?: number;
  now?: () => number;
}

type Listener = (event: HubEvent) => void;

export interface ReplayResult {
  events: HubEvent[];
  gap: boolean;
  latestSeq: number;
}

/**
 * Monotonic in-process event log. The event sequence is durable; the replay
 * buffer is intentionally memory-only and bounded.
 */
export class EventBus {
  private seq = 0;
  private readonly buffer: HubEvent[] = [];
  private readonly listeners = new Set<Listener>();
  private queue: Promise<void> = Promise.resolve();
  private readonly bufferSize: number;
  private readonly heartbeatMs: number;
  private readonly now: () => number;

  constructor(
    private readonly store: StateStore,
    private readonly logger: Logger,
    options: EventBusOptions = {},
  ) {
    this.bufferSize = options.bufferSize ?? 500;
    this.heartbeatMs = options.heartbeatMs ?? 15_000;
    this.now = options.now ?? Date.now;
  }

  async init(): Promise<void> {
    this.seq = this.store.getState().lastSeq;
  }

  get lastSeq(): number {
    return this.seq;
  }

  get subscriberCount(): number {
    return this.listeners.size;
  }

  get bufferLength(): number {
    return this.buffer.length;
  }

  get heartbeatIntervalMs(): number {
    return this.heartbeatMs;
  }

  publish(
    type: HubEvent["type"],
    data: unknown,
    options: { sessionRef?: string; attentionID?: string } = {},
  ): Promise<HubEvent> {
    let result!: HubEvent;
    const run = this.queue.then(async () => {
      const seq = this.seq + 1;
      const event: HubEvent = {
        seq,
        type,
        data,
        at: this.now(),
        ...(options.sessionRef ? { sessionRef: options.sessionRef } : {}),
        ...(options.attentionID ? { attentionID: options.attentionID } : {}),
      };

      await this.store.update((state) => {
        state.lastSeq = seq;
      });
      this.seq = seq;
      this.buffer.push(event);
      while (this.buffer.length > this.bufferSize) this.buffer.shift();
      result = event;
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch (error) {
          this.logger.error("Event listener failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    });
    this.queue = run.then(
      () => undefined,
      (error) => {
        this.logger.error("Event publish failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return run.then(() => result);
  }

  replay(after: number): ReplayResult {
    const latestSeq = this.seq;
    if (after > latestSeq) return { events: [], gap: true, latestSeq };
    if (this.buffer.length === 0) {
      return { events: [], gap: after < latestSeq, latestSeq };
    }

    const oldest = this.buffer[0]!.seq;
    if (after < oldest - 1) return { events: [], gap: true, latestSeq };
    return {
      events: this.buffer.filter((event) => event.seq > after),
      gap: false,
      latestSeq,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
