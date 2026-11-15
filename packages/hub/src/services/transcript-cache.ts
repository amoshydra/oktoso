import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  zMessage,
  zTranscriptCacheView,
  type Message,
  type MessagePage,
  type MessagesQuery,
  type Session,
  type TranscriptCacheInput,
  type TranscriptCacheSettings,
  type TranscriptCacheStats,
  type TranscriptCacheView,
} from "@amoshydra/oktoso-contracts";
import { writeJsonAtomic, type StateStore } from "@amoshydra/oktoso-storage";
import type { SearchIndexService } from "./search-index";
import { z } from "zod";
import type { Logger } from "../lib/logger";

const DAY_MS = 24 * 60 * 60 * 1_000;
/** One transcript is capped so a single huge session cannot fill the disk. */
const MAX_TRANSCRIPT_BYTES = 1_000_000;
/** Total budget across every cached transcript. */
const MAX_TOTAL_BYTES = 200_000_000;
const PERSIST_DEBOUNCE_MS = 1_000;

export const zCachedMessage = z.object({
  id: z.string(),
  role: zMessage.shape.role,
  createdAt: z.number().int(),
  /** Text parts only. Tool output and reasoning are never stored. */
  text: z.string(),
});

export type CachedMessage = z.infer<typeof zCachedMessage>;

export const zCachedTranscript = z.object({
  ref: z.string(),
  updatedAt: z.number().int(),
  providerID: z.string(),
  title: z.string().optional(),
  project: z.string().optional(),
  /** True once a read reached the oldest message of this revision. */
  complete: z.boolean(),
  /** True when the transcript was cut to stay inside the per-file cap. */
  truncated: z.boolean().default(false),
  messages: z.array(zCachedMessage),
  storedAt: z.number().int(),
});

export type CachedTranscript = z.infer<typeof zCachedTranscript>;

const zIndexEntry = z.object({
  updatedAt: z.number().int(),
  storedAt: z.number().int(),
  lastUsedAt: z.number().int(),
  bytes: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
  complete: z.boolean(),
});

const zIndex = z.object({
  version: z.literal(1),
  entries: z.record(z.string(), zIndexEntry),
});

type Index = z.infer<typeof zIndex>;
type IndexEntry = z.infer<typeof zIndexEntry>;

export interface TranscriptCacheOptions {
  root: string;
  store: StateStore;
  logger: Logger;
  now?: () => number;
}

/**
 * Local transcript cache.
 *
 * The provider stays authoritative: reads always go to the provider, and this
 * cache exists so search and export do not need another round trip. It is
 * opt-in, bounded by a TTL, a session count, and a byte budget, and it stores
 * message text only — never tool output or reasoning.
 *
 * Writes are serialized per session, so two concurrent reads cannot lose a
 * page or trip over each other's temporary file.
 */
export class TranscriptCacheService {
  private readonly root: string;
  private readonly store: StateStore;
  private readonly logger: Logger;
  private readonly now: () => number;
  private index: Index = { version: 1, entries: {} };
  private ready = false;
  private epoch = 0;
  private readonly chains = new Map<string, Promise<void>>();
  private persistTimer?: NodeJS.Timeout;
  private search?: SearchIndexService;

  constructor(options: TranscriptCacheOptions) {
    this.root = options.root;
    this.store = options.store;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
  }

  /** Wired by the hub so the index follows the cache. */
  attachSearch(search: SearchIndexService): void {
    this.search = search;
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.load();
    await this.sweepExpired();
    await this.sweepOrphans();
    await this.persist();
    this.ready = true;
  }

  settings(): TranscriptCacheSettings {
    return this.store.getState().transcriptCache;
  }

  get enabled(): boolean {
    return this.settings().enabled;
  }

  view(): TranscriptCacheView {
    return zTranscriptCacheView.parse({
      settings: this.settings(),
      stats: this.stats(),
    });
  }

  stats(): TranscriptCacheStats {
    const entries = Object.values(this.index.entries);
    const storedAt = entries.map((entry) => entry.storedAt);
    return {
      sessions: entries.length,
      bytes: entries.reduce((total, entry) => total + entry.bytes, 0),
      completeSessions: entries.filter((entry) => entry.complete).length,
      oldestStoredAt: storedAt.length > 0 ? Math.min(...storedAt) : null,
      newestStoredAt: storedAt.length > 0 ? Math.max(...storedAt) : null,
    };
  }

