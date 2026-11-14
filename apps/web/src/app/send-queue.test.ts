import { beforeEach, describe, expect, it } from "vitest";
import { HubError, type HubClient } from "@amoshydra/oktoso-client";
import {
  enqueueSend,
  flushSendQueue,
  isOnline,
  listQueued,
  queueLength,
  queuedMessages,
  removeQueued,
  shouldQueue,
  subscribeQueueResults,
  type QueueResult,
} from "./send-queue";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function installBrowserGlobals(): void {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    configurable: true,
  });
  Object.defineProperty(globalThis, "window", {
    value: new EventTarget(),
    configurable: true,
  });
}

function item(key: string, overrides: Partial<Parameters<typeof enqueueSend>[0]> = {}) {
  return {
    id: `local:${key}`,
    sessionRef: "desktop-opencode:ses_auth",
    text: `message ${key}`,
    attachments: [],
    idempotencyKey: key,
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("send queue", () => {
  beforeEach(installBrowserGlobals);

  it("persists, dedupes, and filters by session", () => {
    enqueueSend(item("one"));
    enqueueSend(item("one"));
    enqueueSend(
      item("two", { sessionRef: "desktop-opencode:ses_other", text: "other" }),
    );

    expect(queueLength()).toBe(2);
    expect(listQueued("desktop-opencode:ses_auth")).toHaveLength(1);
    expect(listQueued("desktop-opencode:ses_auth")[0]?.text).toBe("message one");
  });

  it("hydrates queued rows as optimistic queued messages", () => {
    enqueueSend(
      item("one", {
        attachments: [
          {
            id: "att-1",
            name: "note.txt",
            mimeType: "text/plain",
            size: 4,
            createdAt: 1,
          },
        ],
      }),
    );
    enqueueSend(item("two"));

    const messages = queuedMessages("desktop-opencode:ses_auth");

    expect(messages.map((message) => message.id)).toEqual([
      "local:one",
      "local:two",
    ]);
    expect(messages[0]?.parts).toContainEqual({
      type: "file",
      name: "note.txt",
      mimeType: "text/plain",
    });
    expect(messages[0]?.metadata?.optimistic).toMatchObject({
      status: "queued",
      idempotencyKey: "one",
    });
  });

  it("removes a queued item once", () => {
    enqueueSend(item("one"));

    expect(removeQueued("one")).toBe(true);
    expect(removeQueued("one")).toBe(false);
    expect(queueLength()).toBe(0);
  });

  it("classifies retryable failures", () => {
    expect(shouldQueue(new HubError("network_error", "offline"))).toBe(true);
    expect(shouldQueue(new HubError("timeout", "slow"))).toBe(true);
    expect(
      shouldQueue(new HubError("http_error", "down", { status: 503, retryable: true })),
    ).toBe(false);
    expect(
      shouldQueue(new HubError("invalid_request", "bad", { status: 400 })),
    ).toBe(false);
  });

  it("is online when the runtime has no navigator.onLine", () => {
    expect(isOnline()).toBe(true);
  });

  it("sends queued items in order and clears them", async () => {
    enqueueSend(item("one", { createdAt: 100 }));
    enqueueSend(item("two", { createdAt: 200 }));

    const calls: Array<{ ref: string; text: string; key?: string }> = [];
    const client = {
      async sendMessage(
        ref: string,
        input: { text: string },
        options?: { idempotencyKey?: string },
      ) {
        calls.push({ ref, text: input.text, key: options?.idempotencyKey });
      },
    } as unknown as Pick<HubClient, "sendMessage">;

    await flushSendQueue(client);

    expect(calls.map((call) => call.key)).toEqual(["one", "two"]);
    expect(queueLength()).toBe(0);
  });

  it("keeps a retryable failure and stops the run", async () => {
    enqueueSend(item("one", { createdAt: 100 }));
    enqueueSend(item("two", { createdAt: 200 }));

    const client = {
      async sendMessage() {
        throw new HubError("network_error", "offline");
      },
    } as unknown as Pick<HubClient, "sendMessage">;

    await flushSendQueue(client);

    expect(queueLength()).toBe(2);
  });

  it("drops a terminal failure, reports it, and continues", async () => {
    enqueueSend(item("bad", { createdAt: 100 }));
    enqueueSend(item("good", { createdAt: 200 }));

    const results: QueueResult[] = [];
    const unsubscribe = subscribeQueueResults((result) => results.push(result));
    const calls: string[] = [];
    const client = {
      async sendMessage(
        _ref: string,
        _input: unknown,
        options?: { idempotencyKey?: string },
      ) {
        const key = options?.idempotencyKey ?? "";
        calls.push(key);
        if (key === "bad") {
          throw new HubError("invalid_request", "Bad request", { status: 400 });
        }
      },
    } as unknown as Pick<HubClient, "sendMessage">;

    await flushSendQueue(client);
    unsubscribe();

    expect(calls).toEqual(["bad", "good"]);
    expect(queueLength()).toBe(0);
    expect(results).toEqual([
      { idempotencyKey: "bad", status: "failed", error: "Bad request" },
      { idempotencyKey: "good", status: "sent" },
    ]);
  });
});
