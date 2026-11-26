import { describe, expect, it } from "vitest";
import type {
  AssistantEvent,
  AssistantRunAccepted,
  AttentionPage,
  Message,
  MessagePage,
  QuestionPrompt,
  Session,
} from "@amoshydra/oktoso-contracts";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { AssistantService, renderContext } from "./assistant-service";
import type { HandoffService } from "./handoff-service";
import { createSecretBox } from "../lib/secret-box";
import { McpTokenService } from "../mcp/tokens";
import type { AttentionService } from "./attention-service";
import type { SessionActions } from "./session-actions";
import type { QuestionService } from "./question-service";
import type { SessionService } from "./session-service";
import type { Logger } from "../lib/logger";

const session: Session = {
  ref: "desktop-opencode:ses_a",
  providerID: "desktop-opencode",
  nativeID: "ses_a",
  title: "Fix the build",
  project: "hub",
  directory: "/repo",
  agent: "build",
  model: "some/model",
  status: "running",
  unread: true,
  updatedAt: Date.UTC(2026, 10, 20, 9, 0),
  createdAt: Date.UTC(2026, 10, 19, 9, 0),
  cost: 1.234,
  tokens: { input: 10, output: 20, total: 30 },
};

const messages: Message[] = [
  {
    id: "m1",
    sessionRef: session.ref,
    role: "user",
    createdAt: 1,
    parts: [{ type: "text", text: "the build is red" }],
  },
  {
    id: "m2",
    sessionRef: session.ref,
    role: "assistant",
    createdAt: 2,
    parts: [
      { type: "reasoning", text: "look at the tests" },
      {
        type: "tool",
        id: "t1",
        name: "write",
        status: "completed",
        input: { path: "/repo/src/app.ts" },
      },
      { type: "text", text: "I updated the failing test." },
    ],
  },
];

const attentionPage: AttentionPage = {
  data: [
    {
      id: "a1",
      sessionRef: session.ref,
      type: "unread",
      priority: "normal",
      title: "Fix the build",
      summary: "New activity in hub",
      createdAt: 3,
      actions: [{ id: "mark_read", label: "Mark read" }],
    },
  ],
};

const question: QuestionPrompt = {
  sessionRef: session.ref,
  messageId: "m3",
  revision: "r1",
  askedAt: 4,
  generatedAt: 4,
  questions: [
    {
      id: "q1",
      text: "Allow running pnpm test?",
      kind: "boolean",
      choices: [
        {
          id: "yes",
          label: "Allow",
          text: "Allow running pnpm test in /repo",
          kind: "boolean",
          source: "explicit",
        },
        {
          id: "no",
          label: "Deny",
          text: "Deny running pnpm test in /repo",
          kind: "boolean",
          source: "explicit",
        },
      ],
      allowsFreeText: false,
      allowsVoice: false,
      multiSelect: false,
      risk: "normal",
      confidence: "high",
      source: "explicit",
    },
  ],
};

function logger(): Logger {
  const noop = () => undefined;
  return {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger(),
  } as unknown as Logger;
}

function fakeSessions(overrides: Partial<SessionService> = {}): SessionService {
  return {
    get: async () => session,
    peek: () => session,
    // The provider contract is newest first; the builder restores reading
    // order, so the fake must reverse too.
    messages: async (): Promise<MessagePage> => ({
      data: [...messages].reverse(),
      cursor: { next: null, previous: null },
    }),
    ...overrides,
  } as unknown as SessionService;
}

/**
 * A paged stand-in for SearchService. Cursors are the numeric offset, which is
 * all the assistant relies on: it passes them back untouched.
 */
function fakeSearch(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ q: string; limit?: number; cursor?: string }> = [];
  const search = {
    calls,
    search: async (query: { q: string; limit?: number; cursor?: string }) => {
      calls.push(query);
      const offset = query.cursor ? Number(query.cursor) : 0;
      const limit = query.limit ?? 20;
      return {
        data: rows.slice(offset, offset + limit),
        cursor: {
          previous: offset > 0 ? String(Math.max(0, offset - limit)) : null,
          next: offset + limit < rows.length ? String(offset + limit) : null,
        },
        ready: true,
        enabled: true,
      };
    },
  };
  return search;
}

function searchRows(count: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, index) => {
    const label = String(index).padStart(2, "0");
    return {
      ref: `desktop-opencode:ses_${label}`,
      title: `Session ${label}`,
      providerID: "desktop-opencode",
      project: "hub",
      updatedAt: 1_000,
      snippet: `needle note ${index}`,
      match: "message",
      score: 1,
      ...overrides,
    };
  });
}

