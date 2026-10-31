import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "@amoshydra/oktoso-contracts";
import { OpenCodeAdapter, type ProviderEvent } from "@amoshydra/oktoso-providers";
import {
  createFakeProviderServer,
  type FakeProviderServer,
} from "@amoshydra/oktoso-testing";

const servers: FakeProviderServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("OpenCode live events", () => {
  it("normalizes message and part events into message snapshots", async () => {
    const fake = await createFakeProviderServer({ kind: "opencode", port: 0 });
    servers.push(fake);
    const adapter = new OpenCodeAdapter({
      id: "fake-opencode",
      baseUrl: fake.url,
      password: "secret",
    });

    const events: ProviderEvent[] = [];
    const controller = new AbortController();
    const unsubscribe = await adapter.subscribe(
      (event) => events.push(event),
      controller.signal,
    );
    await wait(100);

    const response = await fetch(`${fake.url}/api/session/ses_auth/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "stream this" }),
    });
    expect(response.status).toBe(200);

    await waitFor(() =>
      events.some(
        (event) =>
          event.type === "message.created" || event.type === "message.updated",
      ),
    );
    await wait(150);

    const messages = events
      .filter(
        (event) =>
          event.type === "message.created" || event.type === "message.updated",
      )
      .map((event) => (event.data as { message: Message }).message);
    const assistant = messages.findLast((message) => message.role === "assistant");

    expect(assistant).toBeDefined();
    expect(assistant?.parts).toContainEqual({
      type: "text",
      text: "Fake reply: stream this",
    });
    expect(assistant?.streaming).not.toBe(true);
    expect(assistant?.completedAt).toBeDefined();
    expect(events.some((event) => event.type === "session.updated")).toBe(true);

    unsubscribe();
    controller.abort();
  });
});

async function waitFor(check: () => boolean, timeoutMs = 1_500): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await wait(20);
  }
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
