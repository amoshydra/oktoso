import { randomUUID } from "node:crypto";
import {
  zAttention,
  zNotificationRouting,
  type Attention,
  type NotificationChannelKind,
  type NotificationChannelView,
  type NotificationDelivery,
  type NotificationRouting,
  type NotificationSettings,
  type NotificationSettingsInput,
  type PushSubscription,
  type PushSubscriptionInput,
  type QuietHours,
} from "@amoshydra/oktoso-contracts";
import type {
  NotificationSubscriptionState,
  StateStore,
} from "@amoshydra/oktoso-storage";
import type { NotificationConfig } from "../config/schema";
import type { Logger } from "../lib/logger";
import { badRequest } from "../domain/errors";
import type { EventBus } from "./event-bus";

/** A single wake-up the hub wants to deliver. */
export interface NotificationPayload {
  id: string;
  kind: "immediate" | "digest";
  channel: NotificationChannelKind;
  /** The newest item represented by this payload. */
  attention: Attention;
  count: number;
  sessionCount: number;
  title: string;
  body: string;
  /** Relative deep link into the web client. */
  url: string;
  /** Collapse key for the operating system. */
  tag: string;
}

export interface NotificationTransport {
  supports(channel: NotificationChannelKind): boolean;
  send(payload: NotificationPayload): Promise<void>;
}

/** Used before a transport is configured; accepts nothing. */
export const noopNotificationTransport: NotificationTransport = {
  supports: () => false,
  async send() {},
};

export interface NotificationServiceOptions {
  config: NotificationConfig;
  store: StateStore;
  eventBus: EventBus;
  logger: Logger;
  transport?: NotificationTransport;
  now?: () => number;
  retryDelayMs?: number;
  maxDeliveries?: number;
  coalesceWindowMs?: number;
  /** VAPID public key exposed to clients for `pushManager.subscribe`. */
  applicationServerKey?: string;
}

const DEFAULT_MAX_DELIVERIES = 200;
const SEEN_TTL_MS = 60 * 60 * 1_000;
const MAX_SEEN = 500;

/**
 * Routes attention events to configured channels.
 *
 * The service is deliberately independent of the attention refresh loop: it
 * listens to `attention.created` / `attention.resolved` only, so a refresh that
 * changes nothing produces no notification.
 */
export class NotificationService {
  private readonly config: NotificationConfig;
  private readonly store: StateStore;
  private readonly eventBus: EventBus;
  private readonly logger: Logger;
  private readonly transport: NotificationTransport;
  private readonly now: () => number;
  private readonly retryDelayMs: number;
  private readonly maxDeliveries: number;
  private readonly coalesceWindowMs: number;
  private readonly applicationServerKey?: string;

  private stopListening?: () => void;
  private timer?: ReturnType<typeof setTimeout>;
  private immediateTimer?: ReturnType<typeof setTimeout>;
  private work: Promise<void> = Promise.resolve();
  private readonly immediate = new Map<string, Attention[]>();
  private readonly digest = new Map<string, Attention>();
  private readonly seen = new Map<string, number>();

  constructor(options: NotificationServiceOptions) {
    this.config = options.config;
    this.store = options.store;
    this.eventBus = options.eventBus;
    this.logger = options.logger;
    this.transport = options.transport ?? noopNotificationTransport;
    this.now = options.now ?? Date.now;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.maxDeliveries = options.maxDeliveries ?? DEFAULT_MAX_DELIVERIES;
    this.coalesceWindowMs = options.coalesceWindowMs ?? 1_500;
    this.applicationServerKey = options.applicationServerKey;
  }

  get enabled(): boolean {
    const override = this.store.getState().notificationOverrides.enabled;
    return override ?? this.config.enabled;
  }

  get routing(): NotificationRouting {
    return this.store.getState().notificationOverrides.routing ?? this.config.routing;
  }