function toolCallStream(id: string, name: string, args: Record<string, unknown>): string[] {
  return [
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id, function: { name, arguments: JSON.stringify(args) } },
            ],
          },
        },
      ],
    })}\n\n`,
    "data: [DONE]\n\n",
  ];
}

function toolCallsStream(
  calls: Array<{ id: string; name: string; args: Record<string, unknown> }>,
): string[] {
  return [
    `data: ${JSON.stringify({
      choices: [
        {
          delta: {
            tool_calls: calls.map((call, index) => ({
              index,
              id: call.id,
              function: { name: call.name, arguments: JSON.stringify(call.args) },
            })),
          },
        },
      ],
    })}\n\n`,
    "data: [DONE]\n\n",
  ];
}

/** One page of a provider transcript, newest first, like the real adapter. */
function transcriptPage(sessionRef: string, end: number, count = 200): Message[] {
  const first = Math.max(1, end - count + 1);
  const data: Message[] = [];
  for (let n = end; n >= first; n -= 1) {
    data.push({
      id: `m${n}`,
      sessionRef,
      role: n % 2 === 0 ? "assistant" : "user",
      createdAt: n,
      parts: [{ type: "text", text: `message ${n}` }],
    });
  }
  return data;
}

/** A provider split into newest-first pages; `calls` records paged reads. */
function pagedProvider(pages: Message[][], calls: string[]) {
  return async (
    _ref: string,
    query: { limit?: number; cursor?: string },
  ): Promise<MessagePage> => {
    if (query.limit !== 200) {
      return { data: [], cursor: { next: null, previous: null } };
    }
    const index = query.cursor ? Number(query.cursor) : 0;
    calls.push(query.cursor ?? "first");
    return {
      data: pages[index] ?? [],
      cursor: {
        next: index + 1 < pages.length ? String(index + 1) : null,
        previous: index > 0 ? String(index - 1) : null,
      },
    };
  };
}

/** A provider that never reaches its oldest page. */
function endlessProvider(calls: string[], text: (n: number) => string) {
  return async (
    _ref: string,
    query: { limit?: number; cursor?: string },
  ): Promise<MessagePage> => {
    if (query.limit !== 200) {
      return { data: [], cursor: { next: null, previous: null } };
    }
    const index = query.cursor ? Number(query.cursor) : 0;
    calls.push(query.cursor ?? "first");
    const end = 1_000_000 - index * 200;
    const data: Message[] = [];
    for (let n = end; n > end - 200; n -= 1) {
      data.push({
        id: `m${n}`,
        sessionRef: session.ref,
        role: "assistant",
        createdAt: n,
        parts: [{ type: "text", text: text(n) }],
      });
    }
    return {
      data,
      cursor: { next: String(index + 1), previous: null },
    };
  };
}

function buildSession(
  fetchImpl: typeof fetch,
  provider: SessionService["messages"],
) {
  return new AssistantService({
    store: new MemoryStateStore(),
    sessions: fakeSessions({ messages: provider }),
    actions: { send: async () => ({}) } as unknown as SessionActions,
    attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
    questions: { get: async () => null } as unknown as QuestionService,
    logger: logger(),
    settings: {
      enabled: true,
      baseUrl: "http://model.test/v1",
      model: "test-model",
      timeoutMs: 5_000,
      maxContextMessages: 20,
    },
    fetchImpl,
  });
}

function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: { "content-type": "text/event-stream" },
  });
}

function delta(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

function build(fetchImpl: typeof fetch, overrides: {
  maxContextMessages?: number;
  allowWrite?: boolean;
  apiKey?: string;
} = {}) {
  const store = new MemoryStateStore();
  const audits: Array<Record<string, unknown>> = [];
  const sent: Array<{ ref: string; input: Record<string, unknown>; key?: string }> = [];
  const actions = {
    send: async (ref: string, input: Record<string, unknown>, key?: string) => {
      sent.push({ ref, input, key });
      return { accepted: true, messageId: "sent" };
    },
  } as unknown as SessionActions;
  const service = new AssistantService({
    store,
    sessions: fakeSessions(),
    actions,
    attention: {
      list: async () => attentionPage,
    } as unknown as AttentionService,
    questions: {
      get: async () => question,
    } as unknown as QuestionService,
    logger: logger(),
    audit: (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
    settings: {
      enabled: true,
      baseUrl: "http://model.test/v1",
      model: "test-model",
      timeoutMs: 5_000,
      maxContextMessages: overrides.maxContextMessages ?? 20,
      allowWrite: overrides.allowWrite ?? false,
      ...(overrides.apiKey ? { apiKey: overrides.apiKey } : {}),
    },
    fetchImpl,
  });
  return { service, store, sent, audits };
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("timed out waiting for the run");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("AssistantService gateway auth", () => {
  it("sends the configured key to the model and the model list", async () => {
    const seen: Array<{ url: string; auth?: string }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const auth = (init.headers as Record<string, string> | undefined)?.Authorization;
      seen.push({ url: String(url), auth });
      if (String(url).endsWith("/models")) {
        return new Response(JSON.stringify({ data: [{ id: "test-model" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const { service } = build(fetchImpl, { apiKey: "gateway-key" });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: "desktop-opencode:ses_a" },
    });
    const accepted = await service.postMessage(thread.id, { text: "hi" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    await service.listModels();

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen.every((entry) => entry.auth === "Bearer gateway-key")).toBe(true);
  });
});

describe("AssistantService", () => {
  const projectSessions: Session[] = [
    {
      ...session,
      ref: "desktop-opencode:ses_a",
      nativeID: "ses_a",
      title: "Fix the build",
      project: "hub",
      status: "running",
      unread: false,
      cost: 1.2,
    },
    {
      ...session,
      ref: "desktop-opencode:ses_b",
      nativeID: "ses_b",
      title: "Plan the release",
      project: "hub",
      status: "idle",
      unread: true,
      cost: 0.4,
    },
    {
      ...session,
      ref: "desktop-opencode:ses_c",
      nativeID: "ses_c",
      title: "Trip notes",
      project: "atlas",
      status: "idle",
      unread: true,
      cost: 0,
    },
  ];
  const projectAttention: AttentionPage = {
    data: [
      {
        id: "a-b",
        sessionRef: "desktop-opencode:ses_b",
        type: "unread",
        priority: "normal",
        title: "Plan the release",
        summary: "New activity in hub",
        createdAt: 3,
        actions: [],
      },
      {
        id: "a-c",
        sessionRef: "desktop-opencode:ses_c",
        type: "unread",
        priority: "normal",
        title: "Trip notes",
        summary: "New activity in atlas",
        createdAt: 4,
        actions: [],
      },
    ],
  };

  function buildScoped(
    fetchImpl: typeof fetch,
    allowWrite = true,
    search?: unknown,
    sessions: Session[] = projectSessions,
    mcpTokens?: McpTokenService,
  ) {
    return new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions({
        list: async (query: { project?: string }) => ({
          data: sessions.filter(
            (entry) => !query.project || entry.project === query.project,
          ),
          cursor: { next: null, previous: null },
        }),
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => projectAttention } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      ...(search ? { search: search as never } : {}),
      ...(mcpTokens ? { mcpTokens } : {}),
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
        allowWrite,
      },
      fetchImpl,
    });
  }

  it("creates and reveals a token in the owner thread", async () => {
    const tokens = new McpTokenService({
      secretBox: createSecretBox("hub-token-long-enough"),
    });
    const bodies: Array<{
      messages: Array<{ role: string; content: string | null }>;
    }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        messages: Array<{ role: string; content: string | null }>;
      };
      bodies.push(body);
      if (round === 0) {
        round += 1;
        return sseResponse(
          toolCallStream("call_1", "create_mcp_token", {
            ttlSeconds: 120,
            providers: ["desktop-opencode"],
          }),
        );
      }
      if (round === 1) {
        const tool = body.messages.filter((message) => message.role === "tool").at(-1);
        const id = /id: (mcp_\S+)/.exec(tool?.content ?? "")?.[1];
        const token = /okt_mcp_\S+/.exec(tool?.content ?? "")?.[0];
        expect(id).toBeTruthy();
        expect(token).toBeTruthy();
        round += 1;
        return sseResponse([
          delta(
            `Created ${id}.\n\n\`\`\`sh\nexport OKTOSO_MCP_TOKEN=${token}\n\`\`\``,
          ),
          "data: [DONE]\n\n",
        ]);
      }
      if (round === 2) {
        const history = body.messages
          .map((message) => message.content ?? "")
          .join("\n");
        expect(history).not.toContain("okt_mcp_");
        expect(history).toContain("[redacted mcp token");
        const id = /\bmcp_[A-Za-z0-9_-]{8,}\b/.exec(history)?.[0];
        expect(id).toBeTruthy();
        round += 1;
        return sseResponse(
          toolCallStream("call_2", "reveal_mcp_token", { id }),
        );
      }
      const tool = body.messages.filter((message) => message.role === "tool").at(-1);
      expect(tool?.content).toContain("okt_mcp_");
      round += 1;
      return sseResponse([delta("Revealed."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const service = buildScoped(
      fetchImpl,
      true,
      undefined,
      projectSessions,
      tokens,
    );
    const thread = await service.createThread({ scope: { kind: "global" } });

    const created = await service.postMessage(
      thread.id,
      { text: "create a read-only token for this session" },
      { owner: true },
    );
    const createdEvents: AssistantEvent[] = [];
    service.subscribe(created.run.id, 0, (event) => createdEvents.push(event));
    await waitFor(() => createdEvents.some((event) => event.type === "done"));
    const [issued] = tokens.list();
    expect(issued).toBeDefined();

    const revealed = await service.postMessage(
      thread.id,
      { text: "show me the token again" },
      { owner: true },
    );
    const revealedEvents: AssistantEvent[] = [];
    service.subscribe(revealed.run.id, 0, (event) => revealedEvents.push(event));
    await waitFor(() => revealedEvents.some((event) => event.type === "done"));
    expect(tokens.list()).toHaveLength(1);
    expect(bodies.length).toBeGreaterThanOrEqual(4);
  });

  it("offers MCP token tools only to the owner", async () => {
    const tokens = new McpTokenService({
      secretBox: createSecretBox("hub-token-long-enough"),
    });
    const seen: string[][] = [];
    const prompts: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        messages?: Array<{ role?: string; content?: string }>;
        tools?: Array<{ function?: { name?: string } }>;
      };
      prompts.push(
        body.messages?.find((message) => message.role === "system")?.content ?? "",
      );
      seen.push(
        (body.tools ?? [])
          .map((tool) => tool.function?.name)
          .filter((name): name is string => typeof name === "string"),
      );
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const service = buildScoped(
      fetchImpl,
      true,
      undefined,
      projectSessions,
      tokens,
    );

    const thread = await service.createThread({ scope: { kind: "global" } });
    const ownerTurn = await service.postMessage(
      thread.id,
      { text: "create a read-only token for this session" },
      { owner: true },
    );
    const ownerEvents: AssistantEvent[] = [];
    service.subscribe(ownerTurn.run.id, 0, (event) => ownerEvents.push(event));
    await waitFor(() => ownerEvents.some((event) => event.type === "done"));
    expect(seen[0]).toContain("create_mcp_token");
    expect(seen[0]).toContain("list_mcp_tokens");
    expect(seen[0]).toContain("reveal_mcp_token");
    expect(prompts[0]).toContain("You can create, list, and reveal");

    const pairedThread = await service.createThread({ scope: { kind: "global" } });
    const pairedTurn = await service.postMessage(
      pairedThread.id,
      { text: "create a token" },
      { owner: false },
    );
    const pairedEvents: AssistantEvent[] = [];
    service.subscribe(pairedTurn.run.id, 0, (event) => pairedEvents.push(event));
    await waitFor(() => pairedEvents.some((event) => event.type === "done"));
    expect(seen[1]).not.toContain("create_mcp_token");
    expect(seen[1]).not.toContain("reveal_mcp_token");
    expect(prompts[1]).toContain("MCP token administration is unavailable");

    const sessionThread = await service.createThread({
      scope: { kind: "session", sessionRef: "desktop-opencode:ses_a" },
    });
    const sessionTurn = await service.postMessage(
      sessionThread.id,
      { text: "create a token" },
      { owner: true },
    );
    const sessionEvents: AssistantEvent[] = [];
    service.subscribe(sessionTurn.run.id, 0, (event) => sessionEvents.push(event));
    await waitFor(() => sessionEvents.some((event) => event.type === "done"));
    expect(seen[2]).not.toContain("create_mcp_token");
    expect(prompts[2]).toContain("MCP token administration is unavailable");
  });

  it("builds a project context from session metadata only", async () => {
    let body: {
      messages: Array<{ role: string; content: string }>;
      tools?: unknown;
    } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const service = buildScoped(fetchImpl);
    const thread = await service.createThread({
      scope: { kind: "project", project: "hub" },
    });
    expect(thread.title).toBe("hub");

    const accepted = await service.postMessage(thread.id, { text: "what should I pick up?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("PROJECT (hub facts)");
    expect(prompt).toContain("name: hub");
    expect(prompt).toContain("Fix the build");
    expect(prompt).toContain("Plan the release");
    expect(prompt).not.toContain("Trip notes");
    expect(prompt).not.toContain("TRANSCRIPT");
    expect(prompt).toContain("Plan the release");
    expect(prompt).toContain("New activity in hub");
    expect(prompt).not.toContain("New activity in atlas");
    expect(body.tools).toBeDefined();
    // A project thread gets session-scoped tools, not the single-transcript
    // ones: every read names its session.
    const toolNames = JSON.stringify(body.tools);
    expect(toolNames).toContain("search_transcript");
    expect(toolNames).toContain("read_session_turns");
    expect(toolNames).toContain("list_sessions");
    expect(toolNames).not.toContain('"read_turns"');

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context?.sessions).toBe(2);
    expect(done.turn.context?.messages).toBe(0);
  });

  it("reads a session's transcript through tools from a project thread", async () => {
    const bodies: Array<{
      messages: Array<{ role: string; content: string | null }>;
      tools?: Array<{ function: { name: string } }>;
    }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse([
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: {
                        name: "read_session_turns",
                        arguments: JSON.stringify({
                          sessionRef: "desktop-opencode:ses_a",
                          from: 1,
                          to: 2,
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ]);
      }
      return sseResponse([delta("The build broke in turn 1."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const service = buildScoped(fetchImpl);
    const thread = await service.createThread({
      scope: { kind: "project", project: "hub" },
    });
    const accepted = await service.postMessage(thread.id, { text: "why is the build red?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessage = bodies[1]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).toContain("SESSION Fix the build");
    expect(toolMessage?.content).toContain("TURN 1");
    expect(toolMessage?.content).toContain("the build is red");
    expect(toolMessage?.content).toContain("[tool write · completed]");

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context?.toolCalls).toBe(1);
    expect(done.turn.context?.messages).toBe(2);
    expect(
      done.turn.activity?.some(
        (step) => step.kind === "tool" && step.label === "Read turns 1–2",
      ),
    ).toBe(true);
  });

  it("refuses a session outside the project thread's scope", async () => {
    const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse([
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: {
                        name: "read_session_turns",
                        arguments: JSON.stringify({
                          sessionRef: "desktop-opencode:ses_c",
                          from: 1,
                          to: 2,
                        }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ]);
      }
      return sseResponse([delta("That session is outside this thread."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const service = buildScoped(fetchImpl);
    const thread = await service.createThread({
      scope: { kind: "project", project: "hub" },
    });
    const accepted = await service.postMessage(thread.id, { text: "read the trip notes" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessage = bodies[1]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).toContain("outside this thread's scope");
    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context?.messages).toBe(0);
  });

  it("pages past the first ten cross-session hits to find a later session", async () => {
    const sessions: Session[] = Array.from({ length: 14 }, (_, index) => {
      const label = String(index).padStart(2, "0");
      return {
        ...session,
        ref: `desktop-opencode:ses_${label}`,
        nativeID: `ses_${label}`,
        title: `Session ${label}`,
        project: "hub",
        status: "idle",
      };
    });
    const search = fakeSearch(searchRows(14));
    const bodies: Array<{
      messages: Array<{ role: string; content: string | null }>;
    }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallStream("call_1", "search_transcript", {
            query: "needle",
            limit: 10,
          }),
        );
      }
      if (round === 2) {
        return sseResponse(
          toolCallStream("call_2", "search_transcript", {
            query: "needle",
            offset: 10,
            limit: 10,
          }),
        );
      }
      return sseResponse([delta("Session 10 has the note."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildScoped(fetchImpl, false, search, sessions);
    const thread = await service.createThread({ scope: { kind: "global" } });
    const accepted = await service.postMessage(thread.id, {
      text: "where is the needle note?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    // The opening block lists five of fourteen and says the rest exist.
    const prompt = bodies[0]?.messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("showing 5 of 14 matches — more available");

    const toolMessages =
      bodies[2]?.messages.filter((message) => message.role === "tool") ?? [];
    // Page one stops at ten and names the next offset.
    expect(toolMessages[0]?.content).toContain("matches 1–10 of 14");
    expect(toolMessages[0]?.content).toContain("more available — call again with offset 10");
    expect(toolMessages[0]?.content).not.toContain("[desktop-opencode:ses_10]");

    // Page two reaches the session ranked eleventh and closes the list.
    expect(toolMessages[1]?.content).toContain("matches 11–14 of 14");
    expect(toolMessages[1]?.content).toContain("[desktop-opencode:ses_10]");
    expect(toolMessages[1]?.content).toContain("no more results");

    // The gap was a fixed first page; the index is now asked for a pool.
    expect(search.calls.some((call) => (call.limit ?? 0) > 10)).toBe(true);

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.text).toBe("Session 10 has the note.");
  });

  it("orders cross-session ties by title hit, then recency", async () => {
    const sessions: Session[] = ["a", "b", "c"].map((letter) => ({
      ...session,
      ref: `desktop-opencode:ses_${letter}`,
      nativeID: `ses_${letter}`,
      title: `Session ${letter}`,
      project: "hub",
      status: "idle",
    }));
    const search = fakeSearch([
      {
        ref: "desktop-opencode:ses_a",
        title: "Session a",
        providerID: "desktop-opencode",
        updatedAt: 3_000,
        snippet: "needle in a body",
        match: "message",
        score: 1,
      },
      {
        ref: "desktop-opencode:ses_b",
        title: "Needle in a title",
        providerID: "desktop-opencode",
        updatedAt: 1_000,
        snippet: "Session b",
        match: "session",
        score: 1,
      },
      {
        ref: "desktop-opencode:ses_c",
        title: "Session c",
        providerID: "desktop-opencode",
        updatedAt: 5_000,
        snippet: "needle in a newer body",
        match: "message",
        score: 1,
      },
    ]);
    let round = 0;
    const bodies: Array<{
      messages: Array<{ role: string; content: string | null }>;
    }> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallStream("call_1", "search_transcript", {
            query: "needle",
            limit: 20,
          }),
        );
      }
      return sseResponse([delta("Ordered the hits."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildScoped(fetchImpl, false, search, sessions);
    const thread = await service.createThread({ scope: { kind: "global" } });
    const accepted = await service.postMessage(thread.id, {
      text: "where is the needle note?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessage = bodies[1]?.messages.find((message) => message.role === "tool");
    const text = toolMessage?.content ?? "";
    // Equal scores: the title hit leads, then the newer body, then the older.
    expect(text.indexOf("ses_b")).toBeLessThan(text.indexOf("ses_c"));
    expect(text.indexOf("ses_c")).toBeLessThan(text.indexOf("ses_a"));
  });

  it("says a cross-session search is complete instead of implying more", async () => {
    const sessions: Session[] = [
      {
        ...session,
        ref: "desktop-opencode:ses_00",
        nativeID: "ses_00",
        title: "Session 00",
        project: "hub",
        status: "idle",
      },
    ];
    const search = fakeSearch(searchRows(1));
    const bodies: Array<{
      messages: Array<{ role: string; content: string | null }>;
    }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallStream("call_1", "search_transcript", { query: "needle" }),
        );
      }
      return sseResponse([delta("Only Session 0 has the note."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildScoped(fetchImpl, false, search, sessions);
    const thread = await service.createThread({ scope: { kind: "global" } });
    const accepted = await service.postMessage(thread.id, {
      text: "where is the needle note?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessage = bodies[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("matches 1–1 of 1");
    expect(toolMessage?.content).toContain("no more results");
    expect(toolMessage?.content).not.toContain("more available");

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(
      done.turn.activity?.some(
        (step) => step.kind === "tool" && step.detail?.includes("1 of 1"),
      ),
    ).toBe(true);
  });

  it("keeps the three-session budget on cross-session reads", async () => {
    const refs = ["a", "b", "c", "d"].map((letter) => `desktop-opencode:ses_${letter}`);
    const sessions: Session[] = refs.map((ref) => ({
      ...session,
      ref,
      nativeID: ref.split(":")[1]!,
      title: `Session ${ref.split("_")[1]}`,
      project: "hub",
      status: "idle",
    }));
    const bodies: Array<{
      messages: Array<{ role: string; content: string | null }>;
    }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallsStream(
            refs.slice(0, 3).map((ref, index) => ({
              id: `call_${index}`,
              name: "read_session_turns",
              args: { sessionRef: ref, from: 1, to: 1 },
            })),
          ),
        );
      }
      if (round === 2) {
        return sseResponse(
          toolCallStream("call_4", "read_session_turns", {
            sessionRef: refs[3],
            from: 1,
            to: 1,
          }),
        );
      }
      return sseResponse([delta("Read three sessions."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildScoped(fetchImpl, false, undefined, sessions);
    const thread = await service.createThread({ scope: { kind: "global" } });
    const accepted = await service.postMessage(thread.id, {
      text: "read all four sessions",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessages =
      bodies[2]?.messages.filter((message) => message.role === "tool") ?? [];
    expect(toolMessages).toHaveLength(4);
    expect(toolMessages[3]?.content).toContain(
      "session budget reached (3 distinct sessions)",
    );

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context?.messages).toBe(3);
  });

  it("keeps the per-result and per-run caps on a cross-session search", async () => {
    const sessions: Session[] = Array.from({ length: 60 }, (_, index) => ({
      ...session,
      ref: `desktop-opencode:ses_${index}`,
      nativeID: `ses_${index}`,
      title: `Session ${index}`,
      project: "hub",
      status: "idle",
    }));
    const search = fakeSearch(
      searchRows(60, {
        title: `${"Long session title ".repeat(10)}`,
        snippet: `needle ${"x".repeat(500)}`,
      }),
    );
    const bodies: Array<{
      messages: Array<{ role: string; content: string | null }>;
      tools?: Array<{ function: { name: string } }>;
    }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallsStream(
            [0, 20, 40].map((offset, index) => ({
              id: `call_${index}`,
              name: "search_transcript",
              args: { query: "needle", limit: 20, offset },
            })),
          ),
        );
      }
      return sseResponse([delta("Paged the notes."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildScoped(fetchImpl, false, search, sessions);
    const thread = await service.createThread({ scope: { kind: "global" } });
    const accepted = await service.postMessage(thread.id, {
      text: "where is the needle note?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessages =
      bodies[1]?.messages.filter((message) => message.role === "tool") ?? [];
    expect(toolMessages).toHaveLength(3);
    for (const message of toolMessages) {
      // truncate() keeps the cap and appends one ellipsis character.
      expect(message.content!.length).toBeLessThanOrEqual(6_001);
    }
    expect(
      toolMessages.reduce((total, message) => total + message.content!.length, 0),
    ).toBeLessThanOrEqual(24_000);

    // The per-run budget is spent, so the closing round has no retrieval tools.
    expect(JSON.stringify(bodies[1]?.tools ?? [])).not.toContain("search_transcript");
    expect(
      bodies[1]?.messages.some((message) =>
        message.content?.includes("Stop reading. Answer now"),
      ),
    ).toBe(true);

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context?.toolCalls).toBe(3);
  });

  it("builds a global context from the inbox and running sessions", async () => {
    let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const service = buildScoped(fetchImpl);
    const thread = await service.createThread({ scope: { kind: "global" } });
    expect(thread.title).toBe("All sessions");

    const accepted = await service.postMessage(thread.id, { text: "what needs me?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("GLOBAL (hub facts)");
    expect(prompt).toContain("ATTENTION (the inbox");
    expect(prompt).toContain("Plan the release");
    expect(prompt).toContain("Trip notes");
    expect(prompt).toContain("RUNNING");
    expect(prompt).not.toContain("SESSIONS (metadata only");
    const system =
      body.messages.find((message) => message.role === "system")?.content ?? "";
    expect(system).toContain("list exactly those items");

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context).toMatchObject({ scope: "global", running: 1 });
    expect(done.turn.context?.sessions).toBeUndefined();
  });

  it("finds a session by search and ref, then sends to it after confirmation", async () => {
    const searchPage = {
      data: [
        {
          ref: "desktop-opencode:ses_a",
          title: "Fix the build",
          providerID: "desktop-opencode",
          updatedAt: Date.now(),
          snippet: "the gpu orchestrator proxy lives here",
          match: "message",
          score: 1,
        },
      ],
      cursor: { next: null, previous: null },
      ready: true,
    };
    const sent: Array<{ ref: string; input: Record<string, unknown> }> = [];
    let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return toolStream({
        kind: "send",
        sessionRef: "desktop-opencode:ses_a",
        text: "Please add search to the global assistant.",
        summary: "Send the improvement request?",
      });
    }) as unknown as typeof fetch;
    const service = new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions({
        list: async (query: { project?: string }) => ({
          data: projectSessions.filter(
            (entry) => !query.project || entry.project === query.project,
          ),
          cursor: { next: null, previous: null },
        }),
      }),
      actions: {
        send: async (ref: string, input: Record<string, unknown>) => {
          sent.push({ ref, input });
          return { accepted: true, messageId: "m" };
        },
      } as unknown as SessionActions,
      attention: { list: async () => projectAttention } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      search: { search: async () => searchPage } as never,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
        allowWrite: true,
      },
      fetchImpl,
    });
    const thread = await service.createThread({ scope: { kind: "global" } });
    const accepted = await service.postMessage(thread.id, {
      text: "which agent works on gpu orchestrator? prompt this session http://127.0.0.1:4096/sessions/desktop-opencode%3Ases_a",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("SEARCH (transcript hits");
    expect(prompt).toContain("gpu orchestrator proxy");
    expect(prompt).toContain("TARGET SESSION [desktop-opencode:ses_a]");

    const action = events.find((event) => event.type === "action");
    if (action?.type !== "action") throw new Error("no action event");
    expect(action.turn.action).toMatchObject({
      kind: "send",
      status: "pending",
      sessionRef: "desktop-opencode:ses_a",
      sessionTitle: "Fix the build",
    });

    await service.decide(thread.id, action.turn.id, { decision: "confirm" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.ref).toBe("desktop-opencode:ses_a");
  });

  it("drafts a handoff and sends it after confirmation", async () => {
    const target: Session = {
      ...session,
      ref: "desktop-opencode:ses_b",
      nativeID: "ses_b",
      title: "Ship the fix",
    };
    const proposed: Array<Record<string, unknown>> = [];
    const approved: string[] = [];
    const handoffs = {
      propose: async (input: Record<string, unknown>) => {
        proposed.push(input);
        return { id: "hnd_test", status: "pending" };
      },
      approve: async (id: string) => {
        approved.push(id);
        return { id, status: "sent", receiptQueuedAt: 12_345 };
      },
    } as unknown as HandoffService;
    const fetchImpl = (async () =>
      toolStream({
        kind: "handoff",
        targetRef: target.ref,
        text: "Continue the fix in the other session.",
        reason: "The work moved.",
        evidence: "turn 12",
        summary: "Hand off the fix?",
      })) as unknown as typeof fetch;
    const service = new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions({
        get: async (ref: string) =>
          ref === target.ref ? target : session,
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: {
        list: async () => attentionPage,
      } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      handoffs,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
        allowWrite: true,
      },
      fetchImpl,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, {
      text: "hand this off",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));

    const event = events.find((entry) => entry.type === "action");
    if (event?.type !== "action") throw new Error("no action event");
    expect(event.turn.action).toMatchObject({
      kind: "handoff",
      status: "pending",
      sessionRef: session.ref,
      sourceTitle: session.title,
      targetRef: target.ref,
      targetTitle: target.title,
      reason: "The work moved.",
      evidence: "turn 12",
    });

    await service.decide(thread.id, event.turn.id, {
      decision: "confirm",
      text: "Edited handoff instruction.",
      reason: "Edited reason.",
      evidence: "edited evidence",
    });
    expect(proposed).toEqual([
      {
        sourceRef: session.ref,
        targetRef: target.ref,
        message: "Edited handoff instruction.",
        reason: "Edited reason.",
        evidence: "edited evidence",
      },
    ]);
    expect(approved).toEqual(["hnd_test"]);
    const turn = service.getThread(thread.id).turns[1];
    expect(turn?.action?.status).toBe("done");
    expect(turn?.action?.handoffID).toBe("hnd_test");
    expect(turn?.action?.receiptQueuedAt).toBe(12_345);
  });

  it("refuses a self handoff before it becomes a card", async () => {
    const service = buildScoped((async () =>
      toolStream({
        kind: "handoff",
        targetRef: "desktop-opencode:ses_a",
        text: "Nope",
        summary: "Hand off?",
      })) as unknown as typeof fetch);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: "desktop-opencode:ses_a" },
    });
    const accepted = await service.postMessage(thread.id, { text: "hand off" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const turn = service.getThread(thread.id).turns[1];
    expect(turn?.action?.status).toBe("failed");
    expect(turn?.action?.error).toContain("cannot hand off work to itself");
  });

  it("refuses a global send to a session that is not in context", async () => {
    const service = buildScoped((async () =>
      toolStream({
        kind: "send",
        sessionRef: "desktop-opencode:ses_unknown",
        text: "hi",
        summary: "Send?",
      })) as unknown as typeof fetch);
    const thread = await service.createThread({ scope: { kind: "global" } });
    const accepted = await service.postMessage(thread.id, { text: "send it" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const turn = service.getThread(thread.id).turns[1];
    expect(turn?.action?.status).toBe("failed");
    expect(turn?.action?.error).toContain("sessions in this context");
  });

  it("turns a model 5xx into an actionable message", async () => {
    const service = buildScoped((async () =>
      new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const thread = await service.createThread({ scope: { kind: "global" } });
    const accepted = await service.postMessage(thread.id, { text: "hello" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "error"));
    const turn = service.getThread(thread.id).turns[1];
    expect(turn?.error).toContain("unavailable");
  });

  it("reads the agent settings on every run, not at boot", async () => {
    let current = {
      enabled: true,
      baseUrl: "http://a.test/v1",
      model: "model-a",
      timeoutMs: 5_000,
      maxContextMessages: 20,
    };
    const urls: string[] = [];
    const models: string[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      urls.push(url);
      models.push((JSON.parse(String(init.body)) as { model: string }).model);
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const service = new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions(),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: () => current,
      fetchImpl,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const first = await service.postMessage(thread.id, { text: "one" });
    const firstEvents: AssistantEvent[] = [];
    service.subscribe(first.run.id, 0, (event) => firstEvents.push(event));
    await waitFor(() => firstEvents.some((event) => event.type === "done"));

    current = { ...current, baseUrl: "http://b.test/v1", model: "model-b" };
    const second = await service.postMessage(thread.id, { text: "two" });
    const secondEvents: AssistantEvent[] = [];
    service.subscribe(second.run.id, 0, (event) => secondEvents.push(event));
    await waitFor(() => secondEvents.some((event) => event.type === "done"));

    expect(urls).toEqual([
      "http://a.test/v1/chat/completions",
      "http://b.test/v1/chat/completions",
    ]);
    expect(models).toEqual(["model-a", "model-b"]);
    const done = secondEvents.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.model).toBe("model-b");
  });

  it("uses the thread model and records the steps", async () => {
    let body: { model?: string } = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([
        delta("answer"),
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 2 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ]);
    }) as unknown as typeof fetch;
    const { service } = build(fetchImpl);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    await service.setThreadModel(thread.id, "alt-model");
    expect(service.getThread(thread.id).thread.model).toBe("alt-model");

    const accepted = await service.postMessage(thread.id, { text: "why?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    expect(body.model).toBe("alt-model");
    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.model).toBe("alt-model");
    expect(done.turn.activity?.some((step) => step.kind === "context")).toBe(true);
    const modelStep = done.turn.activity?.find((step) => step.kind === "model");
    expect(modelStep?.status).toBe("ok");
    expect(modelStep?.detail).toContain("10 in / 2 out");
    // Structured facts live beside the prose, so a renderer never parses it.
    expect(modelStep?.metrics).toMatchObject({
      promptTokens: 10,
      completionTokens: 2,
    });
    const contextStep = done.turn.activity?.find((step) => step.kind === "context");
    expect(contextStep?.metrics?.turns).toBeGreaterThan(0);
  });

  it("lists the endpoint models and falls back to the configured one", async () => {
    const catalog = (async (url: string) => {
      if (!url.endsWith("/models")) throw new Error("not the models route");
      return new Response(
        JSON.stringify({ data: [{ id: "alpha" }, { id: "beta" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const { service } = build(catalog);
    const listed = await service.listModels();
    expect(listed.data).toEqual(["alpha", "beta"]);
    expect(listed.current).toBe("test-model");

    const offline = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const fallback = build(offline).service;
    expect((await fallback.listModels()).data).toEqual(["test-model"]);
  });

  it("reuses one thread per session scope and titles it from the session", async () => {
    const { service } = build(async () => sseResponse([]));
    const first = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const second = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });

    expect(second.id).toBe(first.id);
    expect(first.title).toBe("Fix the build");
    expect(service.listThreads({ sessionRef: session.ref }).data).toHaveLength(1);
  });

  it("assembles the session context and streams the answer", async () => {
    let body: {
      messages: Array<{ role: string; content: string }>;
      stream?: boolean;
    } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([
        delta("The build is red because "),
        delta("the test file changed."),
        `data: ${JSON.stringify({
          choices: [{ delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 120, completion_tokens: 9 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ]);
    }) as unknown as typeof fetch;

    const { service } = build(fetchImpl);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, {
      text: "why is the build red?",
    });
    const events: AssistantEvent[] = [];
    const unsubscribe = service.subscribe(accepted.run.id, 0, (event) =>
      events.push(event),
    );
    await waitFor(() => events.some((event) => event.type === "done"));
    unsubscribe?.();

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(body.stream).toBe(true);
    expect(prompt).toContain("model: test-model");
    expect(prompt).toContain("ref: desktop-opencode:ses_a");
    expect(prompt).toContain("unread/normal: Fix the build");
    expect(prompt).toContain("Allow running pnpm test?");
    expect(prompt).toContain("[write · completed: /repo/src/app.ts]");
    expect(prompt).toContain("TRANSCRIPT (not pasted");
    expect(prompt).toContain("QUESTION\nwhy is the build red?");

    const done = events.find((event) => event.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.turn.text).toBe("The build is red because the test file changed.");
    expect(done.turn.usage).toEqual({ promptTokens: 120, completionTokens: 9 });
    expect(done.turn.context).toMatchObject({
      messages: 0,
      toolCalls: 0,
      attention: 1,
      asOf: session.updatedAt,
    });
    expect(done.turn.context?.chars).toBeGreaterThan(0);

    const detail = service.getThread(thread.id);
    expect(detail.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
  });

  it("records a failed model call as an error turn", async () => {
    const { service } = build((async () =>
      new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "why?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "error"));

    const error = events.find((event) => event.type === "error");
    expect(error?.type).toBe("error");
    if (error?.type !== "error") return;
    expect(error.run.state).toBe("error");
    expect(error.message).toContain("unavailable");

    const detail = service.getThread(thread.id);
    expect(detail.turns[1]?.error).toContain("unavailable");
  });

  it("stops a running answer and keeps the partial text", async () => {
    let streamClosed = false;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const signal = init.signal as AbortSignal;
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(delta("The first half")));
          signal.addEventListener("abort", () => {
            streamClosed = true;
            controller.error(new DOMException("aborted", "AbortError"));
          });
        },
      });
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const { service } = build(fetchImpl);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "keep going" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "delta"));

    service.stop(accepted.run.id);
    await waitFor(() => events.some((event) => event.type === "error"));
    expect(streamClosed).toBe(true);

    const error = events.find((event) => event.type === "error");
    if (error?.type !== "error") throw new Error("no error event");
    expect(error.run.state).toBe("stopped");
    const detail = service.getThread(thread.id);
    expect(detail.turns[1]?.text).toBe("The first half");
    // Stopping is not failing: the in-flight model step closes as cancelled.
    const modelStep = detail.turns[1]?.activity?.find(
      (step) => step.kind === "model",
    );
    expect(modelStep?.status).toBe("cancelled");
  });

  function toolStream(args: unknown): Response {
    return sseResponse([
      `data: ${JSON.stringify({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  function: {
                    name: "propose_session_action",
                    arguments: JSON.stringify(args),
                  },
                },
              ],
            },
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
      "data: [DONE]\n\n",
    ]);
  }

  it("keeps the end of a long message, where the conclusion lives", () => {
    const long = `${"x".repeat(6_000)}\nM3: project and global read-only scopes.`;
    const { text } = renderContext({
      session,
      attention: [],
      question: null,
      messages: [
        {
          id: "m1",
          sessionRef: session.ref,
          role: "assistant",
          createdAt: 1,
          parts: [{ type: "text", text: long }],
        },
      ],
      hits: [],
      now: session.updatedAt,
      canWrite: false,
      assistantModel: "test-model",
      transcript: true,
    });
    // A 6,000-char turn is clipped head and tail, never head only.
    expect(text).toContain("M3: project and global read-only scopes.");
  });

  it("drops the oldest turns first when the transcript exceeds its budget", () => {
    const bulk: Message[] = Array.from({ length: 20 }, (_, index) => ({
      id: `m${index}`,
      sessionRef: session.ref,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      createdAt: index,
      parts: [
        {
          type: "text" as const,
          text: `${index === 19 ? "NEWEST-TURN " : ""}${"y".repeat(3_500)}`,
        },
      ],
    }));
    const { text, context } = renderContext({
      session,
      attention: [],
      question: null,
      messages: bulk,
      hits: [],
      now: session.updatedAt,
      canWrite: false,
      assistantModel: "test-model",
      transcript: true,
    });
    expect(text).toContain("NEWEST-TURN");
    expect(text).toMatch(/older turns omitted/);
    expect(text.length).toBeLessThanOrEqual(49_500);
    expect(context.omitted).toBeGreaterThan(0);
  });

  it("renders tool output and reasoning, not just prose", () => {
    const { text } = renderContext({
      session,
      attention: [],
      question: null,
      messages: [
        {
          id: "m1",
          sessionRef: session.ref,
          role: "assistant",
          createdAt: 1,
          parts: [
            {
              type: "reasoning",
              text: "The 401 means the auth header never reached the handler.",
            },
            {
              type: "tool",
              id: "t1",
              name: "shell",
              status: "completed",
              input: { command: "pnpm test auth" },
              // Provider-style content array: the reader should see the text,
              // not JSON escaping.
              output: [
                { type: "text", text: "FAIL src/auth.test.ts" },
                { type: "text", text: "expected 401, received 500" },
              ],
            },
            { type: "text", text: "The test failed in the handler." },
          ],
        },
      ],
      hits: [],
      now: session.updatedAt,
      canWrite: false,
      assistantModel: "test-model",
      transcript: true,
    });
    expect(text).toContain("[reasoning] The 401 means");
    expect(text).toContain("[tool shell · completed]");
    expect(text).toContain("pnpm test auth");
    expect(text).toContain("→ FAIL src/auth.test.ts");
    expect(text).toContain("expected 401, received 500");
    expect(text).not.toContain('{\"type\":\"text\"');
  });

  it("reads the transcript through tools before answering", async () => {
    const bodies: Array<{
      messages: Array<{ role: string; content: string | null }>;
      tools?: Array<{ function: { name: string } }>;
    }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      round += 1;
      if (round === 1) {
        return sseResponse([
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: {
                        name: "read_turns",
                        arguments: JSON.stringify({ from: 1, to: 1 }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ]);
      }
      return sseResponse([delta("The build broke in turn 1."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const { service } = build(fetchImpl);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, {
      text: "why is the build red?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    expect(
      bodies[0]?.tools?.map((tool) => tool.function.name),
    ).toEqual(
      expect.arrayContaining([
        "search_transcript",
        "read_turns",
        "list_tool_calls",
        "read_tool_output",
      ]),
    );
    const toolMessage = bodies[1]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).toContain("TURN 1");
    expect(toolMessage?.content).toContain("the build is red");

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.text).toBe("The build broke in turn 1.");
    expect(done.turn.context?.toolCalls).toBe(1);
    expect(done.turn.context?.messages).toBe(1);
    expect(done.turn.sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ref: session.ref,
          title: session.title,
          messageID: "m1",
        }),
      ]),
    );
    expect(
      done.turn.activity?.some(
        (step) => step.kind === "tool" && step.label === "Read turn 1",
      ),
    ).toBe(true);
  });

  it("pages past the first provider page so old turns are reachable", async () => {
    const newest = [
      {
        id: "a2",
        sessionRef: session.ref,
        role: "assistant" as const,
        createdAt: 4,
        parts: [{ type: "text" as const, text: "newest turn" }],
      },
      {
        id: "a1",
        sessionRef: session.ref,
        role: "user" as const,
        createdAt: 3,
        parts: [{ type: "text" as const, text: "second newest" }],
      },
    ];
    const oldest = [
      {
        id: "b2",
        sessionRef: session.ref,
        role: "assistant" as const,
        createdAt: 2,
        parts: [{ type: "text" as const, text: "older turn" }],
      },
      {
        id: "b1",
        sessionRef: session.ref,
        role: "user" as const,
        createdAt: 1,
        parts: [{ type: "text" as const, text: "the very first request" }],
      },
    ];
    const pages: string[] = [];
    let round = 0;
    const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse([
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: {
                        name: "read_turns",
                        arguments: JSON.stringify({ from: 1, to: 1 }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ]);
      }
      return sseResponse([delta("The first request was in turn 1."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions({
        messages: async (
          _ref: string,
          query: { limit?: number; cursor?: string },
        ): Promise<MessagePage> => {
          // Only the transcript read pages; the history scan gets one empty
          // page and stays out of the count.
          if (query.limit !== 200) {
            return { data: [], cursor: { next: null, previous: null } };
          }
          pages.push(query.cursor ?? "first");
          if (!query.cursor) {
            return {
              data: newest,
              cursor: { next: "page-2", previous: null },
            };
          }
          return {
            data: oldest,
            cursor: { next: null, previous: null },
          };
        },
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
      },
      fetchImpl,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "what did I ask first?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    expect(pages).toEqual(["first", "page-2"]);
    const toolMessage = bodies[1]?.messages.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).toContain("the very first request");
    expect(toolMessage?.content).not.toContain("capped");
    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context?.messages).toBe(1);
  });

  it("says when the deep read was capped instead of implying a short session", async () => {
    let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    let calls = 0;
    const service = new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions({
        messages: async (
          _ref: string,
          query: { limit?: number },
        ): Promise<MessagePage> => {
          if (query.limit !== 200) {
            return { data: [], cursor: { next: null, previous: null } };
          }
          calls += 1;
          return {
            data: [
              {
                id: `m${calls}`,
                sessionRef: session.ref,
                role: "user",
                createdAt: calls,
                parts: [{ type: "text", text: `turn ${calls}` }],
              },
            ],
            cursor: { next: `page-${calls + 1}`, previous: null },
          };
        },
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
      },
      fetchImpl,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    await service.postMessage(thread.id, { text: "anything" });
    await waitFor(() => body.messages.length > 0);

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(calls).toBe(10);
    expect(prompt).toContain("10 turns loaded");
    expect(prompt).toContain("the session start is not reached");
    expect(prompt).toContain("turn 0 and below");
  });

  it("reads a turn older than the initial window on demand with a stable number", async () => {
    const calls: string[] = [];
    const pages = Array.from({ length: 12 }, (_, index) =>
      transcriptPage(session.ref, 2_400 - index * 200),
    );
    // Message 400 sits immediately before the initial window (turns 1..2000),
    // so after one back-page it is turn 0.
    pages[10]![0] = {
      ...pages[10]![0]!,
      parts: [{ type: "text", text: "older target" }],
    };
    const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1 || round === 2) {
        return sseResponse(
          toolCallStream(`call_${round}`, "read_turns", { from: 0, to: 0 }),
        );
      }
      return sseResponse([delta("Read the older turn."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildSession(fetchImpl, pagedProvider(pages, calls));
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, {
      text: "what is immediately before the window?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessages =
      bodies[2]?.messages.filter((message) => message.role === "tool") ?? [];
    expect(toolMessages).toHaveLength(2);
    // Same turn number, same content, and the second read does not page again.
    expect(toolMessages[0]?.content).toContain("TURN 0");
    expect(toolMessages[0]?.content).toContain("older target");
    expect(toolMessages[0]?.content).toContain("read back 200 older turns");
    expect(toolMessages[0]?.content).toContain("older turns not loaded");
    expect(toolMessages[1]?.content).toContain("TURN 0");
    expect(toolMessages[1]?.content).toContain("older target");
    expect(calls).toHaveLength(11);

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context?.messages).toBe(1);
    expect(
      done.turn.activity?.some(
        (step) => step.kind === "tool" && step.detail?.includes("read back 200 older turns"),
      ),
    ).toBe(true);
  });

  it("says the session start was reached when a back-page finishes there", async () => {
    const calls: string[] = [];
    const pages = [
      ...Array.from({ length: 10 }, (_, index) =>
        transcriptPage(session.ref, 2_050 - index * 200),
      ),
      transcriptPage(session.ref, 50),
    ];
    const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallStream("call_1", "read_turns", { from: -100, to: -100 }),
        );
      }
      return sseResponse([delta("Read the first turn."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildSession(fetchImpl, pagedProvider(pages, calls));
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, {
      text: "what did I ask first?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessage = bodies[1]?.messages.find((message) => message.role === "tool");
    expect(toolMessage?.content).toContain("session start reached");
    expect(toolMessage?.content).toContain("whole session");
    expect(toolMessage?.content).toContain("TURN -49");
    expect(toolMessage?.content).toContain("message 1");
    expect(toolMessage?.content).not.toContain("older turns not loaded");
    expect(calls).toHaveLength(11);
  });

  it("stops a very long back-page at the run budget and says how far it read", async () => {
    const calls: string[] = [];
    const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallStream("call_1", "read_turns", {
            from: -10_000,
            to: -10_000,
          }),
        );
      }
      return sseResponse([delta("Stopped at the budget."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildSession(
      fetchImpl,
      endlessProvider(calls, (n) => `deep note ${n}`),
    );
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, {
      text: "read the very old turns",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessage = bodies[1]?.messages.find((message) => message.role === "tool");
    expect(calls).toHaveLength(20); // 10 initial pages + 10 back-page budget
    expect(toolMessage?.content).toContain("TURN -1999");
    expect(toolMessage?.content).toContain("read back 2000 older turns");
    expect(toolMessage?.content).toContain("older turns not loaded");
    expect(toolMessage?.content).toContain("back-page budget reached");
  });

  it("searches older turns on demand and reports the searched boundary", async () => {
    const calls: string[] = [];
    const pages = [
      ...Array.from({ length: 10 }, (_, index) =>
        transcriptPage(session.ref, 2_100 - index * 200),
      ),
      transcriptPage(session.ref, 100),
    ];
    // The oldest message is the one the loaded window cannot see.
    pages[10]![99] = {
      ...pages[10]![99]!,
      parts: [{ type: "text", text: "the needle is here" }],
    };
    const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallStream("call_1", "search_transcript", { query: "needle" }),
        );
      }
      return sseResponse([delta("Found the needle."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildSession(fetchImpl, pagedProvider(pages, calls));
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, {
      text: "where is the needle?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessage = bodies[1]?.messages.find((message) => message.role === "tool");
    expect(calls).toHaveLength(11);
    expect(toolMessage?.content).toContain("turn -99");
    expect(toolMessage?.content).toContain("the needle is here");
    expect(toolMessage?.content).toContain("searched the whole session");
    expect(toolMessage?.content).not.toContain("older turns not searched");
  });

  it("states the search boundary when the budget ends before the term is found", async () => {
    const calls: string[] = [];
    const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallStream("call_1", "search_transcript", {
            query: "absentneedle",
          }),
        );
      }
      return sseResponse([delta("Not found."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = buildSession(
      fetchImpl,
      endlessProvider(calls, (n) => `deep note ${n}`),
    );
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, {
      text: "find absentneedle",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessage = bodies[1]?.messages.find((message) => message.role === "tool");
    expect(calls).toHaveLength(20);
    expect(toolMessage?.content).toContain("no matches");
    expect(toolMessage?.content).toContain("read back 2000 older turns");
    expect(toolMessage?.content).toContain("older turns not searched");
    expect(toolMessage?.content).toContain("back-page budget reached");
  });

  it("pages a cross-session read back on demand under the same budget", async () => {
    const calls: string[] = [];
    const pages = Array.from({ length: 12 }, (_, index) =>
      transcriptPage(session.ref, 2_400 - index * 200),
    );
    pages[10]![0] = {
      ...pages[10]![0]!,
      parts: [{ type: "text", text: "older cross target" }],
    };
    const bodies: Array<{ messages: Array<{ role: string; content: string | null }> }> = [];
    let round = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      round += 1;
      if (round === 1) {
        return sseResponse(
          toolCallStream("call_1", "read_session_turns", {
            sessionRef: session.ref,
            from: 0,
            to: 0,
          }),
        );
      }
      return sseResponse([delta("Read the older cross turn."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions({
        list: async () => ({
          data: [session],
          cursor: { next: null, previous: null },
        }),
        messages: pagedProvider(pages, calls),
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
      },
      fetchImpl,
    });
    const thread = await service.createThread({ scope: { kind: "global" } });
    const accepted = await service.postMessage(thread.id, {
      text: "what is immediately before the window?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const toolMessage = bodies[1]?.messages.find((message) => message.role === "tool");
    expect(calls).toHaveLength(11);
    expect(toolMessage?.content).toContain("TURN 0");
    expect(toolMessage?.content).toContain("older cross target");
    expect(toolMessage?.content).toContain("read back 200 older turns");
    expect(toolMessage?.content).toContain("older turns not loaded");
  });

  it("forces an answer when the tool rounds run out", async () => {
    const bodies: Array<{ tools?: unknown[]; messages: Array<{ role: string; content: string | null }> }> = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      if (body.tools && body.tools.length > 0) {
        return sseResponse([
          `data: ${JSON.stringify({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_${bodies.length}`,
                      function: {
                        name: "search_transcript",
                        arguments: JSON.stringify({ query: "build" }),
                      },
                    },
                  ],
                },
              },
            ],
          })}\n\n`,
          "data: [DONE]\n\n",
        ]);
      }
      return sseResponse([delta("Answer from what I have."), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const { service } = build(fetchImpl);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "keep reading" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    // 4 rounds: three with tools, the last without so prose must come out.
    expect(bodies).toHaveLength(4);
    expect(bodies[3]?.tools).toBeUndefined();
    expect(bodies[3]?.messages.at(-1)?.content).toContain("Stop reading");
    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.text).toBe("Answer from what I have.");
  });

  it("labels trusted blocks and surfaces failures", async () => {
    const failed: Message[] = [
      {
        id: "m1",
        sessionRef: session.ref,
        role: "assistant",
        createdAt: 10,
        parts: [
          {
            type: "shell",
            id: "sh1",
            command: "pnpm test",
            status: "error",
            exit: 1,
            background: false,
            output:
              "FAIL src/auth.test.ts > auth-race\nexpected 401, received 500\nAuthorization: Bearer abcdef123456789secret",
          },
        ],
      },
      {
        id: "m2",
        sessionRef: session.ref,
        role: "assistant",
        createdAt: 11,
        parts: [
          {
            type: "tool",
            id: "t1",
            name: "edit",
            status: "error",
            input: { path: "/repo/src/auth.ts" },
            output: "patch did not apply",
          },
        ],
      },
    ];
    let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const store = new MemoryStateStore();
    const service = new AssistantService({
      store,
      sessions: fakeSessions({
        messages: async (): Promise<MessagePage> => ({
          data: [...failed].reverse(),
          cursor: { next: null, previous: null },
        }),
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
      },
      fetchImpl,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "what failed?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("SITUATION (hub facts)");
    expect(prompt).toContain("FAILURES (untrusted tool output)");
    expect(prompt).toContain("shell pnpm test (exit 1)");
    expect(prompt).toContain("expected 401, received 500");
    expect(prompt).toContain("[redacted]");
    expect(prompt).not.toContain("abcdef123456789secret");
    expect(prompt).toContain("tool edit");
    expect(prompt).toContain("patch did not apply");
    expect(prompt).toContain("WORK (derived from untrusted tool calls)");
    expect(prompt).toContain("/repo/src/auth.ts");

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context?.failures).toBe(2);
  });

  it("bounds a slow history page and serves the cache once it lands", async () => {
    let wideCalls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail: Message[] = [
      {
        id: "m-new",
        sessionRef: session.ref,
        role: "user",
        createdAt: 100,
        parts: [{ type: "text", text: "status?" }],
      },
    ];
    const compaction: Message = {
      id: "c1",
      sessionRef: session.ref,
      role: "system",
      createdAt: 5_000,
      parts: [
        {
          type: "compaction",
          reason: "auto",
          status: "done",
          summary: "OBJECTIVE: keep the ask bounded.",
        },
      ],
    };
    let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions({
        messages: async (
          _ref: string,
          query: { limit?: number },
        ): Promise<MessagePage> => {
          // 100 is the history scan; the session page is the 200-message read.
          if (query.limit !== 100) {
            return { data: tail, cursor: { next: null, previous: null } };
          }
          wideCalls += 1;
          // The first wide read never settles until the test releases it.
          await gate;
          return { data: [compaction], cursor: { next: null, previous: null } };
        },
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
      },
      fetchImpl,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });

    const started = Date.now();
    const accepted = await service.postMessage(thread.id, { text: "first" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"), 5_000);

    const first = events.find((event) => event.type === "done");
    if (first?.type !== "done") throw new Error("no done event");
    // The page is still in flight, so the ask answered without history.
    expect(Date.now() - started).toBeLessThan(4_500);
    expect(first.turn.context?.historyAt).toBeUndefined();
    expect(body.messages.find((message) => message.role === "user")?.content).not.toContain(
      "HISTORY (provider compaction",
    );
    expect(wideCalls).toBe(1);

    // Let the in-flight page land: the background scan fills the cache.
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const second = await service.postMessage(thread.id, { text: "second" });
    const secondEvents: AssistantEvent[] = [];
    service.subscribe(second.run.id, 0, (event) => secondEvents.push(event));
    await waitFor(() => secondEvents.some((event) => event.type === "done"), 5_000);
    const answered = secondEvents.find((event) => event.type === "done");
    if (answered?.type !== "done") throw new Error("no done event");
    // The same watermark is served from the cache: no second wide read.
    expect(answered.turn.context?.historyAt).toBe(5_000);
    expect(wideCalls).toBe(1);
  }, 15_000);

  it("surfaces a failure from outside the message tail without duplicates", async () => {
    const tailFailure: Message = {
      id: "m-tail",
      sessionRef: session.ref,
      role: "assistant",
      createdAt: 50,
      parts: [
        {
          type: "shell",
          id: "sh-tail",
          command: "pnpm lint",
          status: "error",
          exit: 1,
          background: false,
          output: "lint failed: Unexpected token",
        },
      ],
    };
    const oldFailure = {
      id: "m-old",
      sessionRef: session.ref,
      role: "assistant" as const,
      createdAt: 10,
      // Providers sometimes attach an error string outside the modelled parts.
      error: "auth rejected token=abcdef123456789secret",
      parts: [
        {
          type: "shell" as const,
          id: "sh-old",
          command: "pnpm test",
          status: "error" as const,
          exit: 2,
          background: false,
          output: "2 tests failed\nAuthorization: Bearer abcdef123456789secret",
        },
      ],
    };
    const tail: Message[] = [
      {
        id: "m-user",
        sessionRef: session.ref,
        role: "user",
        createdAt: 40,
        parts: [{ type: "text", text: "check the build" }],
      },
      tailFailure,
    ];
    const wide = [oldFailure, ...tail];
    let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const service = new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions({
        messages: async (
          _ref: string,
          query: { limit?: number },
        ): Promise<MessagePage> => ({
          // The provider returns newest first; the builder restores order.
          data: [...(query.limit === 200 ? wide : tail)].reverse(),
          cursor: { next: null, previous: null },
        }),
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 2,
      },
      fetchImpl,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "what failed?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    // Only the tail failure would have been visible before the wide digest.
    expect(prompt).toContain("shell pnpm lint (exit 1)");
    expect(prompt).toContain("shell pnpm test (exit 2)");
    expect(prompt).toContain("2 tests failed");
    expect(prompt).toContain("[redacted]");
    expect(prompt).toContain("token=[redacted]");
    expect(prompt).not.toContain("abcdef123456789secret");
    expect(prompt.split("shell pnpm lint").length - 1).toBe(1);
    expect(prompt.split("shell pnpm test").length - 1).toBe(1);
    expect(done.turn.context?.failures).toBe(3);
  });

  it("finds a compaction outside the window and caches the scan", async () => {
    let wideCalls = 0;
    const compaction: Message = {
      id: "c1",
      sessionRef: session.ref,
      role: "system",
      createdAt: 5_000,
      parts: [
        {
          type: "compaction",
          reason: "auto",
          status: "done",
          summary: "OBJECTIVE: ship the confirmed-write assistant.",
        },
      ],
    };
    const serviceFor = (fetchImpl: typeof fetch) =>
      new AssistantService({
        store: new MemoryStateStore(),
        sessions: fakeSessions({
          messages: async (
            _ref: string,
            query: { limit?: number; cursor?: string },
          ): Promise<MessagePage> => {
            if (query.limit === 100) {
              wideCalls += 1;
              if (!query.cursor) {
                return {
                  data: [],
                  cursor: { next: "page-2", previous: null },
                };
              }
              return {
                data: [compaction],
                cursor: { next: null, previous: null },
              };
            }
            return {
              data: [
                {
                  id: "m-latest",
                  sessionRef: session.ref,
                  role: "user",
                  parts: [],
                  createdAt: 100,
                },
              ],
              cursor: { next: null, previous: null },
            };
          },
        }),
        actions: { send: async () => ({}) } as unknown as SessionActions,
        attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
        questions: { get: async () => null } as unknown as QuestionService,
        logger: logger(),
        settings: {
          enabled: true,
          baseUrl: "http://model.test/v1",
          model: "test-model",
          timeoutMs: 5_000,
          maxContextMessages: 20,
        },
        fetchImpl,
      });

    let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const service = serviceFor(fetchImpl);

    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "what is the goal?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("HISTORY (provider compaction");
    expect(prompt).toContain("OBJECTIVE: ship the confirmed-write assistant.");
    const done = events.find((event) => event.type === "done");
    if (done?.type !== "done") throw new Error("no done event");
    expect(done.turn.context?.historyAt).toBe(5_000);
    // One page plus one deep page; a second question inside the TTL reuses it.
    expect(wideCalls).toBe(2);

    const second = await service.postMessage(thread.id, { text: "and now?" });
    const secondEvents: AssistantEvent[] = [];
    service.subscribe(second.run.id, 0, (event) => secondEvents.push(event));
    await waitFor(() => secondEvents.some((event) => event.type === "done"));
    expect(wideCalls).toBe(2);
  });

  it("searches other sessions from the session scope, including metadata", async () => {
    let listCalls = 0;
    const ops: Session = {
      ...session,
      ref: "desktop-opencode:ses_ops",
      nativeID: "ses_ops",
      title: "Runtime cleanup",
      project: "ops",
      directory: "/home/me/gpu-orchestrator",
      model: "gpu-orchestrator-runner",
      status: "idle",
    };
    let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;
    const service = new AssistantService({
      store: new MemoryStateStore(),
      sessions: fakeSessions({
        list: async () => {
          listCalls += 1;
          return { data: [session, ops], cursor: { next: null, previous: null } };
        },
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
      },
      fetchImpl,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, {
      text: "which session works on gpu orchestrator?",
    });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("SEARCH (other sessions");
    expect(prompt).toContain("Runtime cleanup");
    expect(prompt).toContain("gpu-orchestrator");
    expect(listCalls).toBe(1);

    // A question made only of stop words must not buy a session list.
    const second = await service.postMessage(thread.id, { text: "what is this session doing?" });
    const secondEvents: AssistantEvent[] = [];
    service.subscribe(second.run.id, 0, (event) => secondEvents.push(event));
    await waitFor(() => secondEvents.some((event) => event.type === "done"));
    expect(listCalls).toBe(1);
  });

  it("backfills as-of from the newest message before each answer", async () => {
    const store = new MemoryStateStore();
    await store.update((state) => {
      state.assistantThreads.push({
        id: "ath_old",
        scope: { kind: "session", sessionRef: session.ref },
        title: "old thread",
        createdAt: 1,
        updatedAt: 1,
        messageCount: 4,
        turns: [
          {
            id: "atn_u",
            threadId: "ath_old",
            role: "user",
            text: "q",
            createdAt: 2_000,
          },
          {
            id: "atn_a",
            threadId: "ath_old",
            role: "assistant",
            text: "a",
            createdAt: 2_500,
          },
          {
            id: "atn_b",
            threadId: "ath_old",
            role: "assistant",
            text: "b",
            createdAt: 500,
          },
          {
            id: "atn_c",
            threadId: "ath_old",
            role: "assistant",
            text: "c",
            createdAt: 2_600,
            context: { messages: 3, omitted: 1, chars: 90, attention: 0 },
          },
        ],
      });
    });

    const service = new AssistantService({
      store,
      sessions: fakeSessions({
        messages: async (): Promise<MessagePage> => ({
          data: [
            {
              id: "m3",
              sessionRef: session.ref,
              role: "assistant",
              parts: [],
              createdAt: 3_000,
            },
            {
              id: "m2",
              sessionRef: session.ref,
              role: "user",
              parts: [],
              createdAt: 1_000,
            },
          ],
          cursor: { next: null, previous: null },
        }),
      }),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
      },
      fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
    });

    const updated = await service.backfillAsOf();
    expect(updated).toBe(3);

    const turns = service.getThread("ath_old").turns;
    expect(turns[1]?.context?.asOf).toBe(1_000);
    // No provider message existed before this answer: the answer time is the
    // strongest honest bound.
    expect(turns[2]?.context?.asOf).toBe(500);
    expect(turns[3]?.context).toMatchObject({
      messages: 3,
      omitted: 1,
      chars: 90,
      attention: 0,
      asOf: 1_000,
    });

    expect(await service.backfillAsOf()).toBe(0);
  });

  it("lets a human cancel even after writes are disabled", async () => {
    const fetchImpl = (async () =>
      toolStream({ kind: "send", text: "Hello", summary: "Send it?" })) as unknown as typeof fetch;
    const { service, store } = build(fetchImpl, { allowWrite: true });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "reply please" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));
    const action = events.find((event) => event.type === "action");
    if (action?.type !== "action") throw new Error("no action event");

    // Same data, writes now off: confirming must refuse, cancelling must work.
    const readOnly = new AssistantService({
      store,
      sessions: fakeSessions(),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
        allowWrite: false,
      },
      fetchImpl,
    });

    await expect(
      readOnly.decide(thread.id, action.turn.id, { decision: "confirm" }),
    ).rejects.toThrow(/disabled/i);
    const cancelled = await readOnly.decide(thread.id, action.turn.id, {
      decision: "cancel",
    });
    expect(cancelled.action?.status).toBe("cancelled");

    const after = await readOnly.postMessage(thread.id, { text: "next question" });
    expect(after.run.state).toBe("running");
  });

  it("sends once when two devices confirm at the same time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];
    const actions = {
      send: async (ref: string, input: { text: string }) => {
        sent.push(input.text);
        await gate;
        return { accepted: true, messageId: "m" };
      },
    } as unknown as SessionActions;

    const store = new MemoryStateStore();
    const service = new AssistantService({
      store,
      sessions: fakeSessions(),
      actions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
        allowWrite: true,
      },
      fetchImpl: (async () =>
        toolStream({ kind: "send", text: "Hello", summary: "Send it?" })) as unknown as typeof fetch,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "reply please" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));
    const action = events.find((event) => event.type === "action");
    if (action?.type !== "action") throw new Error("no action event");

    const first = service.decide(thread.id, action.turn.id, { decision: "confirm" });
    const second = service.decide(thread.id, action.turn.id, { decision: "confirm" });
    // Let both reach the reservation, then let the winner's send finish.
    release();
    const results = await Promise.allSettled([first, second]);

    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((entry) => entry.status === "rejected")).toHaveLength(1);
    expect(sent).toHaveLength(1);
    const detail = service.getThread(thread.id);
    const stored = detail.turns.find((turn) => turn.id === action.turn.id);
    await waitFor(() => stored?.action?.status === "done");
    expect(
      detail.turns.find((turn) => turn.id === action.turn.id)?.action?.status,
    ).toBe("done");
  });

  it("keeps one outcome when confirm and cancel race", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const sent: string[] = [];
    const actions = {
      send: async (ref: string, input: { text: string }) => {
        sent.push(input.text);
        await gate;
        return { accepted: true, messageId: "m" };
      },
    } as unknown as SessionActions;

    const store = new MemoryStateStore();
    const service = new AssistantService({
      store,
      sessions: fakeSessions(),
      actions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
        allowWrite: true,
      },
      fetchImpl: (async () =>
        toolStream({ kind: "send", text: "Hello", summary: "Send it?" })) as unknown as typeof fetch,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "reply please" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));
    const action = events.find((event) => event.type === "action");
    if (action?.type !== "action") throw new Error("no action event");

    const confirm = service.decide(thread.id, action.turn.id, { decision: "confirm" });
    const cancel = service.decide(thread.id, action.turn.id, { decision: "cancel" });
    release();
    const results = await Promise.allSettled([confirm, cancel]);

    expect(results.filter((entry) => entry.status === "fulfilled")).toHaveLength(1);
    const status = service
      .getThread(thread.id)
      .turns.find((turn) => turn.id === action.turn.id)?.action?.status;
    if (status === "cancelled") {
      expect(sent).toHaveLength(0);
    } else {
      expect(sent).toHaveLength(1);
      expect(status).toBe("done");
    }
  });

  it("starts one run for two concurrent messages", async () => {
    const { service } = build((async () =>
      sseResponse([delta("ok"), "data: [DONE]\n\n"])) as unknown as typeof fetch);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });

    const results = await Promise.allSettled([
      service.postMessage(thread.id, { text: "first" }),
      service.postMessage(thread.id, { text: "second" }),
    ]);
    const accepted = results.filter(
      (entry): entry is PromiseFulfilledResult<AssistantRunAccepted> =>
        entry.status === "fulfilled",
    );
    expect(accepted).toHaveLength(1);
    expect(results.some((entry) => entry.status === "rejected")).toBe(true);
  });

  it("returns the same run for a retried idempotency key", async () => {
    const { service } = build((async () =>
      sseResponse([delta("ok"), "data: [DONE]\n\n"])) as unknown as typeof fetch);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });

    const first = await service.postMessage(thread.id, {
      text: "status?",
      idempotencyKey: "retry-1",
    });
    const second = await service.postMessage(thread.id, {
      text: "status?",
      idempotencyKey: "retry-1",
    });

    expect(second.run.id).toBe(first.run.id);
    expect(service.getThread(thread.id).turns).toHaveLength(1);
  });

  it("returns the terminal event when a reconnect asks past the end", async () => {
    const { service } = build((async () =>
      sseResponse([
        delta("answer"),
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
        "data: [DONE]\n\n",
      ])) as unknown as typeof fetch);
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "why?" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const replay: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 999, (event) => replay.push(event));
    expect(replay.some((event) => event.type === "done")).toBe(true);
  });

  it("survives an audit write that rejects", async () => {
    const store = new MemoryStateStore();
    const service = new AssistantService({
      store,
      sessions: fakeSessions(),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      audit: () => Promise.reject(new Error("disk full")),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
        allowWrite: true,
      },
      fetchImpl: (async () =>
        toolStream({ kind: "send", text: "Hello", summary: "Send it?" })) as unknown as typeof fetch,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "reply please" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));
    const action = events.find((event) => event.type === "action");
    if (action?.type !== "action") throw new Error("no action event");

    const decided = await service.decide(thread.id, action.turn.id, {
      decision: "cancel",
    });
    expect(decided.action?.status).toBe("cancelled");
  });

  it("proposes a send action instead of sending", async () => {
    const { service, sent } = build(
      (async () =>
        toolStream({ kind: "send", text: "Hello", summary: "Send it?" })) as unknown as typeof fetch,
      { allowWrite: true },
    );
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "reply please" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));

    expect(sent).toHaveLength(0);
    const action = events.find((event) => event.type === "action");
    if (action?.type !== "action") throw new Error("no action event");
    expect(action.run.state).toBe("awaiting-confirm");
    expect(action.turn.action?.status).toBe("pending");
    expect(action.turn.action?.text).toBe("Hello");
  });

  it("sends once with the human's edit after confirmation", async () => {
    const { service, sent, audits } = build(
      (async () =>
        toolStream({ kind: "send", text: "Hello", summary: "Send it?" })) as unknown as typeof fetch,
      { allowWrite: true },
    );
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "reply please" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));
    const action = events.find((event) => event.type === "action");
    if (action?.type !== "action") throw new Error("no action event");

    const decided = await service.decide(thread.id, action.turn.id, {
      decision: "confirm",
      text: "Edited before sending",
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.input.text).toBe("Edited before sending");
    expect(sent[0]?.key).toContain("assistant:act_");
    expect(decided.action?.status).toBe("done");
    const confirmed = audits.find((entry) => entry.event === "confirmed");
    expect(confirmed).toMatchObject({ ok: true, model: "test-model" });
    expect(String(confirmed?.payloadHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(confirmed?.payloadLength).toBe("Edited before sending".length);
  });

  it("cancels without sending", async () => {
    const { service, sent } = build(
      (async () =>
        toolStream({ kind: "send", text: "Hello", summary: "Send it?" })) as unknown as typeof fetch,
      { allowWrite: true },
    );
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "reply please" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));
    const action = events.find((event) => event.type === "action");
    if (action?.type !== "action") throw new Error("no action event");

    const decided = await service.decide(thread.id, action.turn.id, {
      decision: "cancel",
    });

    expect(sent).toHaveLength(0);
    expect(decided.action?.status).toBe("cancelled");
  });

  it("resolves an answer against the live question", async () => {
    const { service, sent } = build(
      (async () =>
        toolStream({
          kind: "answer",
          answers: [{ questionId: "q1", choiceId: "yes" }],
          summary: "Answer Allow?",
        })) as unknown as typeof fetch,
      { allowWrite: true },
    );
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "allow it" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "action"));
    const action = events.find((event) => event.type === "action");
    if (action?.type !== "action") throw new Error("no action event");

    expect(action.turn.action?.answers?.[0]).toMatchObject({
      questionId: "q1",
      choiceId: "yes",
      revision: "r1",
    });
    expect(action.turn.action?.questions?.[0]).toMatchObject({
      id: "q1",
      text: "Allow running pnpm test?",
      risk: "normal",
    });

    await service.decide(thread.id, action.turn.id, { decision: "confirm" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.input.text).toBe("Allow running pnpm test in /repo");
    expect(sent[0]?.input.answers).toMatchObject([
      { questionId: "q1", choiceId: "yes", revision: "r1" },
    ]);
  });

  it("expires a day-old pending action instead of blocking the thread", async () => {
    const { service, store, audits } = build((async () =>
      sseResponse([delta("ok"), "data: [DONE]\n\n"])) as unknown as typeof fetch);
    await store.update((state) => {
      state.assistantThreads.push({
        id: "ath_expired",
        scope: { kind: "session", sessionRef: "desktop-opencode:ses_old" },
        title: "old",
        createdAt: 1,
        updatedAt: 1,
        messageCount: 2,
        turns: [
          { id: "u1", threadId: "ath_expired", role: "user", text: "q", createdAt: 1 },
          {
            id: "a1",
            threadId: "ath_expired",
            role: "assistant",
            text: "",
            createdAt: 2,
            action: {
              id: "act_old",
              kind: "send",
              status: "pending",
              summary: "Send it?",
              sessionRef: "desktop-opencode:ses_old",
              text: "hello",
              createdAt: 0,
            },
          },
        ],
      });
    });

    const accepted = await service.postMessage("ath_expired", { text: "next" });

    expect(accepted.run.state).toBe("running");
    const action = service
      .getThread("ath_expired")
      .turns.find((turn) => turn.id === "a1")?.action;
    expect(action?.status).toBe("expired");
    expect(action?.error).toContain("expired");
    expect(audits.some((entry) => entry.event === "expired")).toBe(true);
  });

  it("evicts the least recently used thread but keeps a locked one", async () => {
    const { service, store } = build((async () =>
      sseResponse([delta("ok"), "data: [DONE]\n\n"])) as unknown as typeof fetch);
    await store.update((state) => {
      state.assistantThreads = Array.from({ length: 40 }, (_, index) => ({
        id: `ath_${index}`,
        scope: {
          kind: "session" as const,
          sessionRef: `desktop-opencode:ses_${index}`,
        },
        title: `thread ${index}`,
        createdAt: index,
        updatedAt: index,
        messageCount: 1,
        turns: [
          {
            id: `t_${index}`,
            threadId: `ath_${index}`,
            role: "assistant" as const,
            text: "x",
            createdAt: index,
            ...(index === 0
              ? {
                  action: {
                    id: "act_locked",
                    kind: "send" as const,
                    status: "pending" as const,
                    summary: "Send it?",
                    sessionRef: "desktop-opencode:ses_0",
                    text: "hello",
                    createdAt: Date.now(),
                  },
                }
              : {}),
          },
        ],
      }));
    });

    await service.createThread({
      scope: { kind: "session", sessionRef: "desktop-opencode:ses_new" },
    });

    const threads = store.getState().assistantThreads;
    expect(threads).toHaveLength(40);
    expect(threads.some((thread) => thread.id === "ath_0")).toBe(true);
    expect(threads.some((thread) => thread.id === "ath_1")).toBe(false);
    expect(
      threads.some(
        (thread) =>
          thread.scope.kind === "session" &&
          thread.scope.sessionRef === "desktop-opencode:ses_new",
      ),
    ).toBe(true);
  });

  it("marks a run interrupted by a restart", async () => {
    const { service, store } = build((async () =>
      sseResponse([delta("ok"), "data: [DONE]\n\n"])) as unknown as typeof fetch);
    await store.update((state) => {
      state.assistantThreads.push({
        id: "ath_cut",
        scope: { kind: "session", sessionRef: session.ref },
        title: "cut",
        createdAt: 1,
        updatedAt: 1,
        messageCount: 1,
        turns: [
          { id: "u1", threadId: "ath_cut", role: "user", text: "q", createdAt: 1 },
        ],
      });
    });

    await service.init();

    const turns = service.getThread("ath_cut").turns;
    expect(turns).toHaveLength(2);
    expect(turns[1]?.role).toBe("assistant");
    expect(turns[1]?.error).toContain("interrupted");
  });

  it("refuses to answer a permission prompt", async () => {
    const risky = {
      ...question,
      questions: [
        {
          ...question.questions[0]!,
          text: "Allow running rm -rf dist && pnpm build?",
          risk: "destructive" as const,
        },
      ],
    };
    const store = new MemoryStateStore();
    const sent: Array<Record<string, unknown>> = [];
    const service = new AssistantService({
      store,
      sessions: fakeSessions(),
      actions: {
        send: async (_ref: string, input: Record<string, unknown>) => {
          sent.push(input);
          return {};
        },
      } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => risky } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "http://model.test/v1",
        model: "test-model",
        timeoutMs: 5_000,
        maxContextMessages: 20,
        allowWrite: true,
      },
      fetchImpl: (async () =>
        toolStream({
          kind: "answer",
          answers: [{ questionId: "q1", choiceId: "yes" }],
          summary: "Answer Allow?",
        })) as unknown as typeof fetch,
    });
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "approve it" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const turn = service.getThread(thread.id).turns[1];
    expect(turn?.action?.status).toBe("failed");
    expect(turn?.action?.error).toContain("permission prompt");
    expect(turn?.action?.questions?.[0]?.risk).toBe("destructive");
    expect(sent).toHaveLength(0);

    // It cannot be forced through the decide endpoint either.
    await expect(
      service.decide(thread.id, turn!.id, { decision: "confirm" }),
    ).rejects.toThrow(/no longer pending/i);
    expect(sent).toHaveLength(0);
  });

  it("ignores a tool call when writes are disabled", async () => {
    const { service, sent } = build(
      (async () =>
        toolStream({ kind: "send", text: "Hello", summary: "Send it?" })) as unknown as typeof fetch,
    );
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "reply please" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    expect(sent).toHaveLength(0);
    expect(service.getThread(thread.id).turns[1]?.action).toBeUndefined();
  });

  it("marks an unreadable action as failed instead of pending", async () => {
    const { service, sent } = build(
      (async () =>
        toolStream({ kind: "send", summary: "Send it?" })) as unknown as typeof fetch,
      { allowWrite: true },
    );
    const thread = await service.createThread({
      scope: { kind: "session", sessionRef: session.ref },
    });
    const accepted = await service.postMessage(thread.id, { text: "reply please" });
    const events: AssistantEvent[] = [];
    service.subscribe(accepted.run.id, 0, (event) => events.push(event));
    await waitFor(() => events.some((event) => event.type === "done"));

    const turn = service.getThread(thread.id).turns[1];
    expect(turn?.action?.status).toBe("failed");
    expect(turn?.action?.error).toContain("empty");
    expect(sent).toHaveLength(0);
  });

  it("reports a disabled assistant instead of starting a run", async () => {
    const store = new MemoryStateStore();
    const service = new AssistantService({
      store,
      sessions: fakeSessions(),
      actions: { send: async () => ({}) } as unknown as SessionActions,
      attention: { list: async () => ({ data: [] }) } as unknown as AttentionService,
      questions: { get: async () => null } as unknown as QuestionService,
      logger: logger(),
      settings: {
        enabled: true,
        baseUrl: "",
        model: "",
        timeoutMs: 5_000,
        maxContextMessages: 20,
      },
      fetchImpl: (async () => new Response("{}")) as unknown as typeof fetch,
    });

    expect(service.status().enabled).toBe(false);
    await expect(
      service.createThread({ scope: { kind: "session", sessionRef: session.ref } }),
    ).rejects.toThrow(/not configured/);
  });
});
