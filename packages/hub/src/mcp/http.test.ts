import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type {
  AttentionPage,
  HubEvent,
  Provider,
  SessionPage,
} from "@amoshydra/oktoso-contracts";
import { zHubConfig } from "../config/schema";
import type { AppEnv } from "../http/types";
import { createLogger } from "../lib/logger";
import { registerMcpRoutes, type McpRouteHandle } from "./http";
import type { McpHubApi } from "./server";

const logger = createLogger({ level: "silent" });
const roots: string[] = [];
const handles: McpRouteHandle[] = [];

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

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "oktoso-mcp-http-"));
  roots.push(root);
  return root;
}

function createApi() {
  const sendMessage = vi.fn(async () => ({ id: "message-1" }));
  const api = {
    providers: vi.fn(async () => providers),
    checkProvider: vi.fn(async () => ({ status: "online" })),
    sessions: vi.fn(async () => sessions),
    session: vi.fn(async () => ({ ref: "opencode:ses_a" })),
    messages: vi.fn(async () => ({ data: [] })),
    question: vi.fn(async () => null),
    attention: vi.fn(async () => ({ data: [] }) as unknown as AttentionPage),
    sendMessage,
    createSession: vi.fn(async () => ({ ref: "opencode:ses_new" })),
    interrupt: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
    actOnAttention: vi.fn(async () => undefined),
  } as unknown as McpHubApi;
  return { api, sendMessage };
}

async function harness(options: {
  tokens: Array<Record<string, unknown>>;
  audit?: boolean;
  events?: { subscribe(listener: (event: HubEvent) => void): () => void };
}) {
  const root = await tempRoot();
  const config = zHubConfig.parse({
    token: "hub-token-long-enough",
    dataDir: root,
    mcp: {
      enabled: true,
      tokens: options.tokens,
      audit: {
        enabled: options.audit ?? false,
        ...(options.audit ? { file: join(root, "mcp-audit.jsonl") } : {}),
      },
    },
  });
  const { api, sendMessage } = createApi();
  const app = new Hono<AppEnv>();
  const handle = registerMcpRoutes(app, {
    config,
    api,
    logger,
    version: "test",
    ...(options.events ? { events: options.events } : {}),
  })!;
  handles.push(handle);
  return { app, handle, config, api, sendMessage, root };
}

interface RpcOptions {
  token?: string;
  sessionId?: string;
  origin?: string;
  method?: string;
  body?: unknown;
}

