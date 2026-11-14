import { describe, expect, it } from "vitest";
import {
  DEFAULT_NOTIFICATION_ROUTING,
  type Attention,
  type NotificationChannelKind,
  type NotificationRouting,
} from "@amoshydra/oktoso-contracts";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import type { NotificationConfig } from "../config/schema";
import { createLogger } from "../lib/logger";
import { EventBus } from "./event-bus";
import {
  NotificationService,
  buildPayload,
  isQuietHours,
  msUntilQuietHoursEnd,
  type NotificationPayload,
  type NotificationTransport,
} from "./notification-service";

const now = Date.UTC(2026, 10, 14, 12, 0, 0);
const logger = createLogger({ level: "silent" });

function attention(
  id: string,
  type: Attention["type"],
  overrides: Partial<Attention> = {},
): Attention {
  return {
    id,
    sessionRef: "desktop-opencode:ses_main",
    type,
    priority: type === "unread" ? "normal" : "blocking",
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    createdAt: now,
    actions: [],
    ...overrides,
  };
}

class RecordingTransport implements NotificationTransport {
  readonly payloads: NotificationPayload[] = [];
  readonly channels = new Set<NotificationChannelKind>(["webpush"]);
  failures = 0;

  supports(channel: NotificationChannelKind): boolean {
    return this.channels.has(channel);
  }

  async send(payload: NotificationPayload): Promise<void> {
    if (this.failures > 0) {
      this.failures -= 1;
      throw new Error("transport down");
    }
    this.payloads.push(payload);
  }
}

function makeConfig(
  overrides: Partial<NotificationConfig> = {},
): NotificationConfig {
  return {
    enabled: true,
    channels: [],
    routing: DEFAULT_NOTIFICATION_ROUTING,
    vapid: { subject: "mailto:test@example.com" },
    maxAttempts: 3,
    ...overrides,
  };
}

async function setup(
  options: {
    config?: Partial<NotificationConfig>;
    now?: number;
    clock?: { now: number };
    transport?: RecordingTransport;
  } = {},
) {
  const clock = options.clock ?? { now: options.now ?? now };
  const store = new MemoryStateStore();
  const bus = new EventBus(store, logger, { now: () => clock.now });
  await bus.init();
  const transport = options.transport ?? new RecordingTransport();
  const service = new NotificationService({
    config: makeConfig(options.config),
    store,
    eventBus: bus,
    logger,
    transport,
    now: () => clock.now,
    retryDelayMs: 0,
  });
  service.start();
  return { store, bus, transport, service };
}

async function publish(bus: EventBus, item: Attention): Promise<void> {
  await bus.publish("attention.created", item, {
    sessionRef: item.sessionRef,
    attentionID: item.id,
  });
}

