import { afterEach, describe, expect, it } from "vitest";
import { createFakeProviderServer, type FakeProviderServer } from "@amoshydra/oktoso-testing";
import { OpenWebUIAdapter } from "@amoshydra/oktoso-providers";

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

  it("maps Open WebUI folders to project names", async () => {
    const { adapter } = await createAdapter();
    const page = await adapter.listSessions(
      { limit: 200 },
      AbortSignal.timeout(5_000),
    );

    expect(
      page.data.find((session) => session.nativeID === "chat_fake_openwebui")
        ?.project,
    ).toBe("Research");
    expect(
      page.data.find((session) => session.nativeID === "chat_fake_branches")
        ?.project,
    ).toBe("Research / Deep Research");
  });

  it("uploads attachments and sends file references", async () => {
    const { fake, adapter } = await createAdapter();
    expect(adapter.capabilities.attach).toBe(true);
    const created = await adapter.createSession(
      { providerID: "openwebui", title: "Attachment smoke" },
      AbortSignal.timeout(5_000),
    );

    const result = await adapter.sendMessage(
      created.ref,
      {
        text: "Read the attachment.",
        files: [
          {
            name: "notes.txt",
            mimeType: "text/plain",
            data: new Uint8Array([104, 105]),
          },
        ],
      },
      AbortSignal.timeout(10_000),
    );
    expect(result.accepted).toBe(true);

    const messages = await adapter.getMessages(
      created.ref,
      { limit: 100, order: "asc" },
      AbortSignal.timeout(5_000),
    );
    const user = messages.data.find((message) => message.role === "user");
    expect(user?.parts).toEqual(
      expect.arrayContaining([
        { type: "file", name: "notes.txt", mimeType: "text/plain" },
      ]),
    );

    await fetch(`${fake.url}/api/v1/chats/${encodeURIComponent(created.nativeID)}`, {
      method: "DELETE",
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

  it("lists and switches in-chat branches", async () => {
    const { adapter } = await createAdapter();
    const ref = "openwebui:chat_fake_branches";
    const signal = AbortSignal.timeout(5_000);

    const initial = await adapter.listBranches(ref, signal);
    expect(initial).toEqual([
      {
        messageId: "branch-assistant-2",
        parentId: "branch-user",
        role: "assistant",
        siblingIds: ["branch-assistant-1", "branch-assistant-2"],
        index: 1,
        count: 2,
      },
    ]);

    await adapter.switchBranch(ref, "branch-assistant-1", signal);
    const messages = await adapter.getMessages(ref, { limit: 100, order: "asc" }, signal);
    const ids = messages.data.map((message) => message.id);
    expect(ids).toContain("branch-answer-1");
    expect(ids).not.toContain("branch-answer-2");

    const after = await adapter.listBranches(ref, signal);
    expect(after).toMatchObject([
      {
        messageId: "branch-assistant-1",
        index: 0,
        count: 2,
      },
    ]);
  });

  it("retries an assistant message as a new sibling", async () => {
    const { adapter } = await createAdapter();
    const ref = "openwebui:chat_fake_branches";
    const signal = AbortSignal.timeout(10_000);

    const result = await adapter.retryMessage(
      ref,
      "branch-assistant-2",
      signal,
    );
    expect(result.accepted).toBe(true);
    expect(result.messageID).toBeTruthy();

    const branches = await adapter.listBranches(ref, signal);
    expect(branches).toMatchObject([
      {
        messageId: result.messageID,
        index: 2,
        count: 3,
      },
    ]);

    const messages = await adapter.getMessages(
      ref,
      { limit: 100, order: "asc" },
      signal,
    );
    expect(messages.data.at(-1)).toMatchObject({
      role: "assistant",
      parts: [{ type: "text", text: "Fake Open WebUI reply: Show me two alternatives." }],
    });
  });

  it("lists models as options", async () => {
    const { adapter } = await createAdapter();
    const options = await adapter.getOptions(AbortSignal.timeout(5_000));
    expect(options.models).toEqual([
      { id: "fake-model", label: "Fake Model" },
      { id: "fake-model-2", label: "Fake Model 2" },
    ]);
    expect(options.agents).toEqual([]);
  });

  it("switches the chat model", async () => {
    const { adapter } = await createAdapter();
    await adapter.setSessionOptions(
      "openwebui:chat_fake_openwebui",
      { model: "fake-model-2" },
      AbortSignal.timeout(5_000),
    );

    const session = await adapter.getSession(
      "openwebui:chat_fake_openwebui",
      AbortSignal.timeout(5_000),
    );
    expect(session.model).toBe("fake-model-2");
  });
});