  /**
   * Update the opt-in. Turning the cache off waits for in-flight writes, then
   * deletes everything, so a disabled cache never keeps message text on disk.
   */
  async update(input: TranscriptCacheInput): Promise<TranscriptCacheView> {
    const next: TranscriptCacheSettings = {
      ...this.settings(),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.ttlDays !== undefined ? { ttlDays: input.ttlDays } : {}),
      ...(input.maxSessions !== undefined
        ? { maxSessions: input.maxSessions }
        : {}),
    };
    await this.store.update((state) => {
      state.transcriptCache = next;
    });
    if (!next.enabled) {
      await this.clear();
    } else {
      this.epoch += 1;
      await this.enforceLimits();
      await this.persist();
    }
    return this.view();
  }

  /** Write-through hook: called after a provider read. Never throws. */
  async record(
    session: Session,
    page: MessagePage,
    query: MessagesQuery = {},
  ): Promise<void> {
    if (!this.enabled || page.data.length === 0) return;
    await this.ensureReady();
    const ref = session.ref;
    const epoch = this.epoch;
    const previous = this.chains.get(ref) ?? Promise.resolve();
    const run = previous
      .catch(() => undefined)
      .then(() => this.writeEntry(session, page, query, epoch));
    this.chains.set(ref, run);
    try {
      await run;
    } finally {
      if (this.chains.get(ref) === run) this.chains.delete(ref);
    }
  }

  /** Read a cached transcript and mark it recently used. */
  async read(ref: string): Promise<CachedTranscript | undefined> {
    if (!this.enabled) return undefined;
    await this.ensureReady();
    const entry = this.index.entries[ref];
    if (!entry) return undefined;
    if (this.expired(entry)) {
      await this.remove(ref);
      return undefined;
    }
    const transcript = await this.readEntry(ref);
    if (!transcript) {
      await this.remove(ref);
      return undefined;
    }
    entry.lastUsedAt = this.now();
    this.schedulePersist();
    return transcript;
  }

  /** Every cached transcript, newest first. Search builds on this. */
  async all(): Promise<CachedTranscript[]> {
    if (!this.enabled) return [];
    await this.ensureReady();
    const transcripts: CachedTranscript[] = [];
    for (const ref of Object.keys(this.index.entries)) {
      const transcript = await this.read(ref);
      if (transcript) transcripts.push(transcript);
    }
    return transcripts.sort((left, right) => right.storedAt - left.storedAt);
  }

  /** Resolves when every queued write has settled. Tests and shutdown use it. */
  async whenIdle(): Promise<void> {
    await Promise.allSettled([...this.chains.values()]);
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      await this.persist();
    }
  }

  async clear(): Promise<void> {
    this.epoch += 1;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    await Promise.allSettled([...this.chains.values()]);
    this.index = { version: 1, entries: {} };
    const names = await readdir(this.root).catch(() => [] as string[]);
    await Promise.all(
      names
        .filter((name) => name !== "index.json")
        .map((name) => unlink(join(this.root, name)).catch(() => undefined)),
    );
    await this.persist();
    await this.search?.clear();
  }

  private async writeEntry(
    session: Session,
    page: MessagePage,
    query: MessagesQuery,
    epoch: number,
  ): Promise<void> {
    // The opt-in can flip while this write is queued.
    if (!this.enabled || epoch !== this.epoch) return;
    const ref = session.ref;
    const entry = this.index.entries[ref];
    const sameRevision = entry?.updatedAt === session.updatedAt;
    const existing = sameRevision ? await this.readEntry(ref) : undefined;

    const projected = projectMessages(page.data);
    const messages = mergeMessages(existing?.messages ?? [], projected);
    const complete = isComplete(query, page, sameRevision && entry.complete);
    if (
      existing &&
      sameRevision &&
      messages.length === existing.messages.length &&
      complete === existing.complete
    ) {
      // Nothing new: keep the stored copy and refresh its use time.
      if (entry) entry.lastUsedAt = this.now();
      return;
    }

    const { messages: bounded, truncated } = truncate(messages);
    const stored: CachedTranscript = {
      ref,
      updatedAt: session.updatedAt,
      providerID: session.providerID,
      ...(session.title ? { title: session.title } : {}),
      ...(session.project ? { project: session.project } : {}),
      complete,
      truncated,
      messages: bounded,
      storedAt: this.now(),
    };
    const payload = JSON.stringify(stored);
    await writeJsonAtomic(this.pathFor(ref), stored);

    this.index.entries[ref] = {
      updatedAt: stored.updatedAt,
      storedAt: stored.storedAt,
      lastUsedAt: this.now(),
      bytes: Buffer.byteLength(payload),
      messageCount: bounded.length,
      complete,
    };
    await this.enforceLimits();
    await this.persist();
    await this.search?.update(stored);
  }

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    await this.init();
  }

  private async load(): Promise<void> {
    const raw = await readFile(this.indexPath, "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );
    if (!raw) return;
    try {
      this.index = zIndex.parse(JSON.parse(raw));
    } catch {
      this.logger.warn("Ignoring a corrupt transcript cache index");
      this.index = { version: 1, entries: {} };
    }
  }

  private async readEntry(ref: string): Promise<CachedTranscript | undefined> {
    const raw = await readFile(this.pathFor(ref), "utf8").catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return "";
        throw error;
      },
    );
    if (!raw) return undefined;
    try {
      return zCachedTranscript.parse(JSON.parse(raw));
    } catch {
      this.logger.warn("Dropping an unreadable cached transcript", { ref });
      return undefined;
    }
  }

  private async remove(ref: string): Promise<void> {
    delete this.index.entries[ref];
    await unlink(this.pathFor(ref)).catch(() => undefined);
    await this.persist();
    await this.search?.remove(ref);
  }

  private expired(entry: IndexEntry): boolean {
    return this.now() - entry.storedAt > this.settings().ttlDays * DAY_MS;
  }

  private async sweepExpired(): Promise<void> {
    for (const [ref, entry] of Object.entries(this.index.entries)) {
      if (!this.expired(entry)) continue;
      delete this.index.entries[ref];
      await unlink(this.pathFor(ref)).catch(() => undefined);
      await this.search?.remove(ref);
    }
  }

  /** Drops files the index does not know about, and abandoned temp files. */
  private async sweepOrphans(): Promise<void> {
    const names = await readdir(this.root).catch(() => [] as string[]);
    const known = new Set(
      Object.keys(this.index.entries).map((ref) => `${digest(ref)}.json`),
    );
    await Promise.all(
      names
        .filter((name) => name !== "index.json")
        .filter((name) => name.endsWith(".tmp") || !known.has(name))
        .map((name) => unlink(join(this.root, name)).catch(() => undefined)),
    );
  }

  private async enforceLimits(): Promise<void> {
    const { maxSessions, ttlDays } = this.settings();
    const entries = Object.entries(this.index.entries).sort(
      (left, right) => left[1].lastUsedAt - right[1].lastUsedAt,
    );
    let count = entries.length;
    let total = entries.reduce((sum, [, entry]) => sum + entry.bytes, 0);
    const ttl = ttlDays * DAY_MS;
    for (const [ref, entry] of entries) {
      const overCount = count > maxSessions;
      const overBudget = total > MAX_TOTAL_BYTES;
      const stale = this.now() - entry.storedAt > ttl;
      if (!overCount && !overBudget && !stale) break;
      delete this.index.entries[ref];
      count -= 1;
      total -= entry.bytes;
      await unlink(this.pathFor(ref)).catch(() => undefined);
      await this.search?.remove(ref);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist();
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }

  private async persist(): Promise<void> {
    try {
      await writeJsonAtomic(this.indexPath, this.index);
    } catch (error) {
      this.logger.error("Unable to persist the transcript cache index", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private get indexPath(): string {
    return join(this.root, "index.json");
  }

  private pathFor(ref: string): string {
    return join(this.root, `${digest(ref)}.json`);
  }
}

function digest(ref: string): string {
  return createHash("sha256").update(ref).digest("hex").slice(0, 32);
}

/** Text parts only: no reasoning, tool input, or tool output is persisted. */
function projectMessages(messages: Message[]): CachedMessage[] {
  const projected: CachedMessage[] = [];
  for (const message of messages) {
    const text = message.parts
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n")
      .trim();
    if (!text) continue;
    projected.push({
      id: message.id,
      role: message.role,
      createdAt: message.createdAt,
      text,
    });
  }
  return projected;
}

function mergeMessages(
  existing: CachedMessage[],
  incoming: CachedMessage[],
): CachedMessage[] {
  const byID = new Map<string, CachedMessage>();
  for (const message of existing) byID.set(message.id, message);
  for (const message of incoming) byID.set(message.id, message);
  return [...byID.values()].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.id.localeCompare(right.id);
  });
}

/** Keeps the newest messages that fit, and says so. */
function truncate(messages: CachedMessage[]): {
  messages: CachedMessage[];
  truncated: boolean;
} {
  let bytes = Buffer.byteLength(JSON.stringify(messages));
  if (bytes <= MAX_TRANSCRIPT_BYTES) return { messages, truncated: false };
  const kept = [...messages];
  while (kept.length > 1 && bytes > MAX_TRANSCRIPT_BYTES) {
    kept.shift();
    bytes = Buffer.byteLength(JSON.stringify(kept));
  }
  return { messages: kept, truncated: true };
}

/**
 * Only a read that reaches the oldest message completes a transcript. With the
 * default descending order that is a page with no older cursor; an ascending
 * page after a cursor says nothing about the oldest end.
 */
function isComplete(
  query: MessagesQuery,
  page: MessagePage,
  previousComplete: boolean | undefined,
): boolean {
  if (previousComplete) return true;
  if (page.data.length === 0) return false;
  if (query.order !== "asc") return page.cursor.next === null;
  return !query.cursor && page.cursor.next === null;
}
