import { describe, expect, it, vi } from "vitest";
import type { Session, SessionListQuery } from "@amoshydra/oktoso-contracts";
import { ProviderError, type ProviderAdapter } from "@amoshydra/oktoso-providers";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { createLogger } from "../lib/logger";
import { notImplemented } from "../domain/errors";
import type { ProviderRegistry } from "./provider-registry";
import type { TranscriptCacheService } from "./transcript-cache";
import { SessionService } from "./session-service";

const logger = createLogger({ level: "silent" });

function makeSession(
  overrides: Partial<Session> & Pick<Session, "ref" | "title">,
): Session {
  return {
    providerID: "test",
    nativeID: overrides.ref.slice(overrides.ref.indexOf(":") + 1),
    status: "idle",
    unread: false,
    updatedAt: 100,
    createdAt: 50,
    ...overrides,
  };
}

function makeRegistry(adapters: ProviderAdapter[]): ProviderRegistry {
  return {
    adapters: () => adapters,
    adapter: (id: string) => adapters.find((adapter) => adapter.id === id),
    get: (id: string) =>
      adapters.some((adapter) => adapter.id === id)
        ? { id, enabled: true, status: "online" }
        : undefined,
    timeoutMs: () => 15_000,
  } as unknown as ProviderRegistry;
}

describe("SessionService session cache", () => {
  it("drops a cached session when the provider returns not found", async () => {
    const session = makeSession({
      ref: "test:ses_gone",
      providerID: "test",
      title: "Deleted session",
    });
    let missing = false;
    const adapter = {
      id: "test",
      getSession: async () => {
        if (missing) {
          throw new ProviderError("not_found", "Session not found", {
            status: 404,
          });
        }
        return { ...session };
      },
    } as unknown as ProviderAdapter;
    const transcripts = {
      forget: vi.fn(async () => undefined),
    } as unknown as TranscriptCacheService;
    const sessions = new SessionService(makeRegistry([adapter]), logger, {
      transcripts,
    });

    await expect(sessions.get(session.ref)).resolves.toMatchObject({
      ref: session.ref,
    });
    expect(sessions.cachedSession(session.ref)).toBeDefined();

    missing = true;
    await expect(sessions.get(session.ref)).rejects.toMatchObject({
      code: "not_found",
    });
    expect(sessions.cachedSession(session.ref)).toBeUndefined();
    expect(transcripts.forget).toHaveBeenCalledWith(session.ref);
  });
});

describe("SessionService rename", () => {
  it("updates the session and retitles the cached transcript", async () => {
    const session = makeSession({
      ref: "test:ses_rename",
      providerID: "test",
      title: "Old title",
    });
    const renamed = { ...session, title: "New title", updatedAt: 200 };
    const adapter = {
      id: "test",
      capabilities: { rename: true },
      renameSession: async () => renamed,
    } as unknown as ProviderAdapter;
    const transcripts = {
      retitle: vi.fn(async () => undefined),
    } as unknown as TranscriptCacheService;
    const sessions = new SessionService(makeRegistry([adapter]), logger, {
      transcripts,
    });

    await expect(sessions.rename(session.ref, "New title")).resolves.toMatchObject(
      { title: "New title", updatedAt: 200 },
    );
    expect(sessions.cachedSession(session.ref)?.title).toBe("New title");
    expect(transcripts.retitle).toHaveBeenCalledWith(
      session.ref,
      "New title",
      200,
    );
  });
});

