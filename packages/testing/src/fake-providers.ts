import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export type FakeProviderKind = "opencode" | "openwebui" | "hermes";

export interface FakeProviderServer {
  kind: FakeProviderKind;
  port: number;
  url: string;
  close(): Promise<void>;
}

interface FakeServerOptions {
  kind: FakeProviderKind;
  port?: number;
  host?: string;
}

const OPENCODE_SESSIONS = [
  {
    id: "ses_auth",
    projectID: "project-agent-hub",
    agent: "build",
    model: { id: "claude-sonnet", providerID: "commandcode", variant: "max" },
    cost: 0.42,
    tokens: { input: 12500, output: 1200, reasoning: 800, cache: { read: 0, write: 0 } },
    outcome: "succeeded",
    time: { created: 1_792_970_000_000, updated: 1_792_970_180_000, idle: 1_792_970_170_000, viewed: 1_792_970_100_000 },
    title: "Fix auth race in gateway",
    location: { directory: "/home/me/agent-hub" },
  },
  {
    id: "ses_index",
    projectID: "project-agent-hub-api",
    agent: "build",
    model: { id: "deepseek-v4.1-flash", providerID: "commandcode" },
    cost: 0.18,
    tokens: { input: 8200, output: 700, reasoning: 250, cache: { read: 0, write: 0 } },
    outcome: "succeeded",
    time: { created: 1_792_968_000_000, updated: 1_792_968_900_000, idle: 1_792_968_890_000 },
    title: "Refactor session index",
    location: { directory: "/home/me/agent-hub-api" },
  },
  {
    id: "ses_rust",
    projectID: "project-agent-hub",
    agent: "build",
    model: { id: "claude-sonnet", providerID: "commandcode" },
    cost: 0.07,
    tokens: { input: 3900, output: 300, reasoning: 100, cache: { read: 0, write: 0 } },
    outcome: "failed",
    time: { created: 1_792_960_000_000, updated: 1_792_960_300_000, idle: 1_792_960_290_000 },
    title: "Port hub to Rust",
    location: { directory: "/home/me/agent-hub" },
  },
];

const OPENCODE_MESSAGES: Record<string, unknown[]> = {
  ses_auth: [
    {
      id: "msg_auth_user",
      type: "user",
      time: { created: 1_792_970_010_000 },
      text: "Continue with the failing test.",
      files: [],
      agents: [],
    },
    {
      id: "msg_auth_reasoning",
      type: "assistant",
      time: { created: 1_792_970_020_000, completed: 1_792_970_050_000 },
      agent: "build",
      model: { id: "claude-sonnet", providerID: "commandcode" },
      content: [
        {
          type: "reasoning",
          text: "The test is failing because two writers rotate the refresh token.",
        },
        {
          type: "tool",
          id: "tool_auth_1",
          name: "read",
          executed: true,
          state: {
            status: "completed",
            input: { path: "auth.ts" },
            content: [{ type: "text", text: "refresh token rotation" }],
          },
          time: { created: 1_792_970_025_000, completed: 1_792_970_040_000 },
        },
      ],
    },
    {
      id: "msg_auth_answer",
      type: "assistant",
      time: { created: 1_792_970_060_000, completed: 1_792_970_080_000 },
      agent: "build",
      model: { id: "claude-sonnet", providerID: "commandcode" },
      content: [
        {
          type: "text",
          text: "The failing test is in auth.test.ts. I am narrowing it to the double-refresh case.",
        },
      ],
    },
    {
      id: "msg_auth_idle",
      type: "idle",
      time: { created: 1_792_970_090_000 },
      outcome: "succeeded",
    },
  ],
  ses_index: [
    {
      id: "msg_index_user",
      type: "user",
      time: { created: 1_792_968_010_000 },
      text: "Refactor the session index to reconcile by native session ID.",
      files: [],
      agents: [],
    },
    {
      id: "msg_index_answer",
      type: "assistant",
      time: { created: 1_792_968_020_000, completed: 1_792_968_050_000 },
      agent: "build",
      model: { id: "deepseek-v4.1-flash", providerID: "commandcode" },
      content: [
        { type: "text", text: "The index now reconciles by native session ID." },
      ],
    },
  ],
  ses_rust: [
    {
      id: "msg_rust_user",
      type: "user",
      time: { created: 1_792_960_010_000 },
      text: "Port the hub to Rust.",
      files: [],
      agents: [],
    },
    {
      id: "msg_rust_error",
      type: "assistant",
      time: { created: 1_792_960_020_000, completed: 1_792_960_040_000 },
      agent: "build",
      model: { id: "claude-sonnet", providerID: "commandcode" },
      content: [
        { type: "text", text: "SSE parser fails on a comment frame." },
      ],
      error: { type: "Error", message: "SSE parser fails on a comment frame." },
    },
  ],
};

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function page<T>(items: T[], url: URL): { data: T[]; cursor: { previous: string | null; next: string | null } } {
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") ?? 50)));
  const offset = Math.max(0, Number(url.searchParams.get("cursor") ?? 0));
  const order = url.searchParams.get("order") === "asc" ? "asc" : "desc";
  const sorted = [...items];
  if (order === "desc") sorted.reverse();
  const data = sorted.slice(offset, offset + limit);
  const next = offset + limit < sorted.length ? String(offset + limit) : null;
  return { data, cursor: { previous: offset > 0 ? String(Math.max(0, offset - limit)) : null, next } };
}

