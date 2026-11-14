import { describe, expect, it } from "vitest";
import type { Attention } from "@amoshydra/oktoso-contracts";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { createLogger } from "../lib/logger";
import { buildPayload } from "./notification-service";
import {
  WebPushTransport,
  type PushSender,
  type PushSubscriptionTarget,
} from "./web-push-transport";

const now = Date.UTC(2026, 10, 14, 12, 0, 0);
const logger = createLogger({ level: "silent" });

function attention(): Attention {
  return {
    id: "att-1",
    sessionRef: "desktop-opencode:ses_main",
    type: "permission",
    priority: "blocking",
    title: "Approve the shell command",
    summary: "rm -rf build",
    createdAt: now,
    actions: [],
  };
}

type Call = {
  subscription: PushSubscriptionTarget;
  body: string;
  options: { ttlSeconds: number; urgency: "high" | "normal" };
};

class FakeSender implements PushSender {
  readonly calls: Call[] = [];
  readonly failures = new Map<string, unknown>();

  async send(
    subscription: PushSubscriptionTarget,
    body: string,
    options: Call["options"],
  ): Promise<void> {
    const failure = this.failures.get(subscription.endpoint);
    if (failure) throw failure;
    this.calls.push({ subscription, body, options });
  }
}

async function storeWith(endpoints: string[]) {
  const store = new MemoryStateStore();
  await store.update((state) => {
    endpoints.forEach((endpoint, index) => {
      state.notificationSubscriptions[`sub-${index}`] = {
        id: `sub-${index}`,
        deviceID: `device-${index}`,
        endpoint,
        p256dh: `p256dh-${index}`,
        auth: `auth-${index}`,
        createdAt: now,
        lastSeenAt: now,
      };
    });
  });
  return store;
}

function transport(store: MemoryStateStore, sender: FakeSender) {
  return new WebPushTransport({
    store,
    logger,
    vapid: {
      subject: "mailto:test@example.com",
      publicKey: "public-key",
      privateKey: "private-key",
    },
    sender,
  });
}

describe("WebPushTransport", () => {
  it("supports webpush only while a subscription exists", async () => {
    const empty = new MemoryStateStore();
    expect(transport(empty, new FakeSender()).supports("webpush")).toBe(false);

    const store = await storeWith(["https://push.example.com/one"]);
    const push = transport(store, new FakeSender());

    expect(push.supports("webpush")).toBe(true);
    expect(push.supports("ntfy")).toBe(false);
  });

  it("sends the payload to every subscription", async () => {
    const store = await storeWith([
      "https://push.example.com/one",
      "https://push.example.com/two",
    ]);
    const sender = new FakeSender();
    const push = transport(store, sender);

    await push.send(buildPayload("immediate", [attention()], "webpush"));

    expect(sender.calls).toHaveLength(2);
    expect(sender.calls[0]?.options).toEqual({
      ttlSeconds: 3_600,
      urgency: "high",
    });
    expect(JSON.parse(sender.calls[0]!.body)).toMatchObject({
      title: "Approve the shell command",
      tag: "desktop-opencode:ses_main:permission",
      url: "/sessions/desktop-opencode%3Ases_main?attention=att-1",
      attentionID: "att-1",
      type: "permission",
    });
  });

  it("removes a subscription the push service reports gone", async () => {
    const store = await storeWith([
      "https://push.example.com/gone",
      "https://push.example.com/live",
    ]);
    const sender = new FakeSender();
    sender.failures.set("https://push.example.com/gone", {
      statusCode: 410,
      message: "Gone",
    });
    const push = transport(store, sender);

    await push.send(buildPayload("immediate", [attention()], "webpush"));

    expect(sender.calls).toHaveLength(1);
    expect(Object.keys(store.getState().notificationSubscriptions)).toEqual([
      "sub-1",
    ]);
  });

  it("throws when every delivery fails", async () => {
    const store = await storeWith(["https://push.example.com/down"]);
    const sender = new FakeSender();
    sender.failures.set("https://push.example.com/down", {
      statusCode: 503,
      message: "Unavailable",
    });
    const push = transport(store, sender);

    await expect(
      push.send(buildPayload("immediate", [attention()], "webpush")),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(Object.keys(store.getState().notificationSubscriptions)).toHaveLength(
      1,
    );
  });

  it("marks digest payloads as normal urgency", async () => {
    const store = await storeWith(["https://push.example.com/one"]);
    const sender = new FakeSender();
    const push = transport(store, sender);

    await push.send(buildPayload("digest", [attention()], "webpush"));

    expect(sender.calls[0]?.options.urgency).toBe("normal");
  });
});