describe("SessionService read markers", () => {  it("keeps a session read across provider refreshes until new activity", async () => {
    const session: Session = {
      ref: "test:ses_1",
      providerID: "test",
      nativeID: "ses_1",
      title: "Read marker test",
      status: "idle",
      unread: true,
      updatedAt: 100,
      createdAt: 50,
    };
    const adapter = {
      id: "test",
      listSessions: async () => ({
        data: [{ ...session }],
        cursor: { next: null, previous: null },
      }),
      getSession: async () => ({ ...session }),
      markRead: async () => undefined,
    } as unknown as ProviderAdapter;
    const registry = {
      adapters: () => [adapter],
      adapter: (id: string) => (id === "test" ? adapter : undefined),
      timeoutMs: () => 15_000,
    } as unknown as ProviderRegistry;
    const store = new MemoryStateStore();
    const sessions = new SessionService(registry, logger, {
      store,
      ttlMs: 60_000,
    });

    await sessions.refresh();
    expect((await sessions.list({})).data[0]?.unread).toBe(true);

    await sessions.markRead(session.ref);
    expect(store.getState().readMarkers[session.ref]).toMatchObject({
      updatedAt: 100,
    });

    sessions.invalidate();
    await sessions.refresh();
    expect((await sessions.list({})).data[0]?.unread).toBe(false);

    session.updatedAt = 200;
    sessions.invalidate();
    await sessions.refresh();
    expect((await sessions.list({})).data[0]?.unread).toBe(true);
  });
  it("can exclude child sessions from the session list", async () => {
    const root: Session = {
      ref: "test:ses_root",
      providerID: "test",
      nativeID: "ses_root",
      title: "Root session",
      status: "idle",
      unread: false,
      updatedAt: 200,
      createdAt: 100,
    };
    const child: Session = {
      ...root,
      ref: "test:ses_child",
      nativeID: "ses_child",
      title: "Child session",
      parentRef: root.ref,
      updatedAt: 300,
    };
    const adapter = {
      id: "test",
      listSessions: async () => ({
        data: [root, child],
        cursor: { next: null, previous: null },
      }),
    } as unknown as ProviderAdapter;
    const registry = {
      adapters: () => [adapter],
      adapter: (id: string) => (id === "test" ? adapter : undefined),
      timeoutMs: () => 15_000,
    } as unknown as ProviderRegistry;
    const sessions = new SessionService(registry, logger);

    expect((await sessions.list({})).data).toHaveLength(2);
    expect((await sessions.list({ scope: "root" })).data).toEqual([
      expect.objectContaining({ ref: root.ref }),
    ]);
  });
});

describe("SessionService create", () => {
  function createAdapter(overrides: Record<string, unknown> = {}) {
    const calls: string[] = [];
    const adapter = {
      id: "test",
      capabilities: { create: true, send: true, attach: false },
      async createSession(input: { title: string }) {
        calls.push(`create:${input.title}`);
        return makeSession({ ref: "test:ses_created", title: input.title });
      },
      async sendMessage(ref: string, input: { text: string }) {
        calls.push(`send:${ref}:${input.text}`);
        return { accepted: true, messageID: "msg_1" };
      },
      ...overrides,
    } as unknown as ProviderAdapter;
    return { adapter, calls };
  }

  it("creates a session without sending when there is no text", async () => {
    const { adapter, calls } = createAdapter();
    const sessions = new SessionService(makeRegistry([adapter]), logger);

    const created = await sessions.create({
      providerID: "test",
      title: "Empty session",
    });

    expect(created.ref).toBe("test:ses_created");
    expect(calls).toEqual(["create:Empty session"]);
  });

  it("sends the first prompt after creating the session", async () => {
    const { adapter, calls } = createAdapter();
    const sessions = new SessionService(makeRegistry([adapter]), logger);

    const created = await sessions.create({
      providerID: "test",
      title: "Nightly review",
      text: "  Review the repository.  ",
    });

    expect(created.ref).toBe("test:ses_created");
    expect(calls).toEqual([
      "create:Nightly review",
      "send:test:ses_created:Review the repository.",
    ]);
    expect((await sessions.list({})).data).toHaveLength(1);
  });

  it("keeps the provider error code when the first prompt fails", async () => {
    const { adapter } = createAdapter({
      async sendMessage() {
        throw new ProviderError("rate_limited", "provider said no", {
          status: 429,
        });
      },
    });
    const sessions = new SessionService(makeRegistry([adapter]), logger);

    const failure = await sessions
      .create({
        providerID: "test",
        title: "First prompt fails",
        text: "Hello",
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderError);
    expect(failure).toMatchObject({
      code: "rate_limited",
      status: 429,
      retryable: false,
      details: { ref: "test:ses_created" },
      message: expect.stringContaining("test:ses_created"),
    });
  });

  it("marks a created session's prompt failure as not retryable", async () => {
    const { adapter } = createAdapter({
      async sendMessage() {
        throw notImplemented("This provider stopped mid-send");
      },
    });
    const sessions = new SessionService(makeRegistry([adapter]), logger);

    const failure = await sessions
      .create({
        providerID: "test",
        title: "Partial failure",
        text: "Hello",
      })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      code: "not_implemented",
      status: 501,
      retryable: false,
      details: { ref: "test:ses_created" },
    });
    expect((await sessions.list({})).data).toHaveLength(1);
  });

  it("names an unknown provider instead of blaming its capabilities", async () => {
    const { adapter } = createAdapter();
    const sessions = new SessionService(makeRegistry([adapter]), logger);

    await expect(
      sessions.create({ providerID: "ghost", title: "Unknown provider" }),
    ).rejects.toMatchObject({
      code: "not_found",
      status: 404,
      message: "Provider not found: ghost",
    });
  });

  it("refuses a first prompt when the provider cannot send", async () => {
    const { adapter, calls } = createAdapter({
      capabilities: { create: true, send: false, attach: false },
    });
    const sessions = new SessionService(makeRegistry([adapter]), logger);

    await expect(
      sessions.create({
        providerID: "test",
        title: "Cannot send",
        text: "Hello",
      }),
    ).rejects.toThrow(/cannot send messages/);
    expect(calls).toEqual([]);
  });

  it("returns the running session after the first prompt", async () => {
    const { adapter } = createAdapter();
    const sessions = new SessionService(makeRegistry([adapter]), logger);

    const created = await sessions.create({
      providerID: "test",
      title: "Running",
      text: "Hello",
    });

    expect(created.status).toBe("running");
  });
});

