import type { Message } from "@agent-hub/contracts";
import type { ProviderEvent } from "@agent-hub/providers";
import type { EventBus } from "./event-bus";
import type { ProviderRegistry } from "./provider-registry";
import type { SessionService } from "./session-service";
import type { AttentionService } from "./attention-service";
import type { Logger } from "../lib/logger";

export class ProviderEventService {
  private readonly controller = new AbortController();
  private readonly unsubscribes: Array<() => void> = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly messageTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingMessages = new Map<string, ProviderEvent>();
  private started = false;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly eventBus: EventBus,
    private readonly sessions: SessionService,
    private readonly logger: Logger,
    private readonly attention?: AttentionService,
    private readonly coalesceMs = 200,
    private readonly messageCoalesceMs = 50,
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    for (const adapter of this.registry.adapters()) {
      if (!adapter.subscribe) continue;
      try {
        const unsubscribe = await adapter.subscribe(
          (event) => this.handle(event),
          this.controller.signal,
        );
        this.unsubscribes.push(unsubscribe);
      } catch (error) {
        this.logger.warn("Provider event subscription failed", {
          providerID: adapter.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  stop(): void {
    this.controller.abort();
    for (const unsubscribe of this.unsubscribes.splice(0)) {
      try {
        unsubscribe();
      } catch {
        // Ignore provider shutdown errors.
      }
    }
    for (const timer of this.timers.values()) clearTimeout(timer);
    for (const timer of this.messageTimers.values()) clearTimeout(timer);
    this.timers.clear();
    this.messageTimers.clear();
    this.pendingMessages.clear();
    this.started = false;
  }

  private handle(event: ProviderEvent): void {
    this.sessions.invalidate();
    this.attention?.invalidate();

    if (
      event.type === "message.created" ||
      event.type === "message.updated" ||
      event.type === "message.delta"
    ) {
      this.handleMessage(event);
      return;
    }

    this.publishSessionUpdated(event);
  }

  private handleMessage(event: ProviderEvent): void {
    const message = messageFromProviderEvent(event);
    if (!message) {
      this.publishSessionUpdated(event);
      return;
    }

    const key = `${event.sessionRef}:${message.id}`;
    const pending = this.messageTimers.get(key);
    if (pending) clearTimeout(pending);

    this.pendingMessages.set(key, event);
    const timer = setTimeout(() => {
      this.messageTimers.delete(key);
      const latest = this.pendingMessages.get(key);
      this.pendingMessages.delete(key);
      if (!latest) return;
      const latestMessage = messageFromProviderEvent(latest);
      if (!latestMessage) return;

      void this.eventBus
        .publish(
          latest.type === "message.created" ? "message.created" : "message.updated",
          { message: latestMessage },
          { sessionRef: latest.sessionRef },
        )
        .catch((error) => {
          this.logger.warn("Failed to publish message update", {
            sessionRef: latest.sessionRef,
            messageID: latestMessage.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, this.messageCoalesceMs);

    this.messageTimers.set(key, timer);
  }

  private publishSessionUpdated(event: ProviderEvent): void {
    const providerID = event.sessionRef.slice(0, event.sessionRef.indexOf(":"));
    const pending = this.timers.get(event.sessionRef);
    if (pending) clearTimeout(pending);

    const timer = setTimeout(() => {
      this.timers.delete(event.sessionRef);
      void this.eventBus
        .publish(
          "session.updated",
          {
            providerID,
            eventType:
              event.data && typeof event.data === "object" && "eventType" in event.data
                ? (event.data as { eventType?: unknown }).eventType
                : event.type,
          },
          { sessionRef: event.sessionRef },
        )
        .catch((error) => {
          this.logger.warn("Failed to publish provider update", {
            providerID,
            sessionRef: event.sessionRef,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }, this.coalesceMs);

    this.timers.set(event.sessionRef, timer);
  }
}

function messageFromProviderEvent(event: ProviderEvent): Message | undefined {
  if (!event.data || typeof event.data !== "object") return undefined;
  const message = (event.data as { message?: unknown }).message;
  return message && typeof message === "object" ? (message as Message) : undefined;
}