describe("NotificationService", () => {
  it("delivers a blocking permission once", async () => {
    const { bus, transport, service } = await setup();
    const item = attention("att-1", "permission");

    await publish(bus, item);
    await service.whenIdle();
    await service.flushImmediate();

    expect(transport.payloads).toHaveLength(1);
    expect(transport.payloads[0]).toMatchObject({
      kind: "immediate",
      channel: "webpush",
      title: "Title att-1",
      body: "Summary att-1",
      count: 1,
      url: `/sessions/${encodeURIComponent(item.sessionRef)}?attention=att-1`,
    });
    expect(service.deliveries()[0]).toMatchObject({
      status: "sent",
      attempts: 1,
      attentionID: "att-1",
    });
  });

  it("bounds the push title and body", () => {
    const payload = buildPayload(
      "immediate",
      [
        attention("long", "permission", {
          title: "T".repeat(200),
          summary: "S".repeat(600),
        }),
      ],
      "webpush",
    );

    expect(payload.title.length).toBeLessThanOrEqual(80);
    expect(payload.title.endsWith("…")).toBe(true);
    expect(payload.body.length).toBeLessThanOrEqual(240);
    expect(payload.body.endsWith("…")).toBe(true);
  });

  it("dedupes repeated created events for the same item", async () => {
    const { bus, transport, service } = await setup();
    const item = attention("att-1", "permission");

    for (let index = 0; index < 4; index++) await publish(bus, item);
    await service.whenIdle();
    await service.flushImmediate();

    expect(transport.payloads).toHaveLength(1);
  });

  it("coalesces distinct immediate items from one session", async () => {
    const { bus, transport, service } = await setup();

    await publish(bus, attention("a", "permission"));
    await publish(bus, attention("b", "permission"));
    await publish(bus, attention("c", "permission"));
    await service.whenIdle();
    await service.flushImmediate();

    expect(transport.payloads).toHaveLength(1);
    expect(transport.payloads[0]).toMatchObject({
      kind: "immediate",
      count: 3,
      sessionCount: 1,
    });
  });

  it("holds digest types and sends one combined payload", async () => {
    const { bus, transport, service } = await setup();

    await publish(bus, attention("q-1", "question", { priority: "normal" }));
    await publish(
      bus,
      attention("q-2", "question", {
        priority: "normal",
        sessionRef: "desktop-opencode:ses_other",
      }),
    );
    await service.whenIdle();

    expect(transport.payloads).toHaveLength(0);

    await service.flush();

    expect(transport.payloads).toHaveLength(1);
    expect(transport.payloads[0]).toMatchObject({
      kind: "digest",
      count: 2,
      sessionCount: 2,
      tag: "oktoso-digest",
    });
  });

  it("sends the digest after quiet hours end", async () => {
    const clock = { now: Date.UTC(2026, 10, 14, 23, 30) };
    const quietRouting: NotificationRouting = {
      ...DEFAULT_NOTIFICATION_ROUTING,
      quietHours: {
        enabled: true,
        start: "22:00",
        end: "07:00",
        timezone: "UTC",
      },
    };
    const { bus, transport, service } = await setup({
      config: { routing: quietRouting },
      clock,
    });

    await publish(bus, attention("q-1", "question", { priority: "normal" }));
    await service.whenIdle();
    expect(transport.payloads).toHaveLength(0);

    clock.now = Date.UTC(2026, 10, 15, 7, 30);
    await service.flush();

    expect(transport.payloads).toHaveLength(1);
    expect(transport.payloads[0]?.kind).toBe("digest");
    service.stop();
  });

  it("does not notify for an item resolved before the digest flushes", async () => {
    const { bus, transport, service } = await setup();
    const item = attention("q-1", "question", { priority: "normal" });

    await publish(bus, item);
    await bus.publish("attention.resolved", item, {
      sessionRef: item.sessionRef,
      attentionID: item.id,
    });
    await service.whenIdle();
    await service.flush();

    expect(transport.payloads).toHaveLength(0);
  });

  it("retries a failing transport and records the attempts", async () => {
    const { bus, transport, service } = await setup();
    transport.failures = 2;

    await publish(bus, attention("att-1", "permission"));
    await service.whenIdle();
    await service.flushImmediate();

    expect(transport.payloads).toHaveLength(1);
    expect(service.deliveries()[0]).toMatchObject({
      status: "sent",
      attempts: 3,
    });
  });

  it("records a failure after the configured attempts", async () => {
    const { bus, transport, service } = await setup({
      config: { maxAttempts: 2 },
    });
    transport.failures = 5;

    await publish(bus, attention("att-1", "permission"));
    await service.whenIdle();
    await service.flushImmediate();

    expect(transport.payloads).toHaveLength(0);
    expect(service.deliveries()[0]).toMatchObject({
      status: "failed",
      attempts: 2,
      error: "transport down",
    });
  });

  it("sends a synthetic test notification", async () => {
    const { transport, service } = await setup();

    const result = await service.test();

    expect(result).toEqual({ attempted: 1, delivered: 1, failed: 0 });
    expect(transport.payloads[0]).toMatchObject({
      kind: "immediate",
      title: "Test notification",
    });
  });

  it("does nothing while disabled", async () => {    const { bus, transport, service } = await setup({
      config: { enabled: false },
    });

    await publish(bus, attention("att-1", "permission"));
    await service.whenIdle();

    expect(transport.payloads).toHaveLength(0);
    expect(service.deliveries()).toHaveLength(0);
  });

  it("honours a stored enable override", async () => {
    const { store, bus, transport, service } = await setup();
    await store.update((state) => {
      state.notificationOverrides.enabled = false;
    });

    await publish(bus, attention("att-1", "permission"));
    await service.whenIdle();

    expect(transport.payloads).toHaveLength(0);
  });

  it("upserts a subscription by endpoint and hides transport secrets", async () => {
    const { service } = await setup();
    const input = {
      deviceID: "phone-1",
      label: "Pixel",
      endpoint: "https://push.example.com/one",
      keys: { p256dh: "public-key", auth: "auth-secret" },
    };

    const first = await service.addSubscription(input);
    const second = await service.addSubscription({
      ...input,
      label: "Pixel (updated)",
    });

    expect(second.id).toBe(first.id);
    expect(service.subscriptions()).toHaveLength(1);
    expect(service.subscriptions()[0]).toMatchObject({
      deviceID: "phone-1",
      label: "Pixel (updated)",
    });
    expect(service.subscriptions()[0]).not.toHaveProperty("endpoint");
    expect(service.subscriptions()[0]).not.toHaveProperty("p256dh");
    expect(service.subscriptions()[0]).not.toHaveProperty("auth");
    expect(service.settings().subscriptions).toHaveLength(1);
  });

  it("removes a subscription once", async () => {
    const { service } = await setup();
    const created = await service.addSubscription({
      deviceID: "phone-1",
      endpoint: "https://push.example.com/one",
      keys: { p256dh: "public-key", auth: "auth-secret" },
    });

    expect(await service.removeSubscription(created.id)).toBe(true);
    expect(await service.removeSubscription(created.id)).toBe(false);
    expect(service.subscriptions()).toHaveLength(0);
  });

  it("persists settings overrides", async () => {
    const { service } = await setup();

    const settings = await service.updateSettings({
      enabled: true,
      routing: { quietHours: { enabled: true, start: "23:00", end: "06:00" } },
    });

    expect(settings.enabled).toBe(true);
    expect(settings.routing.quietHours).toMatchObject({
      enabled: true,
      start: "23:00",
      end: "06:00",
    });
    expect(service.settings().enabled).toBe(true);
  });
});

