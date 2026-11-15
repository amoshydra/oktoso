import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  zMessage,
  zTranscriptCacheView,
  type Message,
  type MessagePage,
  type Session,
  type TranscriptCacheInput,
  type TranscriptCacheSettings,
  type TranscriptCacheStats,
  type TranscriptCacheView,
} from "@amoshydra/oktoso-contracts";
import type { StateStore } from "@amoshydra/oktoso-storage";
import { z } from "zod";
import type { Logger } from "../lib/logger";

const DAY_MS = 24 * 60 * 60 * 1_000;

export const zCachedTranscript = z.object({
  ref: z.string(),
  updatedAt: z.number().int(),
  providerID: z.string(),
  title: z.string().optional(),
  project: z.string().optional(),
  /** True once a read reached the oldest message of this revision. */
  complete: z.boolean(),
  messages: z.array(zMessage),
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
 * cache exists so search, export, and offline views do not need another round
 * trip. It is opt-in, bounded by a TTL and a session count, and evicts the
 * least recently used transcript first.
 */
export class TranscriptCacheService {
  private readonly root: string;
  private readonly store: StateStore;
  private readonly logger: Logger;
  private readonly now: () => number;
  private index: Index = { version: 1, entries: {} };
  private ready = false;
  private writing?: Promise<void>;

  constructor(options: TranscriptCacheOptions) {
    this.root = options.root;
    this.store = options.store;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await this.load();
    await this.sweep();
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
   * Update the opt-in. Turning the cache off deletes what is stored, because a
   * disabled cache must not keep message text on disk.
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
    if (!next.enabled) await this.clear();
    else await this.enforceLimits();
    return this.view();
  }

  /** Write-through hook: called after a provider read. */
  async record(session: Session, page: MessagePage): Promise<void> {
    if (!this.enabled || page.data.length === 0) return;
    await this.ensureReady();
    const ref = session.ref;
    const entry = this.index.entries[ref];
    const sameRevision = entry?.updatedAt === session.updatedAt;
    const existing = sameRevision ? await this.readEntry(ref) : undefined;

    const messages = mergeMessages(existing?.messages ?? [], page.data);
    const complete =
      page.cursor.next === null ||
      (sameRevision && (entry?.complete ?? false));

    const stored: CachedTranscript = {
      ref,
      updatedAt: session.updatedAt,
      providerID: session.providerID,
      ...(session.title ? { title: session.title } : {}),
      ...(session.project ? { project: session.project } : {}),
      complete,
      messages,
      storedAt: this.now(),
    };
    const payload = JSON.stringify(stored);
    await writeAtomic(this.pathFor(ref), payload);

    this.index.entries[ref] = {
      updatedAt: stored.updatedAt,
      storedAt: stored.storedAt,
      lastUsedAt: this.now(),
      bytes: Buffer.byteLength(payload),
      messageCount: messages.length,
      complete,
    };
    await this.enforceLimits();
    await this.persist();
  }

  /** Read a cached transcript and mark it recently used. */
  async read(ref: string): Promise<CachedTranscript | undefined> {
    await this.ensureReady();
    const entry = this.index.entries[ref];
    if (!entry) return undefined;
    if (this.expired(entry)) {
      await this.remove(ref);
      return undefined;
    }
    const transcript = await this.readEntry(ref);
    if (!transcript) {
      delete this.index.entries[ref];
      await this.persist();
      return undefined;
    }
    entry.lastUsedAt = this.now();
    return transcript;
  }

  /** Every cached transcript, newest first. Search builds on this. */
  async all(): Promise<CachedTranscript[]> {
    await this.ensureReady();
    const refs = Object.keys(this.index.entries);
    const transcripts: CachedTranscript[] = [];
    for (const ref of refs) {
      const transcript = await this.read(ref);
      if (transcript) transcripts.push(transcript);
    }
    return transcripts.sort((left, right) => right.storedAt - left.storedAt);
  }

  async clear(): Promise<void> {
    const refs = Object.keys(this.index.entries);
    this.index = { version: 1, entries: {} };
    for (const ref of refs) {
      await unlink(this.pathFor(ref)).catch(() => undefined);
    }
    await this.persist();
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
  }

  private expired(entry: IndexEntry): boolean {
    return this.now() - entry.storedAt > this.settings().ttlDays * DAY_MS;
  }

  private async sweep(): Promise<void> {
    let changed = false;
    for (const [ref, entry] of Object.entries(this.index.entries)) {
      if (!this.expired(entry)) continue;
      delete this.index.entries[ref];
      await unlink(this.pathFor(ref)).catch(() => undefined);
      changed = true;
    }
    if (changed) await this.persist();
  }

  private async enforceLimits(): Promise<void> {
    const { maxSessions } = this.settings();
    const entries = Object.entries(this.index.entries).sort(
      (left, right) => left[1].lastUsedAt - right[1].lastUsedAt,
    );
    let overflow = entries.length - maxSessions;
    for (const [ref] of entries) {
      if (overflow <= 0) break;
      delete this.index.entries[ref];
      await unlink(this.pathFor(ref)).catch(() => undefined);
      overflow -= 1;
    }
  }

  private async persist(): Promise<void> {
    const payload = JSON.stringify(this.index);
    const previous = this.writing ?? Promise.resolve();
    this.writing = previous
      .then(() => writeAtomic(this.indexPath, payload))
      .catch((error: unknown) => {
        this.logger.error("Unable to persist the transcript cache index", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    await this.writing;
  }

  private get indexPath(): string {
    return join(this.root, "index.json");
  }

  private pathFor(ref: string): string {
    const digest = createHash("sha256").update(ref).digest("hex").slice(0, 32);
    return join(this.root, `${digest}.json`);
  }
}

function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byID = new Map<string, Message>();
  for (const message of existing) byID.set(message.id, message);
  for (const message of incoming) byID.set(message.id, message);
  return [...byID.values()].sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return left.id.localeCompare(right.id);
  });
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

