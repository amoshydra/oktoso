import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLogger } from "../lib/logger";
import type { CachedTranscript } from "./transcript-cache";
import { SearchIndexService, snippetAround, tokenize } from "./search-index";

const logger = createLogger({ level: "silent" });
const roots: string[] = [];

async function root(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "oktoso-search-"));
  roots.push(path);
  return path;
}

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
  return {
    id,
    role: "assistant" as const,
    createdAt: at,
    text,
  };
}

async function setup() {
  const index = new SearchIndexService({ root: await root(), logger });
  await index.init([]);
  return index;
}

describe("tokenize", () => {
  it("splits camelCase and snake_case identifiers", () => {
    expect(tokenize("sessionService.openSession")).toEqual([
      "session",
      "service",
      "open",
      "session",
    ]);
    expect(tokenize("session_service")).toEqual(["session", "service"]);
  });

  it("keeps digit-bearing terms and drops one-character noise", () => {
    expect(tokenize("auth race 401 a")).toEqual(["auth", "race", "401"]);
  });
});

describe("snippetAround", () => {
  it("windows around the first matched term", () => {
    const text = `${"x ".repeat(100)}velvet quarantine ledger${" y".repeat(100)}`;
    const snippet = snippetAround(text, "quarantine");
    expect(snippet).toContain("quarantine");
    expect(snippet.length).toBeLessThanOrEqual(162);
    expect(snippet.startsWith("…")).toBe(true);
  });
});