describe("quiet hours", () => {
  const quiet = {
    enabled: true,
    start: "22:00",
    end: "07:00",
    timezone: "UTC",
  } as const;

  it("detects a window across midnight", () => {
    expect(isQuietHours(Date.UTC(2026, 10, 14, 23, 30), quiet)).toBe(true);
    expect(isQuietHours(Date.UTC(2026, 10, 14, 6, 30), quiet)).toBe(true);
    expect(isQuietHours(Date.UTC(2026, 10, 14, 12, 0), quiet)).toBe(false);
    expect(isQuietHours(Date.UTC(2026, 10, 14, 7, 0), quiet)).toBe(false);
  });

  it("computes the time until the window ends", () => {
    expect(msUntilQuietHoursEnd(Date.UTC(2026, 10, 14, 6, 0), quiet)).toBe(
      60 * 60_000,
    );
    expect(msUntilQuietHoursEnd(Date.UTC(2026, 10, 14, 23, 0), quiet)).toBe(
      8 * 60 * 60_000,
    );
  });

  it("holds non-blocking work but lets blocking work through", async () => {
    const quietRouting: NotificationRouting = {
      ...DEFAULT_NOTIFICATION_ROUTING,
      quietHours: quiet,
    };
    const { bus, transport, service } = await setup({
      config: { routing: quietRouting },
      now: Date.UTC(2026, 10, 14, 23, 30),
    });

    await publish(
      bus,
      attention("permission-normal", "permission", { priority: "normal" }),
    );
    await publish(bus, attention("permission-blocking", "permission"));
    await service.whenIdle();
    await service.flushImmediate();
    await service.flush();

    expect(transport.payloads).toHaveLength(1);
    expect(transport.payloads[0]?.attention.id).toBe("permission-blocking");
    service.stop();
  });
});