describe("SessionService resilience", () => {
  it("returns cached sessions immediately while a stale refresh is slow", async () => {
    const cached = makeSession({
      ref: "test:cached",
      title: "Cached session",
    });
    let slow = false;
    let release: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const adapter = {
      id: "test",
      listSessions: async () => {
        if (slow) {
          markStarted?.();
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return {
          data: [cached],
          cursor: { next: null, previous: null },
        };
      },
    } as unknown as ProviderAdapter;
    const sessions = new SessionService(makeRegistry([adapter]), logger, {
      ttlMs: 60_000,
      coldStartWaitMs: 50,
    });

    await sessions.refresh();
    slow = true;
    sessions.invalidate();

    const before = Date.now();
    const page = await sessions.list({});
    const elapsed = Date.now() - before;

    expect(page.data).toEqual([expect.objectContaining({ ref: cached.ref })]);
    expect(elapsed).toBeLessThan(200);

    await started;
    release?.();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  it("skips an offline provider and keeps its cached sessions", async () => {
    let badStatus: "online" | "offline" = "online";
    let badCalls = 0;
    const goodSession = makeSession({
      ref: "good:ses_good",
      providerID: "good",
      title: "Good session",
    });
    const badSession = makeSession({
      ref: "bad:ses_bad",
      providerID: "bad",
      title: "Cached bad session",
    });
    const adapters = [
      {
        id: "bad",
        listSessions: async () => {
          badCalls += 1;
          return {
            data: [badSession],
            cursor: { next: null, previous: null },
          };
        },
      },
      {
        id: "good",
        listSessions: async () => ({
          data: [goodSession],
          cursor: { next: null, previous: null },
        }),
      },
    ] as unknown as ProviderAdapter[];
    const registry = {
      adapters: () => adapters,
      adapter: (id: string) => adapters.find((adapter) => adapter.id === id),
      get: (id: string) => ({
        id,
        enabled: true,
        status: id === "bad" ? badStatus : "online",
      }),
      timeoutMs: () => 1_000,
    } as unknown as ProviderRegistry;
    const sessions = new SessionService(registry, logger, { ttlMs: 60_000 });

    await sessions.refresh();
    expect(badCalls).toBe(1);

    badStatus = "offline";
    sessions.invalidate();
    await sessions.refresh();

    expect(badCalls).toBe(1);
    const page = await sessions.list({});
    expect(page.data.map((session) => session.ref)).toEqual(
      expect.arrayContaining([goodSession.ref, badSession.ref]),
    );
  });

  it("returns a partial page when a cold-start provider is slow", async () => {
    const goodSession = makeSession({
      ref: "good:ses_good",
      providerID: "good",
      title: "Good session",
    });
    const adapters = [
      {
        id: "good",
        listSessions: async () => ({
          data: [goodSession],
          cursor: { next: null, previous: null },
        }),
      },
      {
        id: "slow",
        listSessions: async (
          _query: SessionListQuery,
          signal: AbortSignal,
        ) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("sync deadline")),
              { once: true },
            );
          }),
      },
    ] as unknown as ProviderAdapter[];
    const sessions = new SessionService(makeRegistry(adapters), logger, {
      coldStartWaitMs: 40,
      syncTimeoutMs: 120,
      ttlMs: 60_000,
    });

    const before = Date.now();
    const page = await sessions.list({});
    const elapsed = Date.now() - before;

    expect(page.data.map((session) => session.ref)).toEqual([goodSession.ref]);
    expect(elapsed).toBeGreaterThanOrEqual(30);
    expect(elapsed).toBeLessThan(500);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await sessions.list({})).data.map((session) => session.ref)).toEqual([
      goodSession.ref,
    ]);
  });
});

