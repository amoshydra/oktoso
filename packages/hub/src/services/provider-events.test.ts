import { afterEach, describe, expect, it } from "vitest";
import type { HubEvent, Message } from "@agent-hub/contracts";
import { OpenCodeAdapter, type ProviderAdapter, type ProviderEvent } from "@agent-hub/providers";
import { MemoryStateStore } from "@agent-hub/storage";
import {
  createFakeProviderServer,
  type FakeProviderServer,
} from "@agent-hub/testing";
import { createLogger } from "../lib/logger";
import { EventBus } from "./event-bus";
import type { ProviderRegistry } from "./provider-registry";
import type { SessionService } from "./session-service";
import { ProviderEventService } from "./provider-events";

const logger = createLogger({ level: "silent" });
const servers: FakeProviderServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("ProviderEventService", () => {
  it("forwards message snapshots and coalesces rapid updates", async () => {
    const store = new MemoryStateStore();
    const bus = new EventBus(store, logger);
    await bus.init();

    let emit: ((event: ProviderEvent) => void) | undefined;
    const adapter = {
      id: "fake",
      subscribe: async (onEvent: (event: ProviderEvent) => void) => {
        emit = onEvent;
        return () => undefined;
      },
    } as unknown as ProviderAdapter;
    const registry = {
      adapters: () => [adapter],
    } as unknown as ProviderRegistry;
    const sessions = {
      invalidate: () => undefined,
    } as unknown as SessionService;

    const service = new ProviderEventService(
      registry,
      bus,
      sessions,
      logger,
      undefined,
      10,
      15,
    );
    await service.start();

    emit!({
      type: "message.created",
      sessionRef: "fake:ses_1",
      data: { message: message("partial") },
      at: 1,
    });
    emit!({
      type: "message.updated",
      sessionRef: "fake:ses_1",
      data: { message: message("complete") },
      at: 2,
    });
    await wait(40);

    const messageEvents = bus
      .replay(0)
      .events.filter(
        (event) =>
          event.type === "message.created" || event.type === "message.updated",
      );
    expect(messageEvents).toHaveLength(1);
    expect(messageEvents[0]?.data).toMatchObject({
      message: {
        id: "msg_1",
        parts: [{ type: "text", text: "complete" }],
      },
    });
    expect(
      bus.replay(0).events.some((event) => event.type === "session.updated"),
    ).toBe(false);

    emit!({
      type: "session.updated",
      sessionRef: "fake:ses_1",
      data: { eventType: "session.idle" },
      at: 3,
    });
    await wait(30);
    expect(
      bus
        .replay(0)
        .events.some(
          (event) =>
            event.type === "session.updated" &&
            event.sessionRef === "fake:ses_1",
        ),
    ).toBe(true);

    service.stop();
  });

  it("forwards a live OpenCode message snapshot end to end", async () => {
    const fake = await createFakeProviderServer({ kind: "opencode", port: 0 });
    servers.push(fake);
    const store = new MemoryStateStore();
    const bus = new EventBus(store, logger);
    await bus.init();

    const adapter = new OpenCodeAdapter({
      id: "live",
      baseUrl: fake.url,
      password: "secret",
    });
    const registry = {
      adapters: () => [adapter],
    } as unknown as ProviderRegistry;
    const sessions = {
      invalidate: () => undefined,
    } as unknown as SessionService;
    const service = new ProviderEventService(
      registry,
      bus,
      sessions,
      logger,
      undefined,
      10,
      15,
    );
    await service.start();
    await wait(100);

    const received: HubEvent[] = [];
    const unsubscribe = bus.subscribe((event) => received.push(event));
    const response = await fetch(`${fake.url}/api/session/ses_auth/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "live streaming" }),
    });
    expect(response.status).toBe(200);

    await waitFor(() =>
      received.some(
        (event) =>
          (event.type === "message.created" || event.type === "message.updated") &&
          JSON.stringify(event.data).includes("Fake reply: live streaming"),
      ),
    );

    const event = received.findLast(
      (candidate) =>
        candidate.type === "message.created" ||
        candidate.type === "message.updated",
    );
    expect((event?.data as { message: Message }).message.parts).toContainEqual({
      type: "text",
      text: "Fake reply: live streaming",
    });

    unsubscribe();
    service.stop();
  });
});

function message(text: string): Message {
  return {
    id: "msg_1",
    sessionRef: "fake:ses_1",
    role: "assistant",
    parts: [{ type: "text", text }],
    createdAt: 1,
    streaming: true,
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await wait(20);
  }
}
