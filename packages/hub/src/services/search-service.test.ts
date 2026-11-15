import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Session } from "@amoshydra/oktoso-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../lib/logger";
import type { CachedTranscript } from "./transcript-cache";
import { SearchIndexService } from "./search-index";
import { SearchService } from "./search-service";
import type { SessionService } from "./session-service";

const logger = createLogger({ level: "silent" });
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

function transcript(
  overrides: Partial<CachedTranscript> & { ref: string },
): CachedTranscript {
  return {
    updatedAt: 100,
    providerID: "desktop-opencode",
    title: "Session",
    project: "oktoso",
    complete: true,
    truncated: false,
    messages: [],
    storedAt: 1_000,
    ...overrides,
  };
}

function message(id: string, text: string, at = 1) {
  return { id, role: "assistant" as const, createdAt: at, text };
}

async function setup(
  entries: CachedTranscript[],
  options: { sessions?: Session[] } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "oktoso-search-service-"));
  roots.push(root);
  const index = new SearchIndexService({ root, logger });
  await index.init(entries);
  const sessions = new Map(
    (options.sessions ?? []).map((session) => [session.ref, session]),
  );
  const service = new SearchService({
    index,
    sessions: { peek: (ref: string) => sessions.get(ref) } as unknown as SessionService,
  });
  return { service, index };
}

function session(overrides: Partial<Session> & { ref: string }): Session {
  return {
    providerID: "desktop-opencode",
    nativeID: "ses_1",
    title: "Session",
    status: "idle",
    unread: false,
    updatedAt: 100,
    createdAt: 50,
    ...overrides,
  };
}

describe("SearchService", () => {
  it("dedupes sessions and keeps the best message", async () => {
    const { service } = await setup([
      transcript({
        ref: "a:1",
        title: "Auth work",
        messages: [
          message("m1", "the gateway drops the token", 10),
          message("m2", "token token token everywhere", 20),
        ],
      }),
      transcript({
        ref: "b:2",
        title: "Other",
        messages: [message("m3", "token handling", 30)],
      }),
    ]);

    const page = await service.search({ q: "token", scope: "sessions" });

    expect(page.data).toHaveLength(2);
    expect(page.data.map((row) => row.ref).sort()).toEqual(["a:1", "b:2"]);
    const first = page.data[0]!;
    expect(first.messageID).toBeDefined();
    expect(first.match).toBe("message");
    expect(first.snippet).toContain("token");
    expect(page.ready).toBe(true);
  });

  it("returns one row per message in the messages scope", async () => {
    const { service } = await setup([
      transcript({
        ref: "a:1",
        messages: [
          message("m1", "token one", 10),
          message("m2", "token two", 20),
        ],
      }),
    ]);

    const page = await service.search({ q: "token", scope: "messages" });

    expect(page.data).toHaveLength(2);
    expect(page.data.map((row) => row.messageID).sort()).toEqual(["m1", "m2"]);
  });

  it("marks a title match as a session row", async () => {
    const { service } = await setup([
      transcript({
        ref: "a:1",
        title: "Gateway migration",
        messages: [message("m1", "unrelated words")],
      }),
    ]);

    const page = await service.search({ q: "migration", scope: "sessions" });

    expect(page.data).toHaveLength(1);
    expect(page.data[0]).toMatchObject({ match: "session", ref: "a:1" });
    expect(page.data[0]?.messageID).toBeUndefined();
  });

  it("paginates without repeating or dropping rows", async () => {
    const { service } = await setup(
      Array.from({ length: 5 }, (_, index) =>
        transcript({
          ref: `s:${index}`,
          title: `Session ${index}`,
          messages: [message(`m${index}`, `shared term ${index}`, index)],
        }),
      ),
    );

    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.search({ q: "shared", limit: 2, ...(cursor ? { cursor } : {}) });
      seen.push(...page.data.map((row) => row.ref));
      cursor = page.cursor.next ?? undefined;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  it("reports a previous cursor on the second page", async () => {
    const { service } = await setup(
      Array.from({ length: 3 }, (_, index) =>
        transcript({
          ref: `s:${index}`,
          messages: [message(`m${index}`, `shared term ${index}`, index)],
        }),
      ),
    );

    const first = await service.search({ q: "shared", limit: 2 });
    expect(first.cursor.previous).toBeNull();
    expect(first.cursor.next).not.toBeNull();

    const second = await service.search({
      q: "shared",
      limit: 2,
      cursor: first.cursor.next!,
    });
    expect(second.cursor.previous).not.toBeNull();
  });

  it("rejects a corrupt cursor", async () => {
    const { service } = await setup([]);
    await expect(service.search({ q: "x", cursor: "nonsense" })).rejects.toThrow(
      /Invalid search cursor/,
    );
  });

  it("filters by provider and session status", async () => {
    const { service } = await setup(
      [
        transcript({
          ref: "a:1",
          providerID: "p1",
          messages: [message("m1", "shared token")],
        }),
        transcript({
          ref: "b:2",
          providerID: "p2",
          messages: [message("m2", "shared token")],
        }),
      ],
      {
        sessions: [
          session({ ref: "a:1", status: "error" }),
          session({ ref: "b:2", status: "idle" }),
        ],
      },
    );

    const byProvider = await service.search({ q: "shared", provider: "p1" });
    expect(byProvider.data.map((row) => row.ref)).toEqual(["a:1"]);

    const byStatus = await service.search({ q: "shared", status: "idle" });
    expect(byStatus.data.map((row) => row.ref)).toEqual(["b:2"]);
  });

  it("returns metadata from the session cache", async () => {
    const { service } = await setup(
      [transcript({ ref: "a:1", messages: [message("m1", "shared token")] })],
      {
        sessions: [
          session({
            ref: "a:1",
            directory: "/home/me/oktoso",
            project: "oktoso",
          }),
        ],
      },
    );

    const page = await service.search({ q: "shared" });
    expect(page.data[0]?.directory).toBe("/home/me/oktoso");
  });
});
