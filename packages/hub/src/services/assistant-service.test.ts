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
import { AssistantService } from "./assistant-service";
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
    messages: async (): Promise<MessagePage> => ({
      data: messages,
      cursor: { next: null, previous: null },
    }),
    ...overrides,
  } as unknown as SessionService;
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

describe("AssistantService", () => {
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
    expect(prompt).toContain("the build is red");
    expect(prompt).toContain("QUESTION\nwhy is the build red?");

    const done = events.find((event) => event.type === "done");
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.turn.text).toBe("The build is red because the test file changed.");
    expect(done.turn.usage).toEqual({ promptTokens: 120, completionTokens: 9 });
    expect(done.turn.context).toMatchObject({
      messages: 2,
      omitted: 0,
      attention: 1,
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
    expect(error.message).toContain("HTTP 500");

    const detail = service.getThread(thread.id);
    expect(detail.turns[1]?.error).toContain("HTTP 500");
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

  it("keeps the end of a long message, where the conclusion lives", async () => {
    const long = `${"x".repeat(2_600)}\nM3: project and global read-only scopes.`;
    const longMessages: Message[] = [
      {
        id: "m1",
        sessionRef: session.ref,
        role: "user",
        createdAt: 1,
        parts: [{ type: "text", text: "plan the next milestone" }],
      },
      {
        id: "m2",
        sessionRef: session.ref,
        role: "assistant",
        createdAt: 2,
        parts: [{ type: "text", text: long }],
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
          data: longMessages,
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
    await service.postMessage(thread.id, { text: "what is m3?" });
    await waitFor(() => body.messages.length > 0);

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("M3: project and global read-only scopes.");
  });

  it("drops the oldest turns first when the transcript exceeds its budget", async () => {
    const bulk: Message[] = Array.from({ length: 20 }, (_, index) => ({
      id: `m${index}`,
      sessionRef: session.ref,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      createdAt: index,
      parts: [
        {
          type: "text" as const,
          text: `${index === 19 ? "NEWEST-TURN " : ""}${"y".repeat(2_000)}`,
        },
      ],
    }));
    let body: { messages: Array<{ role: string; content: string }> } = { messages: [] };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return sseResponse([delta("ok"), "data: [DONE]\n\n"]);
    }) as unknown as typeof fetch;

    const store = new MemoryStateStore();
    const service = new AssistantService({
      store,
      sessions: fakeSessions({
        // The provider returns newest first; the builder restores reading order.
        messages: async (): Promise<MessagePage> => ({
          data: [...bulk].reverse(),
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
    await service.postMessage(thread.id, { text: "status?" });
    await waitFor(() => body.messages.length > 0);

    const prompt = body.messages.find((message) => message.role === "user")?.content ?? "";
    expect(prompt).toContain("NEWEST-TURN");
    expect(prompt).toMatch(/older turns omitted/);
    expect(prompt.length).toBeLessThanOrEqual(24_500);
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

    await service.decide(thread.id, action.turn.id, { decision: "confirm" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.input.text).toBe("Allow running pnpm test in /repo");
    expect(sent[0]?.input.answers).toMatchObject([
      { questionId: "q1", choiceId: "yes", revision: "r1" },
    ]);
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
