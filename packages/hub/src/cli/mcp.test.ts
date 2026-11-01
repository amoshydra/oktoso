import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import type {
  Attention,
  AttentionPage,
  MessagePage,
  Provider,
  QuestionPrompt,
  SendInput,
  Session,
  SessionPage,
} from "@amoshydra/oktoso-contracts";
import {
  createOktosoMcpServer,
  type McpHubApi,
} from "./mcp";

const provider: Provider = {
  id: "opencode",
  type: "opencode",
  name: "opencode",
  baseUrl: "http://127.0.0.1:4096",
  enabled: true,
  status: "online",
  capabilities: {
    list: true,
    read: true,
    send: true,
    create: true,
    stream: true,
    interrupt: true,
    permissions: true,
    forms: true,
    attachments: false,
    search: false,
    options: true,
    markRead: true,
  },
};

const session: Session = {
  ref: "opencode:ses_abc",
  providerID: "opencode",
  nativeID: "ses_abc",
  title: "Fix the auth race",
  status: "idle",
  unread: false,
  updatedAt: 1,
  createdAt: 1,
};

const attention: Attention = {
  id: "attention-1",
  sessionRef: "opencode:ses_abc",
  type: "permission",
  priority: "blocking",
  title: "Run shell command",
  summary: "git push --force origin main",
  createdAt: 1,
  actions: [{ id: "allow_once", label: "Allow once" }],
};

function fakeApi(overrides: Partial<McpHubApi> = {}): McpHubApi {
  const api: McpHubApi = {
    providers: vi.fn(async () => [provider]),
    checkProvider: vi.fn(async () => ({
      status: "online" as const,
      latencyMs: 12,
    })),
    sessions: vi.fn(
      async (): Promise<SessionPage> => ({
        data: [session],
        cursor: { next: null, previous: null },
      }),
    ),
    session: vi.fn(async () => session),
    messages: vi.fn(
      async (): Promise<MessagePage> => ({
        data: [],
        cursor: { next: null, previous: null },
      }),
    ),
    question: vi.fn(async (): Promise<QuestionPrompt | null> => null),
    attention: vi.fn(
      async (): Promise<AttentionPage> => ({ data: [attention] }),
    ),
    sendMessage: vi.fn(async () => ({ accepted: true })),
    createSession: vi.fn(async () => session),
    interrupt: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
    actOnAttention: vi.fn(async () => undefined),
    ...overrides,
  };
  return api;
}

async function connect(api: McpHubApi, allowWrite = false) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const server = createOktosoMcpServer({
    api,
    version: "test",
    allowWrite,
  });
  await server.connect(serverTransport);

  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);

  return {
    client,
    server,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

function toolText(result: unknown): string {
  const content = (result as { content?: Array<{ text?: string }> }).content;
  return content?.[0]?.text ?? "";
}

describe("Oktoso MCP server", () => {
  it("exposes read tools and hides writes by default", async () => {
    const { client, close } = await connect(fakeApi());
    try {
      const { tools } = await client.listTools();
      const names = tools.map((tool) => tool.name);
      expect(names).toContain("providers_list");
      expect(names).toContain("providers_check");
      expect(names).toContain("sessions_messages");
      expect(names).toContain("attention_list");
      expect(names).not.toContain("sessions_send");
      expect(names).not.toContain("attention_act");
    } finally {
      await close();
    }
  });

  it("passes session filters through to the hub", async () => {
    const api = fakeApi();
    const { client, close } = await connect(api);
    try {
      const result = await client.callTool({
        name: "sessions_list",
        arguments: { provider: "opencode", limit: 5 },
      });
      expect(api.sessions).toHaveBeenCalledWith({
        provider: "opencode",
        limit: 5,
      });
      expect(toolText(result)).toContain("Fix the auth race");
    } finally {
      await close();
    }
  });

  it("enables write tools and defaults answer source to choice", async () => {
    const api = fakeApi();
    const { client, close } = await connect(api, true);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain("sessions_send");

      const result = await client.callTool({
        name: "sessions_send",
        arguments: {
          ref: "opencode:ses_abc",
          text: "Use option A",
          idempotencyKey: "key-1",
          answer: {
            questionId: "q1",
            messageId: "m1",
            revision: "r1",
            choiceId: "a",
          },
        },
      });

      expect(result.isError).toBeUndefined();
      expect(api.sendMessage).toHaveBeenCalledWith(
        "opencode:ses_abc",
        {
          text: "Use option A",
          answer: {
            questionId: "q1",
            messageId: "m1",
            revision: "r1",
            choiceId: "a",
            source: "choice",
          },
        },
        { idempotencyKey: "key-1" },
      );

      await client.callTool({
        name: "sessions_send",
        arguments: {
          ref: "opencode:ses_abc",
          text: "Ship it",
          answer: {
            questionId: "q1",
            messageId: "m1",
            revision: "r1",
          },
        },
      });
      expect(api.sendMessage).toHaveBeenLastCalledWith(
        "opencode:ses_abc",
        {
          text: "Ship it",
          answer: {
            questionId: "q1",
            messageId: "m1",
            revision: "r1",
            source: "text",
          },
        },
        { idempotencyKey: undefined },
      );
    } finally {
      await close();
    }
  });

  it("requires confirmation before approving attention", async () => {
    const api = fakeApi();
    const { client, close } = await connect(api, true);
    try {
      const denied = await client.callTool({
        name: "attention_act",
        arguments: { attentionId: "attention-1", action: "allow_once" },
      });
      expect(denied.isError).toBe(true);
      expect(toolText(denied)).toContain("Confirmation required");
      expect(api.actOnAttention).not.toHaveBeenCalled();

      const allowed = await client.callTool({
        name: "attention_act",
        arguments: {
          attentionId: "attention-1",
          action: "allow_once",
          confirm: true,
        },
      });
      expect(allowed.isError).toBeUndefined();
      expect(api.actOnAttention).toHaveBeenCalledWith(
        "attention-1",
        "allow_once",
        {},
      );
    } finally {
      await close();
    }
  });

  it("refuses to act on the calling OpenCode session", async () => {
    const api = fakeApi();
    const { client, close } = await connect(api, true);
    try {
      const result = await client.callTool({
        name: "sessions_send",
        arguments: { ref: "opencode:ses_caller", text: "hello" },
        _meta: { "ai.opencode/sessionID": "ses_caller" },
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("Refusing to act");
      expect(api.sendMessage).not.toHaveBeenCalled();
    } finally {
      await close();
    }
  });

  it("returns tool errors instead of throwing", async () => {
    const api = fakeApi({
      sessions: vi.fn(async () => {
        throw new Error("hub is offline");
      }),
    });
    const { client, close } = await connect(api);
    try {
      const result = await client.callTool({
        name: "sessions_list",
        arguments: {},
      });
      expect(result.isError).toBe(true);
      expect(toolText(result)).toContain("hub is offline");
    } finally {
      await close();
    }
  });
});
