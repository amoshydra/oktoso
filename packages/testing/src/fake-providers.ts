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

interface FakeOpenCodeSession {
  id: string;
  projectID: string;
  agent: string;
  model: { id: string; providerID: string; variant?: string };
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  outcome?: string;
  time: { created: number; updated: number; idle?: number; viewed?: number };
  title: string;
  location: { directory: string };
}

const OPENCODE_SESSIONS: FakeOpenCodeSession[] = [
  {
    id: "ses_auth",
    projectID: "project-oktoso",
    agent: "build",
    model: { id: "claude-sonnet", providerID: "commandcode", variant: "max" },
    cost: 0.42,
    tokens: { input: 12500, output: 1200, reasoning: 800, cache: { read: 0, write: 0 } },
    outcome: "succeeded",
    time: { created: 1_792_970_000_000, updated: 1_792_970_180_000, idle: 1_792_970_170_000, viewed: 1_792_970_100_000 },
    title: "Fix auth race in gateway",
    location: { directory: "/home/me/oktoso" },
  },
  {
    id: "ses_index",
    projectID: "project-oktoso-api",
    agent: "build",
    model: { id: "deepseek-v4.1-flash", providerID: "commandcode" },
    cost: 0.18,
    tokens: { input: 8200, output: 700, reasoning: 250, cache: { read: 0, write: 0 } },
    outcome: "succeeded",
    time: { created: 1_792_968_000_000, updated: 1_792_968_900_000, idle: 1_792_968_890_000 },
    title: "Refactor session index",
    location: { directory: "/home/me/oktoso-api" },
  },
  {
    id: "ses_rust",
    projectID: "project-oktoso",
    agent: "build",
    model: { id: "claude-sonnet", providerID: "commandcode" },
    cost: 0.07,
    tokens: { input: 3900, output: 300, reasoning: 100, cache: { read: 0, write: 0 } },
    outcome: "failed",
    time: { created: 1_792_960_000_000, updated: 1_792_960_300_000, idle: 1_792_960_290_000 },
    title: "Port hub to Rust",
    location: { directory: "/home/me/oktoso" },
  },
];

const OPENCODE_MESSAGES: Record<string, Array<Record<string, unknown>>> = {
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
          text: "The failing test is in auth.test.ts. I am narrowing it to the double-refresh case. Should I continue with the double-refresh case?",
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
        { type: "text", text: "SSE parser fails on a comment frame. What should I name the replacement branch?" },
      ],
      error: { type: "Error", message: "SSE parser fails on a comment frame." },
    },
  ],
};

let fakePermission: Record<string, unknown> | undefined = {
  id: "per_1",
  sessionID: "ses_auth",
  action: "shell",
  resources: ["git push origin main"],
  message: "Allow the agent to push the branch?",
};

