import { describe, expect, it } from "vitest";
import type {
  AssistantEvent,
  AttentionPage,
  Message,
  MessagePage,
  QuestionPrompt,
  Session,
} from "@amoshydra/oktoso-contracts";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { AssistantService } from "./assistant-service";
import type { AttentionService } from "./attention-service";
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
        { id: "yes", label: "Allow", text: "Allow", kind: "boolean", source: "explicit" },
        { id: "no", label: "Deny", text: "Deny", kind: "boolean", source: "explicit" },
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
} = {}) {
  const store = new MemoryStateStore();
  const service = new AssistantService({
    store,
    sessions: fakeSessions(),
    attention: {
      list: async () => attentionPage,
    } as unknown as AttentionService,
    questions: {
      get: async () => question,
    } as unknown as QuestionService,
    logger: logger(),
    settings: {
      enabled: true,
      baseUrl: "http://model.test/v1",
      model: "test-model",
      timeoutMs: 5_000,
      maxContextMessages: overrides.maxContextMessages ?? 20,
    },
    fetchImpl,
  });
  return { service, store };
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

  it("reports a disabled assistant instead of starting a run", async () => {
    const store = new MemoryStateStore();
    const service = new AssistantService({
      store,
      sessions: fakeSessions(),
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
