import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message, MessagePage, Session } from "@amoshydra/oktoso-contracts";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../lib/logger";
import { TranscriptCacheService } from "./transcript-cache";

const logger = createLogger({ level: "silent" });
const roots: string[] = [];

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oktoso-transcripts-"));
  roots.push(path);
  return join(path, "transcripts");
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function session(overrides: Partial<Session> = {}): Session {
  return {
    ref: "test:ses_1",
    providerID: "test",
    nativeID: "ses_1",
    title: "Session one",
    project: "oktoso",
    status: "idle",
    unread: false,
    updatedAt: 100,
    createdAt: 50,
    ...overrides,
  };
}

function message(id: string, createdAt: number, text = "hello"): Message {
  return {
    id,
    sessionRef: "test:ses_1",
    role: "assistant",
    parts: [{ type: "text", text }],
    createdAt,
  };
}

function page(messages: Message[], next: string | null = null): MessagePage {
  return { data: messages, cursor: { previous: null, next } };
}

async function setup(options: { enabled?: boolean; now?: () => number } = {}) {
  const store = new MemoryStateStore();
  if (options.enabled) {
    await store.update((state) => {
      state.transcriptCache = {
        enabled: true,
        ttlDays: 7,
        maxSessions: 200,
      };
    });
  }
  const service = new TranscriptCacheService({
    root: await root(),
    store,
    logger,
    ...(options.now ? { now: options.now } : {}),
  });
  await service.init();
  return { service, store };
}

describe("TranscriptCacheService", () => {
  it("keeps nothing while the cache is off", async () => {
    const { service, store } = await setup();

    await service.record(session(), page([message("m1", 1)]));

    expect(await service.read("test:ses_1")).toBeUndefined();
    expect(await service.all()).toEqual([]);
    expect(store.getState().transcriptCache.enabled).toBe(false);
    expect(service.stats().sessions).toBe(0);
  });

  it("stores a read and reports it in the stats", async () => {
    const { service } = await setup({ enabled: true });

    await service.record(
      session(),
      page([message("m1", 1, "first"), message("m2", 2, "second")]),
    );

    const cached = await service.read("test:ses_1");
    expect(cached?.ref).toBe("test:ses_1");
    expect(cached?.title).toBe("Session one");
    expect(cached?.updatedAt).toBe(100);
    expect(cached?.complete).toBe(true);
    expect(cached?.messages.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(service.stats()).toMatchObject({
      sessions: 1,
      completeSessions: 1,
    });
    expect(service.stats().bytes).toBeGreaterThan(0);
  });

  it("merges a later page of the same revision without duplicating messages", async () => {
    const { service } = await setup({ enabled: true });

    await service.record(session(), page([message("m2", 2)], "older"));
    expect((await service.read("test:ses_1"))?.complete).toBe(false);

    await service.record(
      session(),
      page([message("m1", 1), message("m2", 2)], null),
    );

    const cached = await service.read("test:ses_1");
    expect(cached?.messages.map((item) => item.id)).toEqual(["m1", "m2"]);
    expect(cached?.complete).toBe(true);
  });

  it("replaces the transcript when the provider revision changes", async () => {
    const { service } = await setup({ enabled: true });

    await service.record(session(), page([message("m1", 1, "old")]));
    await service.record(
      session({ updatedAt: 200 }),
      page([message("m9", 9, "new")]),
    );

    const cached = await service.read("test:ses_1");
    expect(cached?.updatedAt).toBe(200);
    expect(cached?.messages.map((item) => item.id)).toEqual(["m9"]);
  });

  it("drops a transcript past its TTL", async () => {
    let now = 1_000;
    const { service } = await setup({ enabled: true, now: () => now });

    await service.record(session(), page([message("m1", 1)]));
    now += 8 * 24 * 60 * 60 * 1_000;

    expect(await service.read("test:ses_1")).toBeUndefined();
    expect(service.stats().sessions).toBe(0);
  });

  it("evicts the least recently used transcript past the session cap", async () => {
    let now = 1_000;
    const { service, store } = await setup({ enabled: true, now: () => now });
    await store.update((state) => {
      state.transcriptCache = { enabled: true, ttlDays: 7, maxSessions: 10 };
    });

    for (let index = 0; index < 11; index += 1) {
      now += 1_000;
      await service.record(
        session({ ref: `test:ses_${index}`, nativeID: `ses_${index}` }),
        page([message(`m${index}`, index)]),
      );
    }

    expect(service.stats().sessions).toBe(10);
    expect(await service.read("test:ses_0")).toBeUndefined();
    expect(await service.read("test:ses_10")).toBeDefined();
  });

  it("deletes stored transcripts when the cache is turned off", async () => {
    const { service } = await setup({ enabled: true });
    const directory = await root();

    await service.record(session(), page([message("m1", 1)]));
    const view = await service.update({ enabled: false });

    expect(view.settings.enabled).toBe(false);
    expect(view.stats.sessions).toBe(0);
    expect(await service.read("test:ses_1")).toBeUndefined();

    const leftover = await readdir(directory).catch(() => [] as string[]);
    expect(leftover.filter((name) => name !== "index.json")).toEqual([]);
  });

  it("clears without touching provider state", async () => {
    const { service } = await setup({ enabled: true });

    await service.record(session(), page([message("m1", 1)]));
    await service.clear();

    expect(service.stats().sessions).toBe(0);
    expect(await service.all()).toEqual([]);
    expect(service.settings().enabled).toBe(true);
  });

  it("ignores a corrupt index instead of failing to start", async () => {
    const store = new MemoryStateStore();
    const directory = await root();
    const { mkdir } = await import("node:fs/promises");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "index.json"), "{not json", { mode: 0o600 });

    const service = new TranscriptCacheService({
      root: directory,
      store,
      logger,
    });
    await service.init();

    expect(service.stats().sessions).toBe(0);
  });
});
