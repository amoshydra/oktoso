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
  parentID?: string;
  projectID: string;
  agent: string;
  model: { id: string; providerID: string; variant?: string };
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  outcome?: string;
  time: {
    created: number;
    updated: number;
    busy?: number;
    idle?: number;
    viewed?: number;
  };
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

const OPENCODE_ARCHIVED_SESSIONS: FakeOpenCodeSession[] = [
  {
    ...OPENCODE_SESSIONS[0]!,
    id: "ses_archive",
    projectID: "project-archive",
    title: "Quarterly archive review",
    time: { created: 1_700_000_000_000, updated: 1_700_000_100_000 },
    location: { directory: "/home/me/archive" },
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
            metadata: { truncated: false },
          },
          time: { created: 1_792_970_025_000, completed: 1_792_970_026_000 },
        },
        {
          type: "tool",
          id: "tool_auth_2",
          name: "shell",
          executed: true,
          state: {
            status: "error",
            input: { command: "pnpm test auth" },
            content: [
              {
                type: "text",
                text: "> vitest run auth\n\n ✓ auth.test.ts (34 tests)\n × rotates the token once\n\nAssertionError: expected 2 to be 1\n  at auth.test.ts:84:24",
              },
            ],
            metadata: { exit: 1, truncated: false },
          },
          time: { created: 1_792_970_027_000, completed: 1_792_970_028_400 },
        },
        {
          type: "tool",
          id: "tool_auth_3",
          name: "write",
          executed: true,
          state: {
            status: "completed",
            input: {
              filePath: "notes/plan.md",
              content:
                "# Auth race plan\n\n- narrow the double refresh\n- rotate once per request window\n- keep the old token until both writers finish\n",
            },
            content: [{ type: "text", text: "Wrote 126 bytes to notes/plan.md" }],
            metadata: { truncated: false },
          },
          time: { created: 1_792_970_030_000, completed: 1_792_970_031_000 },
        },
        {
          type: "tool",
          id: "tool_auth_4",
          name: "execute",
          executed: true,
          state: {
            status: "completed",
            input: {
              code: 'const page = await tools["browser"].new_page({ url: "http://127.0.0.1:5175/" });\nreturn page;',
            },
            content: [
              {
                type: "text",
                text: "## Pages\n1: about:blank\n2: Oktoso (http://127.0.0.1:5175/) [selected]",
              },
            ],
            metadata: { toolCalls: [{ tool: "browser.new_page", status: "completed" }] },
          },
          time: { created: 1_792_970_032_000, completed: 1_792_970_032_576 },
        },
        {
          type: "tool",
          id: "tool_auth_5",
          name: "subagent",
          executed: true,
          state: {
            status: "running",
            input: {
              agent: "general",
              description: "Check the refresh fix",
              background: true,
              prompt: "Review the token rotation change and report regressions.",
            },
            metadata: { sessionID: "ses_child_demo", status: "running" },
          },
          time: { created: 1_792_970_033_000 },
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
          text: "The failing test is in auth.test.ts. I am narrowing it to the double-refresh case. I sketched the race in `plots/chart.png`, wrote the write-up to `reports/report.html`, and recorded it in `clips/race.mp4`. Should I continue with the double-refresh case?",
        },
        {
          type: "file",
          name: "auth-race.png",
          mimeType: "image/png",
          url: "/api/files/auth-race.png",
        },
        {
          type: "file",
          name: "notes.txt",
          mimeType: "text/plain",
          url: "/api/files/notes.txt",
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
      id: "msg_index_compaction",
      type: "compaction",
      time: { created: 1_792_968_015_000 },
      reason: "auto",
      status: "completed",
      summary:
        "## Objective\n\nReconcile sessions by native ID.\n\n- keep the cache key stable\n- drop the legacy cursor\n- keep forks addressable",
      tokens: { input: 853_721, output: 1829, reasoning: 1497 },
      cost: 0.13,
      model: { id: "deepseek-v4.1-flash", providerID: "commandcode" },
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
    {
      id: "msg_index_shell",
      type: "shell",
      time: { created: 1_792_968_060_000, completed: 1_792_968_061_400 },
      shellID: "sh_fake_build",
      command: "pnpm build",
      status: "exited",
      exit: 0,
      metadata: { background: true },
      output: {
        output: "built in 1.4s",
        cursor: 14,
        size: 14,
        truncated: false,
      },
    },
    {
      id: "msg_index_shell_live",
      type: "shell",
      // Recent so a demo shows minutes, not decades.
      time: { created: Date.now() - 72_000 },
      shellID: "sh_fake_dev",
      command: "pnpm dev",
      status: "running",
      metadata: { background: true },
      output: {
        output: "listening on 5173",
        cursor: 19,
        size: 19,
        truncated: false,
      },
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
  description: "Which model should the next turn use?",
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

const FAKE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/** One second of generated test video, so media previews have real bytes. */
const FAKE_MP4 = Buffer.from(
  "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAOybW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAA+gAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAt10cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAA+gAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAPoAAAIAAABAAAAAAJVbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAAKABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACAG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAcBzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMiBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqs2UKN+TARAAADAAEAAAMAFA8SJZYBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAbmAAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAoAAAQAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAABgY3R0cwAAAAAAAAAKAAAAAQAACAAAAAABAAAUAAAAAAEAAAgAAAAAAQAAAAAAAAABAAAEAAAAAAEAABQAAAAAAQAACAAAAAABAAAAAAAAAAEAAAQAAAAAAQAACAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAoAAAABAAAAPHN0c3oAAAAAAAAAAAAAAAoAAAkrAAABvwAAAD0AAAAXAAAAGQAAAYgAAABTAAAAGwAAABsAAABkAAAAFHN0Y28AAAAAAAAAAQAAA+IAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYzLjEuMTAyAAAACGZyZWUAAA3UbWRhdAAAAq4GBf//qtxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0zIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj0xMCBzY2VuZWN1dD00MCBpbnRyYV9yZWZyZXNoPTAgcmNfbG9va2FoZWFkPTQwIHJjPWNyZiBtYnRyZWU9MSBjcmY9MjMuMCBxY29tcD0wLjYwIHFwbWluPTAgcXBtYXg9NjkgcXBzdGVwPTQgaXBfcmF0aW89MS40MCBhcT0xOjEuMDAAgAAABnVliIQAEf/+94gfMstvmCsfGVuCcQA4xJm6RyG0k5oqRdM/esR6ywOBzmjGTfQwaZKxVUCQhTWLZaQ3MkRx/5TVwoeXYx/WFSPE7BwNr2R2z8GcvijkQ4yxg2lszO2Hy8WX6zzm56bkj0+pCfllLeBi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",
  "base64",
);

/** Session-directory files served by the fake `/api/fs/read/` endpoint. */
const FAKE_FILES: Record<string, { type: string; body: string | Buffer }> = {
  "/home/me/oktoso/notes/plan.md": {
    type: "text/markdown",
    body: "# Plan\n\n- book the train\n- pack layers\n",
  },
  "/home/me/oktoso/auth.ts": {
    type: "text/plain",
    body: "export const token = 'fake';\n",
  },
  "/home/me/oktoso/plots/chart.png": {
    type: "image/png",
    body: FAKE_PNG,
  },
  "/home/me/oktoso/reports/report.html": {
    type: "text/html",
    body: "<!doctype html><title>Report</title><h1>Fake report</h1>",
  },
  "/home/me/oktoso/clips/race.mp4": {
    type: "video/mp4",
    body: FAKE_MP4,
  },
};

OPENCODE_MESSAGES["ses_child_demo"] = [];

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
  models?: string[];
  files?: unknown[];
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
  folder_id?: string | null;
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
  folder_id?: string;
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
    folder_id: options.folder_id ?? null,
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

function makeFakeOwuiBranchChat(): FakeOwuiChat {
  const now = Math.floor(Date.now() / 1000);
  const user = "branch-user";
  const first = "branch-assistant-1";
  const second = "branch-assistant-2";
  const followFirst = "branch-follow-1";
  const answerFirst = "branch-answer-1";
  const followSecond = "branch-follow-2";
  const answerSecond = "branch-answer-2";
  return {
    id: "chat_fake_branches",
    title: "Fake Open WebUI branches",
    created_at: now - 300,
    updated_at: now,
    last_read_at: 0,
    active: false,
    folder_id: "folder_deep",
    chat: {
      title: "Fake Open WebUI branches",
      models: ["fake-model"],
      history: {
        currentId: answerSecond,
        messages: {
          [user]: {
            id: user,
            role: "user",
            content: "Show me two alternatives.",
            parentId: null,
            childrenIds: [first, second],
            timestamp: now - 7,
          },
          [first]: {
            id: first,
            role: "assistant",
            content: "Alternative one.",
            parentId: user,
            childrenIds: [followFirst],
            timestamp: now - 6,
            model: "fake-model",
            done: true,
          },
          [followFirst]: {
            id: followFirst,
            role: "user",
            content: "Continue alternative one.",
            parentId: first,
            childrenIds: [answerFirst],
            timestamp: now - 5,
            models: ["fake-model"],
            files: [],
          },
          [answerFirst]: {
            id: answerFirst,
            role: "assistant",
            content: "Answer one.",
            parentId: followFirst,
            childrenIds: [],
            timestamp: now - 4,
            model: "fake-model",
            done: true,
          },
          [second]: {
            id: second,
            role: "assistant",
            content: "Alternative two.",
            parentId: user,
            childrenIds: [followSecond],
            timestamp: now - 3,
            model: "fake-model",
            done: true,
          },
          [followSecond]: {
            id: followSecond,
            role: "user",
            content: "Continue alternative two.",
            parentId: second,
            childrenIds: [answerSecond],
            timestamp: now - 2,
            models: ["fake-model"],
            files: [],
          },
          [answerSecond]: {
            id: answerSecond,
            role: "assistant",
            content: "Answer two.",
            parentId: followSecond,
            childrenIds: [],
            timestamp: now - 1,
            model: "fake-model",
            done: true,
          },
        },
      },
    },
  };
}

const OWUI_FOLDERS = [
  { id: "folder_research", name: "Research", parent_id: null },
  { id: "folder_deep", name: "Deep Research", parent_id: "folder_research" },
];

const OWUI_CHATS = new Map<string, FakeOwuiChat>([
  ["chat_fake_branches", makeFakeOwuiBranchChat()],
  [
    "chat_fake_openwebui",
    makeFakeOwuiChat({
      id: "chat_fake_openwebui",
      title: "Fake Open WebUI chat",
      assistantContent: "Fake Open WebUI reply.",
      folder_id: "folder_research",
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
      data: [
        { id: "build", name: "Build", mode: "primary", hidden: false },
        { id: "plan", name: "Plan", mode: "primary", hidden: false },
        { id: "explore", name: "Explore", mode: "subagent", hidden: false },
      ],
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
          type: "chat",
          enabled: true,
          variants: [{ id: "max" }, { id: "high" }],
        },
      ],
      location: { directory: "/home/me/oktoso" },
    });
    return;
  }
  const switchAgentMatch = path.match(/^\/api\/session\/([^/]+)\/agent$/);
  if (switchAgentMatch && request.method === "POST") {
    const session = OPENCODE_SESSIONS.find((item) => item.id === switchAgentMatch[1]);
    if (!session) {
      sendJson(response, 404, { _tag: "SessionNotFoundError", message: "Session not found" });
      return;
    }
    const body = await readBody(request);
    if (typeof body.agent !== "string" || !body.agent) {
      sendJson(response, 400, { _tag: "InvalidRequestError", message: "agent is required" });
      return;
    }
    session.agent = body.agent;
    broadcastEvent("session.updated", { sessionID: session.id });
    response.writeHead(204);
    response.end();
    return;
  }
  const switchModelMatch = path.match(/^\/api\/session\/([^/]+)\/model$/);
  if (switchModelMatch && request.method === "POST") {
    const session = OPENCODE_SESSIONS.find((item) => item.id === switchModelMatch[1]);
    if (!session) {
      sendJson(response, 404, { _tag: "SessionNotFoundError", message: "Session not found" });
      return;
    }
    const body = await readBody(request);
    const model = body.model && typeof body.model === "object"
      ? (body.model as { id?: unknown; providerID?: unknown; variant?: unknown })
      : undefined;
    if (typeof model?.id !== "string" || typeof model.providerID !== "string") {
      sendJson(response, 400, { _tag: "InvalidRequestError", message: "model is required" });
      return;
    }
    session.model = {
      id: model.id,
      providerID: model.providerID,
      ...(typeof model.variant === "string" ? { variant: model.variant } : {}),
    };
    broadcastEvent("session.updated", { sessionID: session.id });
    response.writeHead(204);
    response.end();
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
  if (path.startsWith("/api/fs/read/")) {
    const requested = decodeURIComponent(path.slice("/api/fs/read/".length));
    const directory = url.searchParams.get("location[directory]") ?? "";
    const segments = requested.split("/").filter((segment) => segment && segment !== ".");
    if (!directory || segments.length === 0 || segments.includes("..")) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }
    const file = FAKE_FILES[`${directory}/${segments.join("/")}`];
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": file.type,
      "content-disposition": `attachment; filename="${segments.at(-1)}"`,
    });
    response.end(file.body);
    return;
  }
  if (path.startsWith("/api/files/")) {
    const name = path.split("/").at(-1) || "attachment";
    if (name.endsWith(".txt")) {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": `inline; filename="${name}"`,
      });
      response.end("fake attachment");
      return;
    }
    response.writeHead(200, {
      "content-type": "image/png",
      "content-disposition": `inline; filename="${name}"`,
    });
    response.end(FAKE_PNG);
    return;
  }
  if (path === "/api/info") {
    sendJson(response, 200, { version: "0.0.0-fake-opencode" });
    return;
  }
  if (path === "/api/session") {
    const search = (url.searchParams.get("search") ?? "").trim().toLowerCase();
    const source = search
      ? [...OPENCODE_SESSIONS, ...OPENCODE_ARCHIVED_SESSIONS]
      : OPENCODE_SESSIONS;
    const rows = search
      ? source.filter((session) =>
          [
            session.title,
            session.projectID,
            session.agent,
            session.location.directory,
          ]
            .join(" ")
            .toLowerCase()
            .includes(search),
        )
      : source;
    sendJson(response, 200, page(rows, url));
    return;
  }
  const forkMatch = path.match(/^\/api\/session\/([^/]+)\/fork$/);
  if (forkMatch && request.method === "POST") {
    const source = OPENCODE_SESSIONS.find(
      (item) => item.id === forkMatch[1],
    );
    if (!source) {
      sendJson(response, 404, {
        _tag: "SessionNotFoundError",
        message: "Session not found",
      });
      return;
    }
    const body = await readBody(request);
    const before = typeof body.before === "string" ? body.before : undefined;
    const sourceMessages = OPENCODE_MESSAGES[source.id] ?? [];
    const beforeIndex = before
      ? sourceMessages.findIndex((message) => message.id === before)
      : -1;
    if (before && beforeIndex === -1) {
      sendJson(response, 404, {
        _tag: "MessageNotFoundError",
        message: "Message not found",
      });
      return;
    }
    const now = Date.now();
    const id = `ses_fake_fork_${now.toString(36)}`;
    const child: FakeOpenCodeSession = {
      ...source,
      id,
      parentID: source.id,
      title: `${source.title} (fork)`,
      time: { created: now, updated: now },
    };
    OPENCODE_SESSIONS.unshift(child);
    OPENCODE_MESSAGES[id] = sourceMessages
      .slice(0, before ? beforeIndex : sourceMessages.length)
      .map((message) => ({ ...message }));
    broadcastEvent("session.created", { sessionID: id });
    sendJson(response, 200, { data: child });
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
    // A child session that is not in the list, so the subagent tile can show a
    // live child without changing the session-list fixtures.
    const session =
      sessionMatch[1] === "ses_child_demo"
        ? {
            id: "ses_child_demo",
            projectID: "project-oktoso",
            agent: "general",
            model: { id: "claude-sonnet", providerID: "commandcode" },
            cost: 0,
            tokens: {
              input: 0,
              output: 0,
              reasoning: 0,
              cache: { read: 0, write: 0 },
            },
            time: {
              created: 1_792_970_000_000,
              updated: 1_792_970_000_000,
              busy: 1_792_970_000_000,
            },
            title: "Check the refresh fix",
            location: { directory: "/home/me/oktoso" },
          }
        : OPENCODE_SESSIONS.find((item) => item.id === sessionMatch[1]);
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
    const files = Array.isArray(body.files)
      ? body.files.map((entry) => {
          const file =
            entry && typeof entry === "object"
              ? (entry as Record<string, unknown>)
              : {};
          const uri = typeof file.uri === "string" ? file.uri : "";
          const match = /^data:([^;]+);base64,(.*)$/.exec(uri);
          return {
            data: match?.[2] ?? "",
            mime: match?.[1] ?? "application/octet-stream",
            source: { type: "inline" },
            name: typeof file.name === "string" ? file.name : "Attachment",
          };
        })
      : [];
    const now = Date.now();
    const userID = `msg_fake_${now.toString(36)}`;
    messages.push({
      id: userID,
      type: "user",
      time: { created: now },
      text,
      files,
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
      session.time.busy = now;
      session.time.updated = now;
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
        files,
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
      if (session) {
        session.time.updated = now + 2;
        session.time.idle = now + 2;
        session.time.busy = undefined;
        session.outcome = "succeeded";
      }
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
  if (path === "/api/v1/folders/" && request.method === "GET") {
    sendJson(response, 200, OWUI_FOLDERS);
    return;
  }
  if (path === "/api/v1/files/" && request.method === "POST") {
    for await (const _chunk of request) {
      // Drain the multipart body; the fake only needs to issue an id.
    }
    sendJson(response, 200, {
      id: `file_fake_${Date.now().toString(36)}`,
      filename: "upload",
    });
    return;
  }
  if (
    path.match(/^\/api\/v1\/files\/[^/]+\/process\/status$/) &&
    request.method === "GET"
  ) {
    sendJson(response, 200, { status: "completed" });
    return;
  }
  if (path === "/api/v1/models") {
    sendJson(response, 200, {
      data: [
        { id: "fake-model", name: "Fake Model" },
        { id: "fake-model-2", name: "Fake Model 2" },
      ],
    });
    return;
  }
  if (path === "/api/config") {
    sendJson(response, 200, { name: "Open WebUI", version: "0.0.0-fake-openwebui" });
    return;
  }
  const folderChatsMatch = path.match(
    /^\/api\/v1\/chats\/folder\/([^/]+)\/list$/,
  );
  if (folderChatsMatch && request.method === "GET") {
    const folderID = folderChatsMatch[1] ?? "";
    const rows = sortedOwuiChats()
      .filter((chat) => chat.folder_id === folderID)
      .map(owuiSummary);
    sendJson(response, 200, rows);
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