describe("SearchIndexService", () => {
  it("finds a message by a term and returns its snippet", async () => {
    const index = await setup();
    await index.update(
      transcript({
        ref: "desktop-opencode:ses_1",
        title: "Fix auth race",
        messages: [
          message("m1", "The gateway drops the refresh token."),
          message("m2", "Token rotation happens on every write."),
        ],
      }),
    );

    const hits = index.search("refresh");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      ref: "desktop-opencode:ses_1",
      kind: "message",
      messageID: "m1",
      role: "assistant",
    });
    expect(hits[0]?.snippet).toContain("refresh");
  });

  it("ranks a title hit above a passing body mention", async () => {
    const index = await setup();
    await index.update(
      transcript({
        ref: "a:1",
        title: "Auth race in the gateway",
        messages: [message("m1", "An unrelated note about the weather.")],
      }),
    );
    await index.update(
      transcript({
        ref: "b:2",
        title: "Something else",
        messages: [message("m2", "We hit an auth race yesterday, briefly.")],
      }),
    );

    const hits = index.search("auth");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0]?.ref).toBe("a:1");
    expect(hits[0]?.kind).toBe("title");
  });

  it("requires every term in a document, then falls back to any term", async () => {
    const index = await setup();
    await index.update(
      transcript({
        ref: "a:1",
        title: "One",
        messages: [
          message("m1", "alpha beta together"),
          message("m2", "alpha alone"),
        ],
      }),
    );

    const and = index.search("alpha beta");
    expect(and).toHaveLength(1);
    expect(and[0]?.messageID).toBe("m1");

    // No document has both, so the query falls back to any-term scoring.
    const or = index.search("alpha gamma");
    expect(or.map((hit) => hit.messageID).sort()).toEqual(["m1", "m2"]);
  });

  it("filters by provider, project, session, and kind", async () => {
    const index = await setup();
    await index.update(
      transcript({
        ref: "a:1",
        providerID: "p1",
        project: "alpha",
        title: "Deploy notes",
        messages: [message("m1", "deploy the gateway")],
      }),
    );
    await index.update(
      transcript({
        ref: "b:2",
        providerID: "p2",
        project: "beta",
        title: "Other",
        messages: [message("m2", "deploy the gateway")],
      }),
    );

    // "Deploy notes" is also a title, so a hit can be a title document.
    expect(
      index.search("deploy", { providerID: "p1", kind: "message" }),
    ).toHaveLength(1);
    expect(
      index.search("deploy", { project: "beta", kind: "message" })[0]?.ref,
    ).toBe("b:2");
    expect(
      index.search("deploy", { sessionRef: "a:1", kind: "message" }),
    ).toHaveLength(1);
    expect(index.search("deploy", { kind: "title" })).toHaveLength(1);
    expect(index.search("deploy", { limit: 1 })).toHaveLength(1);
  });

  it("replaces a session revision instead of duplicating it", async () => {
    const index = await setup();
    await index.update(
      transcript({
        ref: "a:1",
        title: "Before",
        updatedAt: 100,
        messages: [message("m1", "legacy token handling")],
      }),
    );
    await index.update(
      transcript({
        ref: "a:1",
        title: "After",
        updatedAt: 200,
        messages: [message("m2", "rotation handles tokens")],
      }),
    );

    expect(index.search("legacy")).toHaveLength(0);
    expect(index.search("rotation")[0]?.messageID).toBe("m2");
    expect(index.stats().sessions).toBe(1);
  });

  it("drops every document when a session is removed", async () => {
    const index = await setup();
    await index.update(
      transcript({
        ref: "a:1",
        messages: [message("m1", "ephemeral phrase")],
      }),
    );
    await index.remove("a:1");

    expect(index.search("ephemeral")).toEqual([]);
    expect(index.stats().documents).toBe(0);
  });

  it("reloads its snapshot with the same results", async () => {
    const directory = await root();
    const first = new SearchIndexService({ root: directory, logger });
    await first.init([]);
    await first.update(
      transcript({
        ref: "a:1",
        title: "Recall",
        messages: [message("m1", "velvet quarantine ledger")],
      }),
    );
    await first.whenIdle();

    const second = new SearchIndexService({ root: directory, logger });
    await second.init([]);
    const hits = second.search("quarantine");

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ ref: "a:1", messageID: "m1" });
    expect(second.stats().documents).toBe(first.stats().documents);
  });

  it("rebuilds from cache data when the snapshot is unreadable", async () => {
    const directory = await root();
    await writeFile(join(directory, "meta.json"), "{not json", { mode: 0o600 });

    const index = new SearchIndexService({ root: directory, logger });
    await index.init([
      transcript({ ref: "a:1", messages: [message("m1", "recovered phrase")] }),
    ]);

    expect(index.search("recovered")).toHaveLength(1);
  });

  it("compacts the delta layer without losing hits", async () => {
    const index = await setup();
    for (let session = 0; session < 80; session += 1) {
      await index.update(
        transcript({
          ref: `p:${session}`,
          updatedAt: 100,
          title: `Session ${session}`,
          messages: [message(`m${session}`, `payload ${session} shared token`)],
        }),
      );
    }
    expect(index.stats().deltaDocuments).toBeGreaterThan(0);
    expect(index.stats().sessions).toBe(80);
    expect(index.search("shared")).toHaveLength(20);
    expect(index.search("payload 79")[0]?.ref).toBe("p:79");
  });

  it("leaves no files behind when cleared", async () => {
    const directory = await root();
    const index = new SearchIndexService({ root: directory, logger });
    await index.init([]);
    await index.update(
      transcript({ ref: "a:1", messages: [message("m1", "secret phrase")] }),
    );
    await index.whenIdle();
    expect(await readdir(directory)).not.toEqual([]);

    await index.clear();

    expect(await readdir(directory)).toEqual([]);
    expect(index.search("secret")).toEqual([]);
  });

  it("reconciles against the cache, updating and dropping sessions", async () => {
    const index = await setup();
    await index.update(
      transcript({
        ref: "a:1",
        updatedAt: 100,
        messages: [message("m1", "old body")],
      }),
    );
    await index.update(
      transcript({
        ref: "gone:2",
        updatedAt: 100,
        messages: [message("m2", "removed body")],
      }),
    );

    await index.reconcile([
      transcript({
        ref: "a:1",
        updatedAt: 200,
        messages: [message("m3", "new body")],
      }),
    ]);

    expect(index.search("old")).toHaveLength(0);
    expect(index.search("new")[0]?.ref).toBe("a:1");
    expect(index.search("removed")).toHaveLength(0);
  });

  it("keeps scores correct when a revised session is compacted", async () => {
    const rootA = await root();
    const churn = new SearchIndexService({ root: rootA, logger });
    await churn.init([]);
    const original = transcript({
      ref: "a:1",
      updatedAt: 1,
      messages: [message("m1", "alpha alpha alpha")],
    });
    await churn.update(original);
    await churn.update({
      ...original,
      updatedAt: 2,
      messages: [message("m2", "alpha")],
    });
    const others = Array.from({ length: 70 }, (_, index) =>
      transcript({
        ref: `c:${index}`,
        title: `Ordinary ${index}`,
        updatedAt: 1,
        messages: [message(`x${index}`, `unrelated payload ${index}`)],
      }),
    );
    for (const entry of others) await churn.update(entry);

    const clean = new SearchIndexService({ root: await root(), logger });
    await clean.init([]);
    await clean.update({ ...original, updatedAt: 2, messages: [message("m2", "alpha")] });
    for (const entry of others) await clean.update(entry);

    const churned = churn.search("alpha")[0]!;
    const fresh = clean.search("alpha")[0]!;
    expect(churned.messageID).toBe("m2");
    expect(churned.score).toBeCloseTo(fresh.score, 6);
  });

  it("does not resurrect a removed session after a reload", async () => {
    const directory = await root();
    const index = new SearchIndexService({ root: directory, logger });
    await index.init([]);
    await index.update(
      transcript({ ref: "a:1", messages: [message("m1", "alpha body")] }),
    );
    await index.update(
      transcript({ ref: "b:2", messages: [message("m2", "beta body")] }),
    );
    await index.remove("b:2");
    await index.whenIdle();
    const before = index.stats().documents;

    const reloaded = new SearchIndexService({ root: directory, logger });
    await reloaded.init([]);

    expect(reloaded.stats().documents).toBe(before);
    expect(reloaded.search("beta")).toEqual([]);
    expect(reloaded.search("alpha")[0]?.ref).toBe("a:1");
  });

  it("rejects a snapshot whose files disagree", async () => {
    const directory = await root();
    const index = new SearchIndexService({ root: directory, logger });
    await index.init([]);
    await index.update(
      transcript({ ref: "a:1", messages: [message("m1", "alpha body")] }),
    );
    await index.whenIdle();

    const postings = await readFile(join(directory, "postings.bin"));
    postings[8] = (postings[8]! + 1) % 256;
    await writeFile(join(directory, "postings.bin"), postings);

    const reloaded = new SearchIndexService({ root: directory, logger });
    await reloaded.init([]);
    expect(reloaded.stats().documents).toBe(0);
    expect(reloaded.search("alpha")).toEqual([]);
  });

  it("leaves nothing when cleared while a write is pending", async () => {
    const directory = await root();
    const index = new SearchIndexService({ root: directory, logger });
    await index.init([]);
    await index.update(
      transcript({ ref: "a:1", messages: [message("m1", "alpha body")] }),
    );
    const flush = index.whenIdle();
    await index.clear();
    await flush;

    expect(await readdir(directory)).toEqual([]);
  });

  it("orders ties the same way regardless of query word order", async () => {
    const index = await setup();
    await index.update(
      transcript({ ref: "a:1", messages: [message("m1", "alpha beta")] }),
    );
    await index.update(
      transcript({ ref: "b:2", messages: [message("m2", "alpha beta")] }),
    );

    const forwards = index.search("alpha beta", { scope: "session" });
    const backwards = index.search("beta alpha", { scope: "session" });

    expect(forwards.map((hit) => hit.ref)).toEqual(backwards.map((hit) => hit.ref));
  });

  it("keeps one candidate per session for the session scope", async () => {
    const index = await setup();
    await index.update(
      transcript({
        ref: "a:1",
        messages: [
          message("m1", "shared phrase", 1),
          message("m2", "shared phrase again", 2),
        ],
      }),
    );

    expect(index.search("shared").length).toBe(2);
    expect(index.search("shared", { scope: "session" }).length).toBe(1);
  });

  it("does not grow the session table when one session is revised", async () => {
    const directory = await root();
    const index = new SearchIndexService({ root: directory, logger });
    await index.init([]);
    for (let revision = 0; revision < 40; revision += 1) {
      await index.update(
        transcript({
          ref: "a:1",
          updatedAt: revision,
          messages: [message(`m${revision}`, `revision ${revision}`)],
        }),
      );
    }
    await index.whenIdle();

    const meta = JSON.parse(
      await readFile(join(directory, "meta.json"), "utf8"),
    ) as { sessions: unknown[] };
    expect(meta.sessions).toHaveLength(1);
  });
});