  start(): () => void {
    if (this.stopListening) return this.stopListening;
    const unsubscribe = this.eventBus.subscribe((event) => {
      if (event.type === "attention.resolved") {
        if (event.attentionID) this.forget(event.attentionID);
        return;
      }
      if (event.type !== "attention.created") return;

      const parsed = zAttention.safeParse(event.data);
      if (!parsed.success) {
        this.logger.warn("Ignoring malformed attention notification event", {
          attentionID: event.attentionID,
        });
        return;
      }
      this.work = this.work
        .then(() => this.handle(parsed.data))
        .catch((error) => {
          this.logger.error("Notification handling failed", {
            attentionID: parsed.data.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    });

    this.stopListening = () => {
      unsubscribe();
      this.stopListening = undefined;
    };
    return this.stopListening;
  }

  /** Clear timers and listeners. Queued digests are dropped. */
  stop(): void {
    this.stopListening?.();
    this.stopListening = undefined;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.immediateTimer) clearTimeout(this.immediateTimer);
    this.immediateTimer = undefined;
    this.immediate.clear();
    this.digest.clear();
  }

  /** Deliver one attention item directly, outside the event stream. */
  async notify(item: Attention): Promise<void> {
    await this.handle(item);
  }

  /** Flush the immediate coalescing window now. */
  async flushImmediate(): Promise<void> {
    if (this.immediateTimer) {
      clearTimeout(this.immediateTimer);
      this.immediateTimer = undefined;
    }
    if (this.immediate.size === 0) return;
    const groups = [...this.immediate.values()];
    this.immediate.clear();
    for (const items of groups) await this.deliver("immediate", items);
  }

  /** Flush the digest now. Tests and shutdown use this. */
  async flush(): Promise<void> {    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.digest.size === 0) return;
    if (isQuietHours(this.now(), this.routing.quietHours)) {
      this.scheduleFlush();
      return;
    }
    const items = [...this.digest.values()];
    this.digest.clear();
    await this.deliver("digest", items);
  }

  deliveries(limit = 50): NotificationDelivery[] {
    return [...this.store.getState().notificationDeliveries]
      .slice(-Math.max(0, limit))
      .reverse();
  }

  settings(): NotificationSettings {
    return {
      enabled: this.enabled,
      channels: this.channelViews(),
      routing: this.routing,
      subscriptions: this.subscriptions(),
      ...(this.applicationServerKey
        ? { applicationServerKey: this.applicationServerKey }
        : {}),
    };
  }

  subscriptions(): PushSubscription[] {
    return Object.values(
      this.store.getState().notificationSubscriptions,
    ).map(toPublicSubscription);
  }

  async addSubscription(input: PushSubscriptionInput): Promise<PushSubscription> {
    const at = this.now();
    let stored!: NotificationSubscriptionState;

    await this.store.update((state) => {
      const existing = Object.values(state.notificationSubscriptions).find(
        (subscription) => subscription.endpoint === input.endpoint,
      );
      const id = existing?.id ?? randomUUID();
      stored = {
        id,
        deviceID: input.deviceID,
        ...(input.label ? { label: input.label } : {}),
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        createdAt: existing?.createdAt ?? at,
        lastSeenAt: at,
        ...(input.expirationTime !== undefined
          ? { expirationTime: input.expirationTime }
          : {}),
      };
      state.notificationSubscriptions[id] = stored;
    });

    return toPublicSubscription(stored);
  }

  async removeSubscription(id: string): Promise<boolean> {
    let removed = false;
    await this.store.update((state) => {
      if (state.notificationSubscriptions[id]) {
        delete state.notificationSubscriptions[id];
        removed = true;
      }
    });
    return removed;
  }

  async updateSettings(
    input: NotificationSettingsInput,
  ): Promise<NotificationSettings> {
    await this.store.update((state) => {
      if (input.enabled !== undefined) {
        state.notificationOverrides.enabled = input.enabled;
      }
      if (input.routing) {
        const current = state.notificationOverrides.routing ?? this.config.routing;
        try {
          state.notificationOverrides.routing = zNotificationRouting.parse({
            ...current,
            ...input.routing,
            quietHours: {
              ...current.quietHours,
              ...(input.routing.quietHours ?? {}),
            },
          });
        } catch (error) {
          throw badRequest("Invalid notification routing", {
            issues: (error as { issues?: unknown }).issues,
          });
        }
      }
    });
    return this.settings();
  }

  private channelViews(): NotificationChannelView[] {
    // Web Push is the only channel. It is available as soon as the hub has a
    // VAPID key; a browser subscription is the registration.
    return [
      {
        kind: "webpush",
        enabled: this.enabled,
        configured: Boolean(this.applicationServerKey),
      },
    ];
  }

  /** Await every handler queued so far. Tests and shutdown use this. */
  async whenIdle(): Promise<void> {
    await this.work;
  }

  /**
   * Send a synthetic notification through every supported channel. This is the
   * settings-screen test button; it works even while notifications are off.
   */
  async test(): Promise<{ attempted: number; delivered: number; failed: number }> {
    const channels = this.activeChannels();
    const item: Attention = {
      id: `test-${randomUUID()}`,
      sessionRef: "oktoso:test",
      type: "permission",
      priority: "normal",
      title: "Test notification",
      summary: "If you can read this, notifications work.",
      createdAt: this.now(),
      actions: [],
    };

    let delivered = 0;
    for (const channel of channels) {
      if (await this.sendWithRetry(buildPayload("immediate", [item], channel))) {
        delivered += 1;
      }
    }

    return {
      attempted: channels.length,
      delivered,
      failed: channels.length - delivered,
    };
  }

  private async handle(item: Attention): Promise<void> {
    if (!this.enabled) return;
    if (this.seen.has(item.id)) return;
    this.seen.set(item.id, this.now());
    this.pruneSeen();

    const routing = this.routing;
    const quiet = isQuietHours(this.now(), routing.quietHours);

    if (routing.immediate.includes(item.type)) {
      // Blocking work always wakes the device; everything else respects quiet
      // hours and joins the digest.
      if (quiet && item.priority !== "blocking") {
        this.digest.set(item.id, item);
        this.scheduleFlush();
        return;
      }
      const key = `${item.sessionRef}:${item.type}`;
      const group = this.immediate.get(key);
      if (group) group.push(item);
      else this.immediate.set(key, [item]);
      this.scheduleImmediate();
      return;
    }

    if (routing.digest.includes(item.type)) {
      this.digest.set(item.id, item);
      this.scheduleFlush();
    }
  }

  private forget(attentionID: string): void {
    this.digest.delete(attentionID);
    this.seen.delete(attentionID);
  }

  private scheduleImmediate(): void {
    if (this.immediateTimer) return;
    this.immediateTimer = setTimeout(() => {
      this.immediateTimer = undefined;
      void this.flushImmediate().catch((error) => {
        this.logger.error("Immediate notification flush failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.coalesceWindowMs);
    this.immediateTimer.unref?.();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    const routing = this.routing;
    const quiet = isQuietHours(this.now(), routing.quietHours);
    const delay = quiet
      ? Math.max(routing.digestWindowMs, msUntilQuietHoursEnd(this.now(), routing.quietHours))
      : routing.digestWindowMs;

    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error) => {
        this.logger.error("Digest flush failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, delay);
    this.timer.unref?.();
  }

  private async deliver(
    kind: "immediate" | "digest",
    items: Attention[],
  ): Promise<void> {
    if (items.length === 0) return;
    const channels = this.activeChannels();
    for (const channel of channels) {
      const payload = buildPayload(kind, items, channel);
      await this.sendWithRetry(payload);
    }
  }

  private activeChannels(): NotificationChannelKind[] {
    // Web Push needs no channel config, only a subscription.
    return (["webpush"] as NotificationChannelKind[]).filter((kind) =>
      this.transport.supports(kind),
    );
  }

  private async sendWithRetry(payload: NotificationPayload): Promise<boolean> {
    const maxAttempts = this.config.maxAttempts;
    const record: NotificationDelivery = {
      id: payload.id,
      channel: payload.channel,
      attentionID: payload.attention.id,
      sessionRef: payload.attention.sessionRef,
      status: "queued",
      attempts: 0,
      createdAt: this.now(),
    };

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.transport.send(payload);
        record.status = "sent";
        record.attempts = attempt;
        record.sentAt = this.now();
        await this.record(record);
        return true;
      } catch (error) {
        record.attempts = attempt;
        record.error = redactError(error);
        if (attempt < maxAttempts) {
          await sleep(this.retryDelayMs * 2 ** (attempt - 1));
        }
      }
    }

    record.status = "failed";
    await this.record(record);
    this.logger.warn("Notification delivery failed", {
      channel: payload.channel,
      attentionID: payload.attention.id,
      attempts: record.attempts,
      error: record.error,
    });
    return false;
  }

  private async record(record: NotificationDelivery): Promise<void> {
    await this.store.update((state) => {
      state.notificationDeliveries.push(record);
      const overflow = state.notificationDeliveries.length - this.maxDeliveries;
      if (overflow > 0) state.notificationDeliveries.splice(0, overflow);
    });
  }

  private pruneSeen(): void {
    const cutoff = this.now() - SEEN_TTL_MS;
    for (const [id, at] of this.seen) {
      if (at < cutoff) this.seen.delete(id);
    }
    while (this.seen.size > MAX_SEEN) {
      const oldest = this.seen.keys().next();
      if (oldest.done) break;
      this.seen.delete(oldest.value);
    }
  }
}

function toPublicSubscription(
  subscription: NotificationSubscriptionState,
): PushSubscription {
  return {
    id: subscription.id,
    deviceID: subscription.deviceID,
    ...(subscription.label ? { label: subscription.label } : {}),
    createdAt: subscription.createdAt,
    lastSeenAt: subscription.lastSeenAt,
    ...(subscription.expirationTime !== undefined
      ? { expirationTime: subscription.expirationTime }
      : {}),
  };
}

export function buildPayload(
  kind: "immediate" | "digest",
  items: Attention[],
  channel: NotificationChannelKind,
): NotificationPayload {
  const primary = items[items.length - 1]!;
  const count = items.length;
  const sessionCount = new Set(items.map((item) => item.sessionRef)).size;

  return {
    id: randomUUID(),
    kind,
    channel,
    attention: primary,
    count,
    sessionCount,
    title:
      kind === "digest"
        ? `${count} items need attention`
        : truncate(primary.title, MAX_TITLE_CHARS),
    body:
      kind === "digest"
        ? `${count} item${count === 1 ? "" : "s"} from ${sessionCount} session${sessionCount === 1 ? "" : "s"}`
        : truncate(primary.summary, MAX_BODY_CHARS),
    url: attentionDeepLink(primary),
    tag:
      kind === "digest"
        ? "oktoso-digest"
        : `${primary.sessionRef}:${primary.type}`,
  };
}

const MAX_TITLE_CHARS = 80;
const MAX_BODY_CHARS = 240;

/** Keep push payloads inside the service-worker and APNs size limits. */
function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function attentionDeepLink(item: Attention): string {
  return `/sessions/${encodeURIComponent(item.sessionRef)}?attention=${encodeURIComponent(item.id)}`;
}

/** True when `now` falls inside the configured quiet window. */
export function isQuietHours(now: number, quiet: QuietHours): boolean {
  if (!quiet.enabled) return false;
  const current = localMinutes(now, quiet.timezone);
  const start = clockMinutes(quiet.start);
  const end = clockMinutes(quiet.end);
  if (start === end) return false;
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

/** Milliseconds until the quiet window ends. */
export function msUntilQuietHoursEnd(now: number, quiet: QuietHours): number {
  const current = localMinutes(now, quiet.timezone);
  const end = clockMinutes(quiet.end);
  const delta = (end - current + 1_440) % 1_440;
  return (delta === 0 ? 1_440 : delta) * 60_000;
}

function localMinutes(now: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(now));
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(
    parts.find((part) => part.type === "minute")?.value ?? "0",
  );
  return (hour % 24) * 60 + minute;
}

function clockMinutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function redactError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Keep the delivery log bounded and free of payload scraps.
  return message.replace(/\s+/g, " ").trim().slice(0, 200);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
