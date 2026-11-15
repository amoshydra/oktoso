import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CachedTranscript } from "../packages/hub/src/services/transcript-cache";
import { SearchIndexService } from "../packages/hub/src/services/search-index";
import { createLogger } from "../packages/hub/src/lib/logger";

/**
 * C2 acceptance bench: search an old phrase across 500 cached sessions.
 *
 * Run with `pnpm exec tsx scripts/bench-search.ts`.
 */

const SESSIONS = 500;
const MESSAGES_PER_SESSION = 50;
const WORDS = [
  "gateway", "token", "rotation", "session", "migration", "socket", "cache",
  "approval", "watcher", "provider", "transcript", "index", "notify", "queue",
  "deploy", "container", "release", "review", "branch", "commit", "search",
  "snippet", "latency", "budget", "worker", "schema", "contract", "render",
  "compose", "transport", "endpoint", "credential", "expiry", "policy",
];

function pick(seed: number): string {
  return WORDS[Math.abs(seed) % WORDS.length]!;
}

function sessions(): CachedTranscript[] {
  const out: CachedTranscript[] = [];
  let seed = 7;
  for (let session = 0; session < SESSIONS; session += 1) {
    const messages = [];
    for (let message = 0; message < MESSAGES_PER_SESSION; message += 1) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const words = Array.from({ length: 40 }, (_, word) =>
        pick(seed + word * 31 + message * 7),
      );
      if (session === 42 && message === 33) {
        words.splice(20, 0, "velvet", "quarantine", "ledger");
      }
      messages.push({
        id: `m${session}_${message}`,
        role: message % 2 === 0 ? ("user" as const) : ("assistant" as const),
        createdAt: 1_700_000_000_000 + message * 1_000,
        text: words.join(" "),
      });
    }
    out.push({
      ref: `desktop-opencode:ses_${session}`,
      providerID: "desktop-opencode",
      title: `Session ${session} ${pick(session)} work`,
      project: `project-${session % 15}`,
      updatedAt: 1_700_000_000_000,
      complete: true,
      truncated: false,
      messages,
      storedAt: 1_700_000_000_000,
    });
  }
  return out;
}

const logger = createLogger({ level: "silent" });
const root = await mkdtemp(join(tmpdir(), "oktoso-bench-"));

try {
  const data = sessions();
  const bytes = Buffer.byteLength(JSON.stringify(data));
  const index = new SearchIndexService({ root, logger });

  const buildStarted = performance.now();
  await index.init(data);
  const buildMs = performance.now() - buildStarted;
  await index.whenIdle();
  // The fixture itself is large; drop it so the memory numbers describe the
  // index, not the generator.
  data.length = 0;

  const queries = ["gateway", "token rotation", "velvet quarantine ledger", "migration session", "release review container"];
  const samples: number[] = [];
  let found = 0;
  for (let round = 0; round < 40; round += 1) {
    for (const query of queries) {
      const started = performance.now();
      const hits = index.search(query, { limit: 20 });
      samples.push(performance.now() - started);
      if (round === 0 && query === "velvet quarantine ledger" && hits.length > 0) {
        found = hits.length;
      }
    }
  }
  samples.sort((left, right) => left - right);
  const at = (percentile: number) =>
    samples[Math.min(samples.length - 1, Math.floor(samples.length * percentile))]!;

  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();
  const files = await readdir(root);
  let diskBytes = 0;
  for (const file of files) diskBytes += (await stat(join(root, file))).size;

  const cold = new SearchIndexService({ root, logger });
  const loadStarted = performance.now();
  await cold.init([]);
  const loadMs = performance.now() - loadStarted;

  console.log(
    JSON.stringify(
      {
        sessions: SESSIONS,
        messages: SESSIONS * MESSAGES_PER_SESSION,
        corpusMB: +(bytes / 1_000_000).toFixed(1),
        buildMs: +buildMs.toFixed(0),
        reloadMs: +loadMs.toFixed(1),
        queryP50ms: +at(0.5).toFixed(2),
        queryP95ms: +at(0.95).toFixed(2),
        queryMaxMs: +at(1).toFixed(2),
        rarePhraseHits: found,
        documents: index.stats().documents,
        terms: index.stats().terms,
        heapMB: +(process.memoryUsage().heapUsed / 1_000_000).toFixed(1),
        rssMB: +(process.memoryUsage().rss / 1_000_000).toFixed(1),
        indexMB: +(diskBytes / 1_000_000).toFixed(1),
        gcRan: Boolean(gc),
      },
      null,
      2,
    ),
  );
} finally {
  if (!process.env.KEEP_INDEX) {
    await rm(root, { recursive: true, force: true });
  } else {
    console.log(`kept ${root}`);
  }
}
