import { describe, expect, it } from "vitest";
import type { Session, SessionListQuery } from "@amoshydra/oktoso-contracts";
import type { ProviderAdapter } from "@amoshydra/oktoso-providers";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { createLogger } from "../lib/logger";
import type { ProviderRegistry } from "./provider-registry";
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
    timeoutMs: () => 15_000,
  } as unknown as ProviderRegistry;
}

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
  });
});
;