describe("SessionService search", () => {
  it("queries providers for sessions outside the recent cache", async () => {
    const recent = makeSession({
      ref: "test:recent",
      title: "Recent sync",
      updatedAt: 200,
    });
    const archived = makeSession({
      ref: "test:archived",
      title: "Archived folder chat",
      updatedAt: 100,
    });
    const calls: SessionListQuery[] = [];
    const adapter = {
      id: "test",
      listSessions: async (query: SessionListQuery) => {
        calls.push(query);
        return {
          data: query.q ? [archived] : [recent],
          cursor: { next: null, previous: null },
        };
      },
    } as unknown as ProviderAdapter;
    const sessions = new SessionService(
      makeRegistry([adapter]),
      logger,
      { ttlMs: 60_000 },
    );

    await sessions.refresh();
    const page = await sessions.list({ q: "archived" });

    expect(page.data).toEqual([
      expect.objectContaining({ ref: archived.ref }),
    ]);
    expect(calls.some((call) => call.q === "archived")).toBe(true);
  });

  it("merges cached matches with provider results and deduplicates", async () => {
    const cached = makeSession({
      ref: "test:cached",
      title: "Archived cache hit",
      updatedAt: 100,
    });
    const providerOnly = makeSession({
      ref: "test:older",
      title: "Archived provider hit",
      updatedAt: 300,
    });
    const adapter = {
      id: "test",
      listSessions: async (query: SessionListQuery) => ({
        data: query.q ? [cached, providerOnly] : [cached],
        cursor: { next: null, previous: null },
      }),
    } as unknown as ProviderAdapter;
    const sessions = new SessionService(makeRegistry([adapter]), logger, {
      ttlMs: 60_000,
    });

    await sessions.refresh();
    const page = await sessions.list({ q: "archived" });

    expect(page.data.map((session) => session.ref)).toEqual([
      providerOnly.ref,
      cached.ref,
    ]);
  });

  it("applies provider, status, and root filters after provider search", async () => {
    const root = makeSession({
      ref: "a:root",
      providerID: "a",
      title: "Match root",
      status: "idle",
      updatedAt: 300,
    });
    const child = makeSession({
      ref: "a:child",
      providerID: "a",
      title: "Match child",
      status: "running",
      parentRef: root.ref,
      updatedAt: 200,
    });
    const other = makeSession({
      ref: "b:other",
      providerID: "b",
      title: "Match other",
      updatedAt: 400,
    });
    const calls: string[] = [];
    const adapterA = {
      id: "a",
      listSessions: async (query: SessionListQuery) => {
        if (query.q) calls.push("a");
        return {
          data: [root, child],
          cursor: { next: null, previous: null },
        };
      },
    } as unknown as ProviderAdapter;
    const adapterB = {
      id: "b",
      listSessions: async (query: SessionListQuery) => {
        if (query.q) calls.push("b");
        return {
          data: [other],
          cursor: { next: null, previous: null },
        };
      },
    } as unknown as ProviderAdapter;
    const sessions = new SessionService(
      makeRegistry([adapterA, adapterB]),
      logger,
    );

    const page = await sessions.list({
      q: "match",
      provider: "a",
      status: "idle",
      scope: "root",
    });

    expect(page.data.map((session) => session.ref)).toEqual([root.ref]);
    expect(calls).toEqual(["a"]);
  });

  it("keeps results from healthy providers when one search fails", async () => {
    const healthy = makeSession({
      ref: "b:match",
      providerID: "b",
      title: "Match from b",
    });
    const failing = {
      id: "a",
      listSessions: async () => {
        throw new Error("offline");
      },
    } as unknown as ProviderAdapter;
    const adapterB = {
      id: "b",
      listSessions: async () => ({
        data: [healthy],
        cursor: { next: null, previous: null },
      }),
    } as unknown as ProviderAdapter;
    const sessions = new SessionService(
      makeRegistry([failing, adapterB]),
      logger,
    );

    const page = await sessions.list({ q: "match" });

    expect(page.data).toEqual([
      expect.objectContaining({ ref: healthy.ref }),
    ]);
    expect(page.warnings).toEqual([
      { providerID: "a", message: "offline" },
    ]);
  });
});
;