let fakeForm: Record<string, unknown> | undefined = {
  id: "frm_1",
  sessionID: "ses_index",
  title: "Choose the next model",
  fields: [
    {
      key: "model",
      title: "Model",
      type: "string",
      required: true,
      options: [
        { value: "claude-sonnet", label: "Claude Sonnet" },
        { value: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
      ],
    },
    {
      key: "remember",
      title: "Remember this choice",
      type: "boolean",
      required: false,
    },
  ],
};

const INITIAL_OPENCODE_MESSAGES = structuredClone(OPENCODE_MESSAGES);
const INITIAL_PERMISSION = structuredClone(fakePermission);
const INITIAL_FORM = structuredClone(fakeForm);

export function resetFakeProviderState(): void {
  for (const key of Object.keys(OPENCODE_MESSAGES)) {
    delete OPENCODE_MESSAGES[key];
  }
  for (const [key, messages] of Object.entries(INITIAL_OPENCODE_MESSAGES)) {
    OPENCODE_MESSAGES[key] = structuredClone(messages);
  }
  fakePermission = structuredClone(INITIAL_PERMISSION);
  fakeForm = structuredClone(INITIAL_FORM);
}

interface FakeOwuiMessage {
  id: string;
  role: string;
  content: string;
  parentId: string | null;
  childrenIds: string[];
  timestamp: number;
  model?: string;
  done?: boolean;
  error?: unknown;
}

interface FakeOwuiChat {
  id: string;
  title: string;
  created_at: number;
  updated_at: number;
  last_read_at: number;
  active: boolean;
  chat: {
    title: string;
    models: string[];
    history: {
      currentId: string | null;
      messages: Record<string, FakeOwuiMessage>;
    };
  };
}

function makeFakeOwuiChat(options: {
  id: string;
  title: string;
  assistantContent: string;
  error?: unknown;
}): FakeOwuiChat {
  const now = Math.floor(Date.now() / 1000);
  const userID = `${options.id}-user`;
  const assistantID = `${options.id}-assistant`;
  return {
    id: options.id,
    title: options.title,
    created_at: now - 120,
    updated_at: now,
    last_read_at: 0,
    active: false,
    chat: {
      title: options.title,
      models: ["fake-model"],
      history: {
        currentId: assistantID,
        messages: {
          [userID]: {
            id: userID,
            role: "user",
            content: `Hello from ${options.title}`,
            parentId: null,
            childrenIds: [assistantID],
            timestamp: now - 2,
          },
          [assistantID]: {
            id: assistantID,
            role: "assistant",
            content: options.assistantContent,
            parentId: userID,
            childrenIds: [],
            timestamp: now - 1,
            model: "fake-model",
            done: options.error ? false : true,
            ...(options.error ? { error: options.error } : {}),
          },
        },
      },
    },
  };
}

const OWUI_CHATS = new Map<string, FakeOwuiChat>([
  [
    "chat_fake_openwebui",
    makeFakeOwuiChat({
      id: "chat_fake_openwebui",
      title: "Fake Open WebUI chat",
      assistantContent: "Fake Open WebUI reply.",
    }),
  ],
  [
    "chat_fake_error",
    makeFakeOwuiChat({
      id: "chat_fake_error",
      title: "Fake Open WebUI failed chat",
      assistantContent: "",
      error: { message: "Fake model failure" },
    }),
  ],
]);

function owuiSummary(chat: FakeOwuiChat): Record<string, unknown> {
  return {
    id: chat.id,
    title: chat.title,
    updated_at: chat.updated_at,
    created_at: chat.created_at,
    last_read_at: chat.last_read_at,
    snippet: null,
    active: chat.active,
  };
}

function sortedOwuiChats(): FakeOwuiChat[] {
  return [...OWUI_CHATS.values()].sort(
    (left, right) => right.updated_at - left.updated_at,
  );
}

const fakeEventClients = new Set<ServerResponse>();

function broadcastEvent(type: string, data: unknown): void {
  const payload = `data: ${JSON.stringify({
    id: `evt_${Date.now().toString(36)}`,
    type,
    properties: data,
  })}\n\n`;
  for (const response of fakeEventClients) response.write(payload);
}

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

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const path = url.pathname;

  if (path === "/api/permission/request" && request.method === "GET") {
    sendJson(response, 200, {
      location: { directory: "/home/me/oktoso" },
      data: fakePermission ? [fakePermission] : [],
    });
    return;
  }
  if (path === "/api/form" && request.method === "GET") {
    sendJson(response, 200, {
      location: { directory: "/home/me/oktoso" },
      data: fakeForm ? [fakeForm] : [],
    });
    return;
  }
  const permissionReply = path.match(/^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/);
  if (permissionReply && request.method === "POST") {
    fakePermission = undefined;
    response.writeHead(204);
    response.end();
    return;
  }
  const formReply = path.match(/^\/api\/session\/([^/]+)\/form\/([^/]+)\/reply$/);
  if (formReply && request.method === "POST") {
    fakeForm = undefined;
    response.writeHead(204);
    response.end();
    return;
  }
  const formDelete = path.match(/^\/api\/session\/([^/]+)\/form\/([^/]+)$/);
  if (formDelete && request.method === "DELETE") {
    fakeForm = undefined;
    response.writeHead(204);
    response.end();
    return;
  }
  if (path === "/api/event" && request.method === "GET") {
    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    response.write(`data: ${JSON.stringify({ id: "evt_connected", type: "server.connected", data: {} })}\n\n`);
    fakeEventClients.add(response);
    const timer = setInterval(() => response.write(": heartbeat\n\n"), 15_000);
    request.on("close", () => {
      clearInterval(timer);
      fakeEventClients.delete(response);
    });
    return;
  }
  if (path === "/api/agent" && request.method === "GET") {
    sendJson(response, 200, {
      data: [{ id: "build", name: "Build" }],
      location: { directory: "/home/me/oktoso" },
    });
    return;
  }
  if (path === "/api/model" && request.method === "GET") {
    sendJson(response, 200, {
      data: [
        {
          id: "claude-sonnet",
          modelID: "claude-sonnet",
          providerID: "commandcode",
          name: "Claude Sonnet",
        },
      ],
      location: { directory: "/home/me/oktoso" },
    });
    return;
  }
  if (path === "/api/session" && request.method === "POST") {
    const body = await readBody(request);
    const now = Date.now();
    const location = body.location && typeof body.location === "object"
      ? (body.location as { directory?: string })
      : {};
    const session = {
      id: `ses_fake_${now.toString(36)}`,
      projectID: "project-oktoso",
      agent: typeof body.agent === "string" ? body.agent : "build",
      model:
        body.model && typeof body.model === "object"
          ? (body.model as { id: string; providerID: string; variant?: string })
          : { id: "claude-sonnet", providerID: "commandcode" },
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: now, updated: now },
      title: typeof body.title === "string" && body.title ? body.title : "Untitled session",
      location: { directory: location.directory ?? "/home/me/oktoso" },
    };
    OPENCODE_SESSIONS.unshift(session);
    OPENCODE_MESSAGES[session.id] = [];
    broadcastEvent("session.created", { sessionID: session.id });
    sendJson(response, 200, { data: session });
    return;
  }
  if (path === "/api/info") {
    sendJson(response, 200, { version: "0.0.0-fake-opencode" });
    return;
  }
  if (path === "/api/session") {
    sendJson(response, 200, page(OPENCODE_SESSIONS, url));
    return;
  }
  const sessionMatch = path.match(/^\/api\/session\/([^/]+)$/);
  if (sessionMatch && request.method === "DELETE") {
    const sessionID = sessionMatch[1] ?? "";
    const index = OPENCODE_SESSIONS.findIndex((item) => item.id === sessionID);
    if (index === -1) {
      sendJson(response, 404, { _tag: "SessionNotFoundError", message: "Session not found" });
      return;
    }
    OPENCODE_SESSIONS.splice(index, 1);
    delete OPENCODE_MESSAGES[sessionID];
    broadcastEvent("session.deleted", { sessionID });
    response.writeHead(204);
    response.end();
    return;
  }
  if (sessionMatch && request.method === "GET") {
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
  const promptMatch = path.match(/^\/api\/session\/([^/]+)\/prompt$/);
  if (promptMatch && request.method === "POST") {
    const sessionID = promptMatch[1] ?? "";
    const body = await readBody(request);
    const messages = OPENCODE_MESSAGES[sessionID];
    if (!messages) {
      sendJson(response, 404, { _tag: "SessionNotFoundError", message: "Session not found" });
      return;
    }
    const text = typeof body.text === "string" ? body.text : "";
    const now = Date.now();
    const userID = `msg_fake_${now.toString(36)}`;
    messages.push({
      id: userID,
      type: "user",
      time: { created: now },
      text,
      files: [],
      agents: [],
    });
    const replyID = `msg_fake_reply_${now.toString(36)}`;
    const replyText = `Fake reply: ${text}`;
    messages.push({
      id: replyID,
      type: "assistant",
      time: { created: now + 1, completed: now + 2 },
      agent: "build",
      model: { id: "claude-sonnet", providerID: "commandcode" },
      content: [{ type: "text", text: replyText }],
    });
    const session = OPENCODE_SESSIONS.find((item) => item.id === sessionID);
    if (session) {
      session.time.updated = now + 2;
      session.time.idle = now + 2;
      session.outcome = "succeeded";
    }
    const replyPartID = `part_${replyID}_text`;
    broadcastEvent("message.updated", {
      sessionID,
      info: {
        id: userID,
        sessionID,
        type: "user",
        time: { created: now },
        text,
      },
    });
    broadcastEvent("message.updated", {
      sessionID,
      info: {
        id: replyID,
        sessionID,
        type: "assistant",
        time: { created: now + 1 },
        content: [],
      },
    });
    setTimeout(() => {
      broadcastEvent("message.part.updated", {
        sessionID,
        part: {
          id: replyPartID,
          messageID: replyID,
          sessionID,
          type: "text",
          text: replyText.slice(0, Math.ceil(replyText.length / 2)),
        },
      });
    }, 25);
    setTimeout(() => {
      broadcastEvent("message.part.updated", {
        sessionID,
        part: {
          id: replyPartID,
          messageID: replyID,
          sessionID,
          type: "text",
          text: replyText,
        },
      });
    }, 50);
    setTimeout(() => {
      broadcastEvent("message.updated", {
        sessionID,
        info: {
          id: replyID,
          sessionID,
          type: "assistant",
          time: { created: now + 1, completed: now + 2 },
        },
      });
    }, 75);
    setTimeout(() => {
      broadcastEvent("session.updated", { sessionID });
    }, 100);
    sendJson(response, 200, { data: { id: userID } });
    return;
  }
  const interruptMatch = path.match(/^\/api\/session\/([^/]+)\/interrupt$/);
  if (interruptMatch && request.method === "POST") {
    sendJson(response, 200, { interrupted: true });
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
  if (path === "/api/config") {
    sendJson(response, 200, { name: "Open WebUI", version: "0.0.0-fake-openwebui" });
    return;
  }
  if (path === "/api/v1/chats/list" && request.method === "GET") {
    const page = Number(url.searchParams.get("page") ?? "0");
    const rows = page > 1 ? [] : sortedOwuiChats().map(owuiSummary);
    sendJson(response, 200, rows);
    return;
  }
  if (path === "/api/v1/chats/search" && request.method === "GET") {
    const text = (url.searchParams.get("text") ?? "").toLowerCase();
    const page = Number(url.searchParams.get("page") ?? "1");
    const rows =
      page > 1
        ? []
        : sortedOwuiChats()
            .filter((chat) => chat.title.toLowerCase().includes(text))
            .map(owuiSummary);
    sendJson(response, 200, rows);
    return;
  }
  if (path === "/api/v1/chats/new" && request.method === "POST") {
    const body = await readBody(request);
    const chatInput = body.chat && typeof body.chat === "object"
      ? (body.chat as Record<string, unknown>)
      : {};
    const now = Math.floor(Date.now() / 1000);
    const id = `chat_fake_${Date.now().toString(36)}`;
    const title = typeof chatInput.title === "string" ? chatInput.title : "New Chat";
    const models = Array.isArray(chatInput.models)
      ? chatInput.models.filter((model): model is string => typeof model === "string")
      : ["fake-model"];
    const chat: FakeOwuiChat = {
      id,
      title,
      created_at: now,
      updated_at: now,
      last_read_at: now,
      active: false,
      chat: {
        title,
        models: models.length > 0 ? models : ["fake-model"],
        history: { currentId: null, messages: {} },
      },
    };
    OWUI_CHATS.set(id, chat);
    sendJson(response, 200, { ...chat, user_id: "fake-user" });
    return;
  }
  if (path === "/api/chat/completions" && request.method === "POST") {
    const body = await readBody(request);
    const chatID = typeof body.chat_id === "string" ? body.chat_id : "";
    const assistantID = typeof body.id === "string" ? body.id : "";
    const chat = OWUI_CHATS.get(chatID);
    if (!chat) {
      sendJson(response, 404, { detail: "Chat not found" });
      return;
    }
    const assistant = chat.chat.history.messages[assistantID];
    const userText = chat.chat.history.messages[
      typeof (body.user_message as { id?: unknown } | undefined)?.id === "string"
        ? ((body.user_message as { id: string }).id)
        : ""
    ]?.content;
    if (assistant) {
      assistant.content = `Fake Open WebUI reply: ${userText ?? ""}`;
      assistant.done = true;
      assistant.timestamp = Math.floor(Date.now() / 1000);
    }
    chat.updated_at = Math.floor(Date.now() / 1000);
    sendJson(response, 200, {
      status: true,
      task_ids: [`task_${chatID}`],
      chat_id: chatID,
    });
    return;
  }
  const owuiChatMatch = path.match(/^\/api\/v1\/chats\/([^/]+)$/);
  if (owuiChatMatch && request.method === "GET") {
    const chat = OWUI_CHATS.get(owuiChatMatch[1] ?? "");
    if (!chat) {
      sendJson(response, 401, { detail: "Not found" });
      return;
    }
    sendJson(response, 200, { ...chat, user_id: "fake-user" });
    return;
  }
  if (owuiChatMatch && request.method === "DELETE") {
    OWUI_CHATS.delete(owuiChatMatch[1] ?? "");
    response.writeHead(200);
    response.end();
    return;
  }
  if (owuiChatMatch && request.method === "POST") {
    const chat = OWUI_CHATS.get(owuiChatMatch[1] ?? "");
    if (!chat) {
      sendJson(response, 401, { detail: "Not found" });
      return;
    }
    const body = await readBody(request);
    const incoming = body.chat && typeof body.chat === "object"
      ? (body.chat as Record<string, unknown>)
      : {};
    const incomingHistory = incoming.history && typeof incoming.history === "object"
      ? (incoming.history as Record<string, unknown>)
      : {};
    const incomingMessages = incomingHistory.messages && typeof incomingHistory.messages === "object"
      ? (incomingHistory.messages as Record<string, FakeOwuiMessage>)
      : {};
    Object.assign(chat.chat.history.messages, incomingMessages);
    if (typeof incomingHistory.currentId === "string" || incomingHistory.currentId === null) {
      chat.chat.history.currentId = incomingHistory.currentId as string | null;
    }
    if (Array.isArray(incoming.models)) {
      chat.chat.models = incoming.models.filter((model): model is string => typeof model === "string");
    }
    chat.updated_at = Math.floor(Date.now() / 1000);
    sendJson(response, 200, { ...chat, user_id: "fake-user" });
    return;
  }
  if (path.match(/^\/api\/tasks\/chat\/[^/]+\/stop$/) && request.method === "POST") {
    sendJson(response, 200, { message: "Stopped" });
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
    void handle(request, response).catch((error) => {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : String(error),
      });
    });
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
