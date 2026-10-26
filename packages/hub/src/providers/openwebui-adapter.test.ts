import { afterEach, describe, expect, it } from "vitest";
import { createFakeProviderServer, type FakeProviderServer } from "@agent-hub/testing";
import { OpenWebUIAdapter } from "@agent-hub/providers";

const servers: FakeProviderServer[] = [];

async function createAdapter() {
  const fake = await createFakeProviderServer({ kind: "openwebui", port: 0 });
  servers.push(fake);
  return {
    fake,
    adapter: new OpenWebUIAdapter({
      id: "openwebui",
      baseUrl: fake.url,
      token: "fake-key",
    }),
  };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("OpenWebUIAdapter", () => {
  it("reads chats, current branches, and failed sessions", async () => {
    const { adapter } = await createAdapter();
    const page = await adapter.listSessions(
      { limit: 200 },
      AbortSignal.timeout(5_000),
    );

    expect(page.data.some((session) => session.nativeID === "chat_fake_openwebui")).toBe(true);
    expect(page.data.some((session) => session.status === "error")).toBe(true);
    expect(page.data.every((session) => session.providerID === "openwebui")).toBe(true);

    const messages = await adapter.getMessages(
      "openwebui:chat_fake_openwebui",
      { limit: 100, order: "asc" },
      AbortSignal.timeout(5_000),
    );
    expect(messages.data.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(messages.data[1]?.parts[0]).toMatchObject({
      type: "text",
      text: "Fake Open WebUI reply.",
    });
  });

  it("creates a chat and completes a prompt", async () => {
    const { fake, adapter } = await createAdapter();
    const created = await adapter.createSession(
      { providerID: "openwebui", title: "Adapter send smoke" },
      AbortSignal.timeout(5_000),
    );
    expect(created.title).toBe("Adapter send smoke");

    const result = await adapter.sendMessage(
      created.ref,
      { text: "Reply with exactly OK." },
      AbortSignal.timeout(10_000),
    );
    expect(result.accepted).toBe(true);
    expect(result.messageID).toBeTruthy();

    const messages = await adapter.getMessages(
      created.ref,
      { limit: 100, order: "asc" },
      AbortSignal.timeout(5_000),
    );
    expect(messages.data.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(messages.data[1]?.streaming).not.toBe(true);
    expect(messages.data[1]?.parts[0]?.type).toBe("text");

    const second = await adapter.sendMessage(
      created.ref,
      { text: "And again." },
      AbortSignal.timeout(10_000),
    );
    expect(second.accepted).toBe(true);

    const followed = await adapter.getMessages(
      created.ref,
      { limit: 100, order: "asc" },
      AbortSignal.timeout(5_000),
    );
    expect(followed.data.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);

    await fetch(`${fake.url}/api/v1/chats/${encodeURIComponent(created.nativeID)}`, {
      method: "DELETE",
    });
  });

  it("lists models as options", async () => {
    const { adapter } = await createAdapter();
    const options = await adapter.getOptions(AbortSignal.timeout(5_000));
    expect(options.models).toEqual([{ id: "fake-model", label: "Fake Model" }]);
    expect(options.agents).toEqual([]);
  });
});