function handle(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  if (path === "/api/info") {
    sendJson(response, 200, { version: "0.0.0-fake-opencode" });
    return;
  }
  if (path === "/api/session") {
    sendJson(response, 200, page(OPENCODE_SESSIONS, url));
    return;
  }
  const sessionMatch = path.match(/^\/api\/session\/([^/]+)$/);
  if (sessionMatch) {
    const session = OPENCODE_SESSIONS.find((item) => item.id === sessionMatch[1]);
    if (!session) {
      sendJson(response, 404, { _tag: "SessionNotFoundError", message: "Session not found" });
      return;
    }
    sendJson(response, 200, { data: session });
    return;
  }
  const messagesMatch = path.match(/^\/api\/session\/([^/]+)\/message$/);
  if (messagesMatch) {
    const messages = OPENCODE_MESSAGES[messagesMatch[1] ?? ""];
    if (!messages) {
      sendJson(response, 404, { _tag: "SessionNotFoundError", message: "Session not found" });
      return;
    }
    sendJson(response, 200, page(messages, url));
    return;
  }
  const viewMatch = path.match(/^\/api\/session\/([^/]+)\/view$/);
  if (viewMatch && request.method === "POST") {
    response.writeHead(204);
    response.end();
    return;
  }
  if (path === "/api/v1/models") {
    sendJson(response, 200, {
      data: [{ id: "fake-model", name: "Fake Model" }],
    });
    return;
  }
  if (path === "/api/v1/chats/list") {
    sendJson(response, 200, {
      data: [
        {
          id: "chat_fake",
          title: "Fake Open WebUI chat",
          updated_at: 2,
          created_at: 1,
        },
      ],
      cursor: { next: null },
    });
    return;
  }
  if (path === "/v1/capabilities") {
    sendJson(response, 200, {
      version: "0.0.0-fake-hermes",
      capabilities: ["sessions", "messages", "approvals"],
    });
    return;
  }
  if (path === "/health") {
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: "not_found", path });
}

export async function createFakeProviderServer(
  options: FakeServerOptions,
): Promise<FakeProviderServer> {
  const host = options.host ?? "127.0.0.1";
  const server = createServer((request, response) => {
    try {
      handle(request, response);
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    kind: options.kind,
    port: address.port,
    url: `http://${host}:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

export async function createFakeProviderServers(): Promise<FakeProviderServer[]> {
  return Promise.all([
    createFakeProviderServer({ kind: "opencode", port: 4101 }),
    createFakeProviderServer({ kind: "openwebui", port: 4102 }),
    createFakeProviderServer({ kind: "hermes", port: 4103 }),
  ]);
}