async function rpc(
  app: Hono<AppEnv>,
  options: RpcOptions,
): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
  };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.sessionId) headers["Mcp-Session-Id"] = options.sessionId;
  if (options.origin) headers.Origin = options.origin;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  return app.request("/mcp", {
    method: options.method ?? "POST",
    headers,
    ...(options.body !== undefined
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
}

async function initialize(
  app: Hono<AppEnv>,
  token: string,
): Promise<string> {
  const response = await rpc(app, {
    token,
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "1.0.0" },
      },
    },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toContain("application/json");
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  const body = await response.json();
  expect(body.result.serverInfo.name).toBe("oktoso");

  const initialized = await rpc(app, {
    token,
    sessionId: sessionId!,
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  expect(initialized.status).toBe(202);
  return sessionId!;
}

async function call(
  app: Hono<AppEnv>,
  token: string,
  sessionId: string,
  body: unknown,
): Promise<Response> {
  return rpc(app, { token, sessionId, body });
}

afterEach(async () => {
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("hosted MCP route", () => {
  it("rejects missing auth, disallowed origins, and unknown sessions", async () => {
    const { app } = await harness({
      tokens: [{ id: "reader", token: "reader-token-long-enough" }],
    });

    const unauthorized = await rpc(app, {
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
    });
    expect(unauthorized.status).toBe(401);

    const forbidden = await rpc(app, {
      token: "reader-token-long-enough",
      origin: "http://evil.example",
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
    });
    expect(forbidden.status).toBe(403);

    const missing = await rpc(app, {
      token: "reader-token-long-enough",
      sessionId: "missing-session",
      body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
    });
    expect(missing.status).toBe(404);
  });

  it("rejects a session presented by another client", async () => {
    const { app } = await harness({
      tokens: [
        { id: "reader", token: "reader-token-long-enough" },
        {
          id: "controller",
          token: "controller-token-long-enough",
          allowWrite: true,
        },
      ],
    });
    const sessionId = await initialize(app, "reader-token-long-enough");

    const crossed = await rpc(app, {
      token: "controller-token-long-enough",
      sessionId,
      body: { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    });
    expect(crossed.status).toBe(404);
  });

  it("serves 404 when MCP is disabled", async () => {
    const config = zHubConfig.parse({
      token: "hub-token-long-enough",
      mcp: { enabled: false },
    });
    const app = new Hono<AppEnv>();
    const handle = registerMcpRoutes(app, {
      config,
      api: createApi().api,
      logger,
      version: "test",
    });
    expect(handle).toBeUndefined();
    const response = await app.request("/mcp");
    expect(response.status).toBe(404);
  });

  it("initializes a read-only session and lists the read tools", async () => {
    const { app } = await harness({
      tokens: [{ id: "reader", token: "reader-token-long-enough" }],
    });
    const sessionId = await initialize(app, "reader-token-long-enough");

    const listed = await call(app, "reader-token-long-enough", sessionId, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(listed.status).toBe(200);
    const body = await listed.json();
    const names = body.result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toHaveLength(7);
    expect(names).toContain("providers_list");
    expect(names).not.toContain("sessions_send");

    const called = await call(app, "reader-token-long-enough", sessionId, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "providers_list", arguments: {} },
    });
    const callBody = await called.json();
    const payload = JSON.parse(callBody.result.content[0].text);
    expect(payload.data).toHaveLength(2);
  });

  it("exposes write tools and forwards sends for a write token", async () => {
    const { app, sendMessage } = await harness({
      tokens: [
        {
          id: "controller",
          token: "controller-token-long-enough",
          allowWrite: true,
        },
      ],
    });
    const sessionId = await initialize(app, "controller-token-long-enough");

    const listed = await call(app, "controller-token-long-enough", sessionId, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const names = (await listed.json()).result.tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(names).toHaveLength(12);
    expect(names).toContain("sessions_send");

    const sent = await call(app, "controller-token-long-enough", sessionId, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "sessions_send",
        arguments: {
          ref: "opencode:ses_auth",
          text: "hello",
          idempotencyKey: "key-1",
        },
      },
    });
    expect((await sent.json()).result.isError).toBeUndefined();
    expect(sendMessage).toHaveBeenCalledWith(
      "opencode:ses_auth",
      { text: "hello" },
      { idempotencyKey: "key-1" },
    );
  });

  it("applies the provider and tool allowlists", async () => {
    const { app } = await harness({
      tokens: [
        {
          id: "scoped",
          token: "scoped-token-long-enough",
          providers: ["opencode"],
          tools: ["providers_list"],
        },
      ],
    });
    const sessionId = await initialize(app, "scoped-token-long-enough");

    const listed = await call(app, "scoped-token-long-enough", sessionId, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    const names = (await listed.json()).result.tools.map(
      (tool: { name: string }) => tool.name,
    );
    expect(names).toEqual(["providers_list"]);

    const called = await call(app, "scoped-token-long-enough", sessionId, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "providers_list", arguments: {} },
    });
    const payload = JSON.parse((await called.json()).result.content[0].text);
    expect(payload.data.map((provider: { id: string }) => provider.id)).toEqual([
      "opencode",
    ]);

    const hidden = await call(app, "scoped-token-long-enough", sessionId, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "sessions_send", arguments: { ref: "opencode:ses_a", text: "hi" } },
    });
    const hiddenBody = await hidden.json();
    expect(hiddenBody.error ?? hiddenBody.result?.isError).toBeTruthy();
  });

  it("rate limits a client", async () => {
    const { app } = await harness({
      tokens: [
        {
          id: "fast",
          token: "fast-token-long-enough",
          rateLimit: { max: 1, windowMs: 60_000 },
        },
      ],
    });

    const first = await rpc(app, {
      token: "fast-token-long-enough",
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "test", version: "1" },
        },
      },
    });
    expect(first.status).toBe(200);

    const second = await rpc(app, {
      token: "fast-token-long-enough",
      body: { jsonrpc: "2.0", id: 2, method: "ping" },
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
  });

  it("writes an audit entry for a tool call", async () => {
    const { app, handle, root } = await harness({
      tokens: [{ id: "reader", token: "reader-token-long-enough" }],
      audit: true,
    });
    const sessionId = await initialize(app, "reader-token-long-enough");
    await call(app, "reader-token-long-enough", sessionId, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "providers_list", arguments: {} },
    });
    await handle.close();

    const lines = (await readFile(join(root, "mcp-audit.jsonl"), "utf8"))
      .trim()
      .split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      clientId: "reader",
      tool: "providers_list",
      ok: true,
    });
  });

  it("serves resources and pushes update notifications over HTTP", async () => {
    const listeners = new Set<(event: HubEvent) => void>();
    const events = {
      subscribe(listener: (event: HubEvent) => void) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
    const { app } = await harness({
      tokens: [{ id: "reader", token: "reader-token-long-enough" }],
      events,
    });

    const transport = new StreamableHTTPClientTransport(
      new URL("http://oktoso.test/mcp"),
      {
        fetch: async (input, init) => app.request(input.toString(), init),
        requestInit: {
          headers: { Authorization: "Bearer reader-token-long-enough" },
        },
      },
    );
    const client = new Client({ name: "resource-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const listed = await client.listResources();
      expect(listed.resources.map((resource) => resource.uri)).toEqual(
        expect.arrayContaining(["oktoso://attention", "oktoso://sessions"]),
      );

      const read = await client.readResource({ uri: "oktoso://attention" });
      const payload = JSON.parse((read.contents[0] as { text: string }).text);
      expect(payload.data).toEqual([]);

      const updates: string[] = [];
      client.setNotificationHandler(
        ResourceUpdatedNotificationSchema,
        (notification) => {
          updates.push(notification.params.uri);
        },
      );
      await client.subscribeResource({ uri: "oktoso://attention" });
      for (const listener of listeners) {
        listener({ seq: 1, type: "attention.updated", data: {}, at: 1 });
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(updates).toEqual(["oktoso://attention"]);
    } finally {
      await client.close();
    }
  });
});