describe("SessionService lineage", () => {
  function lineageAdapter(sessions: Session[]) {
    const byRef = new Map(sessions.map((entry) => [entry.ref, entry]));
    return {
      id: "test",
      capabilities: { create: false, send: false, attach: false },
      async listSessions() {
        return {
          data: [...sessions],
          cursor: { next: null, previous: null },
        };
      },
      async getSession(ref: string) {
        const found = byRef.get(ref);
        if (!found) throw new Error("not found");
        return found;
      },
    } as unknown as ProviderAdapter;
  }

  const base = (ref: string, overrides: Partial<Session> = {}): Session =>
    makeSession({
      ref,
      title: ref,
      ...overrides,
    });

  it("resolves ancestors and descendants around the current session", async () => {
    const root = base("test:a", { createdAt: 1, updatedAt: 1 });
    const branch = base("test:b", { parentRef: root.ref, createdAt: 2, updatedAt: 2 });
    const current = base("test:c", { parentRef: branch.ref, createdAt: 3, updatedAt: 3 });
    const child = base("test:d", { parentRef: current.ref, createdAt: 4, updatedAt: 4 });
    const sibling = base("test:e", { parentRef: root.ref, createdAt: 5, updatedAt: 5 });
    const sessions = new SessionService(
      makeRegistry([lineageAdapter([root, branch, current, child, sibling])]),
      logger,
    );

    const lineage = await sessions.lineage(current.ref);

    expect(lineage.root).toBe(root.ref);
    expect(lineage.current).toBe(current.ref);
    expect(lineage.truncated).toBe(false);
    expect(lineage.nodes.map((node) => [node.ref, node.depth, node.current])).toEqual([
      [root.ref, 0, false],
      [branch.ref, 1, false],
      [sibling.ref, 1, false],
      [current.ref, 2, true],
      [child.ref, 3, false],
    ]);
  });

  it("stops at a cycle instead of looping", async () => {
    const a = base("test:a", { parentRef: "test:c", createdAt: 1 });
    const b = base("test:b", { parentRef: a.ref, createdAt: 2 });
    const c = base("test:c", { parentRef: b.ref, createdAt: 3 });
    const sessions = new SessionService(
      makeRegistry([lineageAdapter([a, b, c])]),
      logger,
    );

    const lineage = await sessions.lineage(b.ref);

    expect(lineage.nodes.map((node) => node.ref).sort()).toEqual([
      "test:a",
      "test:b",
      "test:c",
    ]);
  });

  it("treats a missing ancestor as the root", async () => {
    const current = base("test:orphan", { parentRef: "test:gone", createdAt: 1 });
    const sessions = new SessionService(
      makeRegistry([lineageAdapter([current])]),
      logger,
    );

    const lineage = await sessions.lineage(current.ref);

    expect(lineage.root).toBe(current.ref);
    expect(lineage.nodes).toHaveLength(1);
  });

  it("caps a huge family and says it is partial", async () => {
    const root = base("test:root", { createdAt: 0 });
    const children = Array.from({ length: 120 }, (_, index) =>
      base(`test:child-${index}`, {
        parentRef: root.ref,
        createdAt: index + 1,
      }),
    );
    const sessions = new SessionService(
      makeRegistry([lineageAdapter([root, ...children])]),
      logger,
    );

    const lineage = await sessions.lineage(root.ref);

    expect(lineage.truncated).toBe(true);
    expect(lineage.nodes).toHaveLength(100);
  });
});
