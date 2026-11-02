import { describe, expect, it, vi } from "vitest";
import type {
  AttentionPage,
  Provider,
  SessionPage,
} from "@amoshydra/oktoso-contracts";
import { withProviderPolicy } from "./policy";
import type { McpHubApi } from "./server";

const providers = [
  { id: "opencode", name: "opencode" },
  { id: "openwebui", name: "openwebui" },
] as unknown as Provider[];

const sessions = {
  data: [
    { ref: "opencode:ses_a", providerID: "opencode" },
    { ref: "openwebui:chat_b", providerID: "openwebui" },
  ],
} as unknown as SessionPage;

const attention = {
  data: [
    { id: "opencode:permission:ses_a:1", sessionRef: "opencode:ses_a" },
    { id: "openwebui:error:chat_b:1", sessionRef: "openwebui:chat_b" },
  ],
} as unknown as AttentionPage;

function createApi() {
  return {
    providers: vi.fn(async () => providers),
    checkProvider: vi.fn(async () => ({ status: "online" })),
    sessions: vi.fn(async () => sessions),
    session: vi.fn(async () => ({ ref: "opencode:ses_a" })),
    messages: vi.fn(async () => ({ data: [] })),
    question: vi.fn(async () => null),
    attention: vi.fn(async () => attention),
    sendMessage: vi.fn(async () => ({ id: "message-1" })),
    createSession: vi.fn(async () => ({ ref: "opencode:ses_new" })),
    interrupt: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
    actOnAttention: vi.fn(async () => undefined),
  } as unknown as McpHubApi;
}

describe("withProviderPolicy", () => {
  it("returns the original API when no allowlist is configured", () => {
    const api = createApi();
    expect(withProviderPolicy(api, undefined)).toBe(api);
    expect(withProviderPolicy(api, [])).toBe(api);
  });

  it("filters provider and session listings", async () => {
    const api = createApi();
    const scoped = withProviderPolicy(api, ["opencode"]);

    await expect(scoped.providers()).resolves.toEqual([providers[0]]);
    await expect(scoped.sessions({ limit: 10 })).resolves.toMatchObject({
      data: [sessions.data[0]],
    });
    expect(api.sessions).toHaveBeenCalledWith({
      limit: 10,
      provider: "opencode",
    });
  });

  it("rejects reads and writes for another provider", async () => {
    const scoped = withProviderPolicy(createApi(), ["opencode"]);

    await expect(scoped.checkProvider("openwebui")).rejects.toThrow(
      /not allowed/,
    );
    await expect(scoped.session("openwebui:chat_b")).rejects.toThrow(
      /not allowed/,
    );
    await expect(scoped.messages("openwebui:chat_b")).rejects.toThrow(
      /not allowed/,
    );
    await expect(
      scoped.sendMessage("openwebui:chat_b", { text: "hello" }),
    ).rejects.toThrow(/not allowed/);
    await expect(
      scoped.createSession({ providerID: "openwebui", title: "new" }),
    ).rejects.toThrow(/not allowed/);
    await expect(scoped.interrupt("openwebui:chat_b")).rejects.toThrow(
      /not allowed/,
    );
    await expect(scoped.markRead("openwebui:chat_b")).rejects.toThrow(
      /not allowed/,
    );
  });

  it("filters attention and blocks actions on hidden items", async () => {
    const api = createApi();
    const scoped = withProviderPolicy(api, ["opencode"]);

    await expect(scoped.attention()).resolves.toMatchObject({
      data: [attention.data[0]],
    });
    await expect(
      scoped.actOnAttention("openwebui:error:chat_b:1", "dismiss"),
    ).rejects.toThrow(/not allowed|not found/);
    await expect(
      scoped.actOnAttention("opencode:permission:ses_a:1", "allow_once"),
    ).resolves.toBeUndefined();
    expect(api.actOnAttention).toHaveBeenCalledWith(
      "opencode:permission:ses_a:1",
      "allow_once",
      undefined,
    );
  });
});
