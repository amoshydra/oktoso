import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { CachedTranscript } from "./transcript-cache";
import type { Logger } from "../lib/logger";

const INDEX_VERSION = 1;
const K1 = 1.2;
const B = 0.75;
const MAX_SNIPPET_CHARS = 200;
const SNIPPET_WINDOW = 160;
/** Compact once the delta layer outgrows this share of the sealed index. */
const DELTA_COMPACT_RATIO = 0.2;
const DELTA_COMPACT_FLOOR = 64;

const FIELD_BODY = 1;
const FIELD_TITLE = 2;
const FIELD_PROJECT = 4;

const FIELD_WEIGHT: Record<number, number> = {
  [FIELD_BODY]: 1,
  [FIELD_TITLE]: 3,
  [FIELD_PROJECT]: 2,
};

const KIND_MESSAGE = 0;
const KIND_TITLE = 1;

const ROLE_CODES: Record<string, number> = {
  user: 1,
  assistant: 2,
  system: 3,
  tool: 4,
};

export interface SearchHit {
  ref: string;
  kind: "message" | "title";
  messageID?: string;
  role?: string;
  createdAt: number;
  score: number;
  snippet: string;
  title: string;
  providerID: string;
  project?: string;
  updatedAt: number;
}

export interface SearchOptions {
  limit?: number;
  providerID?: string;
  project?: string;
  sessionRef?: string;
  kind?: "message" | "title";
  /** One candidate per session; the caller wants sessions, not messages. */
  scope?: "session";
}

export interface SearchIndexStats {
  sessions: number;
  documents: number;
  terms: number;
  bytes: number;
  deltaDocuments: number;
  ready: boolean;
}

export interface SearchIndexOptions {
  root: string;
  logger: Logger;
  /** Re-checked before a reconcile; the cache opt-out can land mid-flight. */
  enabled?: () => boolean;
}

interface SessionRecord {
  /** Stable index into the sessions table; docSession stores this. */
  slot: number;
  ref: string;
  providerID: string;
  title: string;
  project: string;
  updatedAt: number;
  docs: number[];
}

interface PostingList {
  docs: number[];
  tf: number[];
  fields: number[];
}

/**
 * In-memory inverted index over cached transcripts.
 *
 * Written for the hub's shape: one process, a few hundred sessions, and a
 * search that must answer in single-digit milliseconds without a database. The
 * sealed part lives in typed arrays; new and updated sessions land in a delta
 * layer that compacts into a fresh seal once it grows.
 *
 * Snippets are stored per document, so a hit stays readable after its
 * transcript is evicted from the cache.
 */
export class SearchIndexService {
  private readonly root: string;
  private readonly logger: Logger;
  private readonly enabled?: () => boolean;

  // Sealed postings.
  private terms: string[] = [];
  private termToID = new Map<string, number>();
  private postOffsets = new Int32Array(1);
  private postDocs = new Int32Array(0);
  private postTf = new Float32Array(0);
  private postFields = new Uint8Array(0);

  // Documents (sealed and delta share this table).
  private docSession = new Int32Array(0);
  private docKind = new Uint8Array(0);
  private docOrdinal = new Int32Array(0);
  private docRole = new Uint8Array(0);
  private docAt = new Float64Array(0);
  private docLen = new Float32Array(0);
  private docMessageID: string[] = [];
  private snippets: string[] = [];
  private docCount = 0;
  private tombstones = 0;
  private totalLen = 0;

  private sessions: Array<SessionRecord | undefined> = [];
  private readonly sessionByRef = new Map<string, SessionRecord>();

  private readonly delta = new Map<string, PostingList>();
  private deltaDocs = 0;
  private sealed = true;
  private ready = false;
  private persistTimer?: NodeJS.Timeout;
  /** Bumped by clear(); an in-flight write from an older epoch must not land. */
  private epoch = 0;
  /** Snapshot counter, written into every file so a torn set is rejected. */
  private generation = 0;
  private writing: Promise<void> = Promise.resolve();

  constructor(options: SearchIndexOptions) {
    this.root = options.root;
    this.logger = options.logger;
    this.enabled = options.enabled;
  }

  async init(cached: CachedTranscript[] = []): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const loaded = await this.load();
    if (loaded) {
      // The snapshot may lag the cache; stay unready until reconcile runs.
      this.ready = false;
    } else {
      await this.rebuild(cached);
    }
  }

  stats(): SearchIndexStats {
    return {
      sessions: this.sessions.filter((session) => session && session.docs.length > 0)
        .length,
      documents: this.docCount - this.tombstones,
      terms: this.terms.length + this.delta.size,
      bytes: this.approximateBytes(),
      deltaDocuments: this.deltaDocs,
      ready: this.ready,
    };
  }

  /** Index one session revision, replacing any previous revision. */
  async update(transcript: CachedTranscript): Promise<void> {
    this.removeFromMemory(transcript.ref);
    this.addSession(transcript);
    if (
      this.deltaDocs >
      Math.max(DELTA_COMPACT_FLOOR, this.docCount * DELTA_COMPACT_RATIO)
    ) {
      this.compact();
    }
    this.schedulePersist();
  }

  async remove(ref: string): Promise<void> {
    this.removeFromMemory(ref);
    this.schedulePersist();
  }

  async clear(): Promise<void> {
    this.epoch += 1;
    this.ready = false;
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    await this.writing.catch(() => undefined);
    this.terms = [];
    this.termToID.clear();
    this.postOffsets = new Int32Array(1);
    this.postDocs = new Int32Array(0);
    this.postTf = new Float32Array(0);
    this.postFields = new Uint8Array(0);
    this.docSession = new Int32Array(0);
    this.docKind = new Uint8Array(0);
    this.docOrdinal = new Int32Array(0);
    this.docRole = new Uint8Array(0);
    this.docAt = new Float64Array(0);
    this.docLen = new Float32Array(0);
    this.docMessageID = [];
    this.snippets = [];
    this.docCount = 0;
    this.tombstones = 0;
    this.totalLen = 0;
    this.sessions = [];
    this.sessionByRef.clear();
    this.delta.clear();
    this.deltaDocs = 0;
    // Leave nothing behind: a cleared cache must not keep a readable index.
    const names = await readdir(this.root).catch(() => [] as string[]);
    await Promise.all(
      names.map((name) => unlink(join(this.root, name)).catch(() => undefined)),
    );
  }

  /** Rebuild every sealed structure from a set of transcripts. */
  async rebuild(transcripts: CachedTranscript[]): Promise<void> {
    this.terms = [];
    this.termToID.clear();
    this.postDocs = new Int32Array(0);
    this.postTf = new Float32Array(0);
    this.postFields = new Uint8Array(0);
    this.docCount = 0;
    this.tombstones = 0;
    this.totalLen = 0;
    this.sessions = [];
    this.sessionByRef.clear();
    this.delta.clear();
    this.deltaDocs = 0;
    this.docSession = new Int32Array(1024);
    this.docKind = new Uint8Array(1024);
    this.docOrdinal = new Int32Array(1024);
    this.docRole = new Uint8Array(1024);
    this.docAt = new Float64Array(1024);
    this.docLen = new Float32Array(1024);
    this.docMessageID = [];
    this.snippets = [];
    this.sealed = false;
    for (const transcript of transcripts) this.addSession(transcript);
    this.seal();
    this.deltaDocs = 0;
    await this.persist();
    this.ready = true;
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0) return [];
    const limit = Math.max(1, Math.min(options.limit ?? 20, 500));

    const lists = terms
      .map((term) => ({ term, idf: 0, postings: this.postingsFor(term) }))
      .filter((entry) => entry.postings.df > 0);
    if (lists.length === 0) return [];
    const live = Math.max(1, this.docCount - this.tombstones);
    for (const entry of lists) {
      // df must count live postings, or a term that churned scores as common
      // until the next compaction.
      let df = entry.postings.df;
      if (this.tombstones > 0) {
        df = 0;
        for (let position = 0; position < entry.postings.df; position += 1) {
          if (this.docSession[entry.postings.docAt(position)] !== -1) df += 1;
        }
      }
      entry.idf = Math.log(1 + (live - df + 0.5) / (df + 0.5));
    }

    let candidates = this.intersect(lists, options);
    if (candidates.docs.length === 0 && lists.length > 1) {
      // Near-miss: fall back to any-term scoring so the session is findable.
      candidates = this.union(lists, options);
    }
    if (options.scope === "session") {
      candidates = this.bestPerSession(candidates);
    }

    const best = topK(candidates.docs, candidates.scores, limit);
    return best.map(({ doc, score }) => {
      const hit = this.toHit(doc, score);
      return {
        ref: hit.ref,
        kind: hit.kind,
        ...(hit.messageID ? { messageID: hit.messageID } : {}),
        ...(hit.role ? { role: hit.role } : {}),
        createdAt: hit.at,
        score,
        snippet: snippetAround(hit.snippet, query),
        title: hit.title,
        providerID: hit.providerID,
        ...(hit.project ? { project: hit.project } : {}),
        updatedAt: hit.updatedAt,
      };
    });
  }

  /**
   * Bring the index in line with the transcripts the cache holds. Called once
   * at start-up: the cache is the source of truth for what may be indexed.
   */
  async reconcile(cached: CachedTranscript[]): Promise<void> {
    if (this.enabled && !this.enabled()) {
      await this.clear();
      return;
    }
    const epoch = this.epoch;
    const live = new Map(cached.map((transcript) => [transcript.ref, transcript]));
    for (const session of [...this.sessions]) {
      if (this.epoch !== epoch) return;
      if (!session || session.docs.length === 0) continue;
      if (!live.has(session.ref)) await this.remove(session.ref);
    }
    for (const transcript of cached) {
      if (this.epoch !== epoch) return;
      const existing = this.sessionByRef.get(transcript.ref);
      if (
        existing &&
        existing.docs.length > 0 &&
        existing.updatedAt === transcript.updatedAt
      ) {
        continue;
      }
      await this.update(transcript);
    }
    if (this.epoch !== epoch) return;
    this.ready = true;
  }

  async whenIdle(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      await this.persist();
    }
  }

  // --- indexing ---

  private addSession(transcript: CachedTranscript): void {
    const session: SessionRecord = {
      slot: this.sessions.length,
      ref: transcript.ref,
      providerID: transcript.providerID,
      title: transcript.title ?? "",
      project: transcript.project ?? "",
      updatedAt: transcript.updatedAt,
      docs: [],
    };
    this.sessions.push(session);
    this.sessionByRef.set(session.ref, session);

    const titleTokens = tokenize(session.title);
    const projectTokens = tokenize(session.project);
    if (titleTokens.length + projectTokens.length > 0) {
      const id = this.pushDoc(
        session,
        KIND_TITLE,
        -1,
        0,
        transcript.storedAt,
        titleTokens.length + projectTokens.length,
      );
      const counts = countTokens(titleTokens, FIELD_TITLE);
      mergeCounts(counts, countTokens(projectTokens, FIELD_PROJECT));
      this.pushPostings(counts, id);
      this.snippets[id] = clip(session.title || session.project);
      session.docs.push(id);
    }

    for (let ordinal = 0; ordinal < transcript.messages.length; ordinal += 1) {
      const message = transcript.messages[ordinal]!;
      const tokens = tokenize(message.text);
      if (tokens.length === 0) continue;
      const id = this.pushDoc(
        session,
        KIND_MESSAGE,
        ordinal,
        ROLE_CODES[message.role] ?? 0,
        message.createdAt,
        tokens.length,
        message.id,
      );
      this.pushPostings(countTokens(tokens, FIELD_BODY), id);
      this.snippets[id] = clip(message.text);
      session.docs.push(id);
    }
  }

  private pushDoc(
    session: SessionRecord,
    kind: number,
    ordinal: number,
    role: number,
    at: number,
    length: number,
    messageID = "",
  ): number {
    const id = this.docCount;
    if (id >= this.docSession.length) this.growDocs(Math.max(1024, id * 2));
    this.docSession[id] = this.sessions.length - 1;
    this.docKind[id] = kind;
    this.docOrdinal[id] = ordinal;
    this.docRole[id] = role;
    this.docAt[id] = at;
    this.docLen[id] = length;
    this.docMessageID[id] = messageID;
    this.docCount += 1;
    this.deltaDocs += 1;
    this.totalLen += length;
    return id;
  }

  private pushPostings(counts: Map<string, { tf: number; fields: number }>, doc: number): void {
    for (const [term, entry] of counts) {
      if (!this.sealed) {
        let tid = this.termToID.get(term);
        if (tid === undefined) {
          tid = this.terms.length;
          this.termToID.set(term, tid);
          this.terms.push(term);
          this.buildSlice(term).docs.push(doc);
          this.buildSlice(term).tf.push(entry.tf);
          this.buildSlice(term).fields.push(entry.fields);
          continue;
        }
        const slice = this.buildSlice(term);
        slice.docs.push(doc);
        slice.tf.push(entry.tf);
        slice.fields.push(entry.fields);
        continue;
      }
      let list = this.delta.get(term);
      if (!list) {
        list = { docs: [], tf: [], fields: [] };
        this.delta.set(term, list);
      }
      list.docs.push(doc);
      list.tf.push(entry.tf);
      list.fields.push(entry.fields);
    }
  }

  private buildSlices = new Map<string, PostingList>();

  private buildSlice(term: string): PostingList {
    let slice = this.buildSlices.get(term);
    if (!slice) {
      slice = { docs: [], tf: [], fields: [] };
      this.buildSlices.set(term, slice);
    }
    return slice;
  }

  private removeFromMemory(ref: string): void {
    const session = this.sessionByRef.get(ref);
    if (!session) return;
    for (const doc of session.docs) {
      if (this.docSession[doc] === -1) continue;
      this.docSession[doc] = -1;
      this.tombstones += 1;
      this.totalLen -= this.docLen[doc]!;
    }
    session.docs = [];
    this.sessionByRef.delete(ref);
    // Session slots stay put: docSession holds an index into a stable array,
    // so removing one session must not renumber the others. The hole is
    // skipped on persist, which keeps meta.json from growing per update.
    this.sessions[session.slot] = undefined;
  }

  private sessionAtDoc(doc: number): SessionRecord | undefined {
    const index = this.docSession[doc]!;
    if (index < 0) return undefined;
    return this.sessions[index];
  }

  /** Merge the delta layer and the sealed arrays into a fresh seal. */
  private compact(): void {
    const merged = new Map<string, PostingList>();
    for (const [term, list] of this.delta) {
      merged.set(term, { docs: [...list.docs], tf: [...list.tf], fields: [...list.fields] });
    }
    // Re-seal from the sealed snapshot plus the delta: walk every doc and its
    // postings instead would need the original term map per doc, so merge both
    // posting sources and drop tombstoned documents.
    const sealedPostings = new Map<string, PostingList>();
    for (let index = 0; index < this.terms.length; index += 1) {
      const term = this.terms[index]!;
      const start = this.postOffsets[index]!;
      const end = this.postOffsets[index + 1]!;
      const docs: number[] = [];
      const tf: number[] = [];
      const fields: number[] = [];
      for (let position = start; position < end; position += 1) {
        const doc = this.postDocs[position]!;
        if (this.docSession[doc] === -1) continue;
        docs.push(doc);
        tf.push(this.postTf[position]!);
        fields.push(this.postFields[position]!);
      }
      if (docs.length > 0) sealedPostings.set(term, { docs, tf, fields });
    }
    for (const [term, list] of merged) {
      const existing = sealedPostings.get(term);
      if (!existing) {
        sealedPostings.set(term, list);
        continue;
      }
      existing.docs.push(...list.docs);
      existing.tf.push(...list.tf);
      existing.fields.push(...list.fields);
    }

    // Drop docs that no session owns, and renumber the table.
    const remap = new Int32Array(this.docCount).fill(-1);
    let next = 0;
    for (let doc = 0; doc < this.docCount; doc += 1) {
      if (this.docSession[doc] === -1) continue;
      remap[doc] = next;
      if (next !== doc) {
        this.docSession[next] = this.docSession[doc]!;
        this.docKind[next] = this.docKind[doc]!;
        this.docOrdinal[next] = this.docOrdinal[doc]!;
        this.docRole[next] = this.docRole[doc]!;
        this.docAt[next] = this.docAt[doc]!;
        this.docLen[next] = this.docLen[doc]!;
        this.docMessageID[next] = this.docMessageID[doc]!;
        this.snippets[next] = this.snippets[doc]!;
      }
      next += 1;
    }
    this.docCount = next;
    this.snippets.length = next;
    this.docMessageID.length = next;
    for (const session of this.sessions) {
      if (!session) continue;
      session.docs = session.docs
        .map((doc) => remap[doc]!)
        .filter((doc) => doc >= 0);
    }
    this.tombstones = 0;
    this.deltaDocs = 0;

    for (const list of sealedPostings.values()) {
      const docs: number[] = [];
      const tf: number[] = [];
      const fields: number[] = [];
      for (let index = 0; index < list.docs.length; index += 1) {
        const doc = remap[list.docs[index]!]!;
        if (doc < 0) continue;
        docs.push(doc);
        tf.push(list.tf[index]!);
        fields.push(list.fields[index]!);
      }
      list.docs = docs;
      list.tf = tf;
      list.fields = fields;
    }
    for (const [term, list] of sealedPostings) {
      if (list.docs.length === 0) sealedPostings.delete(term);
    }

    this.terms = [...sealedPostings.keys()].sort();
    this.termToID.clear();
    this.postOffsets = new Int32Array(this.terms.length + 1);
    let total = 0;
    for (let index = 0; index < this.terms.length; index += 1) {
      this.postOffsets[index] = total;
      this.termToID.set(this.terms[index]!, index);
      total += sealedPostings.get(this.terms[index]!)!.docs.length;
    }
    this.postOffsets[this.terms.length] = total;
    this.postDocs = new Int32Array(total);
    this.postTf = new Float32Array(total);
    this.postFields = new Uint8Array(total);
    let position = 0;
    for (const term of this.terms) {
      const list = sealedPostings.get(term)!;
      for (let index = 0; index < list.docs.length; index += 1) {
        this.postDocs[position] = list.docs[index]!;
        this.postTf[position] = list.tf[index]!;
        this.postFields[position] = list.fields[index]!;
        position += 1;
      }
    }
    this.delta.clear();
    this.sealed = true;
  }

  private seal(): void {
    this.terms = [...this.buildSlices.keys()].sort();
    this.termToID.clear();
    this.postOffsets = new Int32Array(this.terms.length + 1);
    let total = 0;
    for (let index = 0; index < this.terms.length; index += 1) {
      this.postOffsets[index] = total;
      this.termToID.set(this.terms[index]!, index);
      total += this.buildSlices.get(this.terms[index]!)!.docs.length;
    }
    this.postOffsets[this.terms.length] = total;
    this.postDocs = new Int32Array(total);
    this.postTf = new Float32Array(total);
    this.postFields = new Uint8Array(total);
    let position = 0;
    for (const term of this.terms) {
      const slice = this.buildSlices.get(term)!;
      for (let index = 0; index < slice.docs.length; index += 1) {
        this.postDocs[position] = slice.docs[index]!;
        this.postTf[position] = slice.tf[index]!;
        this.postFields[position] = slice.fields[index]!;
        position += 1;
      }
    }
    this.buildSlices.clear();
    this.sealed = true;
  }

  private growDocs(capacity: number): void {
    const grow = <T extends Int32Array | Uint8Array | Float32Array | Float64Array>(
      source: T,
      length: number,
    ): T => {
      const next = new (source.constructor as new (size: number) => T)(length);
      next.set(source.subarray(0, Math.min(source.length, length)));
      return next;
    };
    const size = Math.max(capacity, this.docCount + 1);
    this.docSession = grow(this.docSession, size);
    this.docKind = grow(this.docKind, size);
    this.docOrdinal = grow(this.docOrdinal, size);
    this.docRole = grow(this.docRole, size);
    this.docAt = grow(this.docAt, size);
    this.docLen = grow(this.docLen, size);
  }

  // --- query ---

  private postingsFor(term: string): Postings {
    const sealedID = this.termToID.get(term);
    const deltaList = this.delta.get(term);
    if (sealedID === undefined) {
      const docs = deltaList?.docs ?? [];
      return {
        df: docs.length,
        docAt: (position) => docs[position]!,
        tfAt: (position) => deltaList!.tf[position]!,
        fieldsAt: (position) => deltaList!.fields[position]!,
      };
    }
    const start = this.postOffsets[sealedID]!;
    const sealedCount = this.postOffsets[sealedID + 1]! - start;
    const deltaCount = deltaList?.docs.length ?? 0;
    const docs = this.postDocs;
    const tf = this.postTf;
    const fields = this.postFields;
    return {
      df: sealedCount + deltaCount,
      docAt: (position) =>
        position < sealedCount ? docs[start + position]! : deltaList!.docs[position - sealedCount]!,
      tfAt: (position) =>
        position < sealedCount ? tf[start + position]! : deltaList!.tf[position - sealedCount]!,
      fieldsAt: (position) =>
        position < sealedCount
          ? fields[start + position]!
          : deltaList!.fields[position - sealedCount]!,
    };
  }

  private intersect(
    lists: Array<{ term: string; idf: number; postings: Postings }>,
    options: SearchOptions,
  ): Candidates {
    const count = lists.length;
    const positions = new Array<number>(count).fill(0);
    const docs: number[] = [];
    const scores: number[] = [];
    const avg =
      this.docCount === 0
        ? 1
        : this.totalLen / Math.max(1, this.docCount - this.tombstones);

    const advanceTo = (list: number, target: number): number => {
      const postings = lists[list]!.postings;
      let position = positions[list]!;
      while (position < postings.df) {
        const doc = postings.docAt(position);
        if (
          doc >= target &&
          this.docSession[doc] !== -1 &&
          this.accepts(doc, options)
        ) {
          break;
        }
        position += 1;
      }
      positions[list] = position;
      return position < postings.df ? postings.docAt(position) : -1;
    };

    let target = -1;
    for (;;) {
      let highest = -1;
      for (let list = 0; list < count; list += 1) {
        const doc = advanceTo(list, target);
        if (doc === -1) return { docs, scores };
        if (doc > highest) highest = doc;
      }
      if (highest !== target) {
        target = highest;
        continue;
      }
      let score = 0;
      for (let list = 0; list < count; list += 1) {
        const postings = lists[list]!.postings;
        const position = positions[list]!;
        const doc = postings.docAt(position);
        const tf = postings.tfAt(position) * fieldWeight(postings.fieldsAt(position));
        const length = this.docLen[doc]! || 1;
        const norm = K1 * (1 - B + (B * length) / (avg || 1));
        score += (lists[list]!.idf * (tf * (K1 + 1))) / (tf + norm);
      }
      docs.push(highest);
      scores.push(score);
      target = highest + 1;
    }
  }

  private union(
    lists: Array<{ term: string; idf: number; postings: Postings }>,
    options: SearchOptions,
  ): Candidates {
    const scores = new Map<number, number>();
    const avg = this.docCount === 0 ? 1 : this.totalLen / Math.max(1, this.docCount - this.tombstones);
    for (const entry of lists) {
      for (let position = 0; position < entry.postings.df; position += 1) {
        const doc = entry.postings.docAt(position);
        if (this.docSession[doc] === -1) continue;
        const fields = entry.postings.fieldsAt(position);
        if (!this.accepts(doc, options)) continue;
        const length = this.docLen[doc]! || 1;
        const norm = K1 * (1 - B + (B * length) / (avg || 1));
        const tf = entry.postings.tfAt(position) * fieldWeight(fields);
        const score = (entry.idf * (tf * (K1 + 1))) / (tf + norm);
        scores.set(doc, (scores.get(doc) ?? 0) + score);
      }
    }
    return {
      docs: [...scores.keys()],
      scores: [...scores.values()],
    };
  }

  /** Keeps one document per session so candidates are not spent on duplicates. */
  private bestPerSession(candidates: Candidates): Candidates {
    const best = new Map<string, { doc: number; score: number }>();
    for (let index = 0; index < candidates.docs.length; index += 1) {
      const doc = candidates.docs[index]!;
      const session = this.sessionAtDoc(doc);
      if (!session) continue;
      const score = candidates.scores[index]!;
      const current = best.get(session.ref);
      if (!current || score > current.score) best.set(session.ref, { doc, score });
    }
    return {
      docs: [...best.values()].map((entry) => entry.doc),
      scores: [...best.values()].map((entry) => entry.score),
    };
  }

  private accepts(doc: number, options: SearchOptions): boolean {
    const session = this.sessionAtDoc(doc);
    if (!session) return false;
    if (options.kind === "title" && this.docKind[doc] !== KIND_TITLE) return false;
    if (options.kind === "message" && this.docKind[doc] !== KIND_MESSAGE) return false;
    if (options.providerID && session.providerID !== options.providerID) return false;
    if (options.project !== undefined && session.project !== options.project) return false;
    if (options.sessionRef && session.ref !== options.sessionRef) return false;
    return true;
  }

  private toHit(doc: number, score: number): RawHit {
    const session = this.sessionAtDoc(doc)!;
    const kind = this.docKind[doc] === KIND_TITLE ? "title" : "message";
    return {
      ref: session.ref,
      kind,
      ...(kind === "message" && this.docMessageID[doc]
        ? { messageID: this.docMessageID[doc]! }
        : {}),
      ...(kind === "message" ? { ordinal: this.docOrdinal[doc]! } : {}),
      ...(this.docRole[doc] ? { role: roleName(this.docRole[doc]!) } : {}),
      at: this.docAt[doc]!,
      score,
      snippet: this.snippets[doc] ?? "",
      title: session.title,
      providerID: session.providerID,
      project: session.project,
      updatedAt: session.updatedAt,
    };
  }

  // --- persistence ---

  private schedulePersist(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.persist();
    }, 1_000);
    this.persistTimer.unref?.();
  }

  private async persist(): Promise<void> {
    const run = this.writing.then(() => this.writeSnapshot());
    this.writing = run.catch(() => undefined);
    await run;
  }

  /**
   * Writes one consistent snapshot.
   *
   * The three files are captured synchronously from the same in-memory state,
   * stamped with a generation, and committed meta-last. A reader rejects any
   * set whose generations disagree, so a compaction between two writes can
   * never mix a stale document table with fresh postings.
   */
  private async writeSnapshot(): Promise<void> {
    const epoch = this.epoch;
    const generation = this.generation + 1;
    const live = this.sessions.filter(
      (session): session is SessionRecord => Boolean(session && session.docs.length > 0),
    );
    const meta = {
      version: INDEX_VERSION,
      generation,
      sessions: live.map((session) => ({
        ref: session.ref,
        providerID: session.providerID,
        title: session.title,
        project: session.project,
        updatedAt: session.updatedAt,
        docs: session.docs,
      })),
      documents: {
        count: this.docCount,
        kind: Array.from(this.docKind.subarray(0, this.docCount)),
        ordinal: Array.from(this.docOrdinal.subarray(0, this.docCount)),
        role: Array.from(this.docRole.subarray(0, this.docCount)),
        at: Array.from(this.docAt.subarray(0, this.docCount)),
        len: Array.from(this.docLen.subarray(0, this.docCount)),
        messageIDs: this.docMessageID,
        snippets: this.snippets,
      },
      delta: [...this.delta].map(([term, list]) => [term, list]),
    };
    const metaText = JSON.stringify(meta);
    const termsText = `${termsHeader(generation, this.terms.length)}\n${this.terms.join("\n")}`;
    const postings = encodePostings(this, generation, this.docCount);

    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const temporary = {
        meta: await writeTemporary(join(this.root, "meta.json"), metaText),
        terms: await writeTemporary(join(this.root, "terms.txt"), termsText),
        postings: await writeTemporary(join(this.root, "postings.bin"), postings),
      };
      if (epoch !== this.epoch) {
        // Cleared while we were writing: do not resurrect anything.
        await Promise.all(
          Object.values(temporary).map((path) => unlink(path).catch(() => undefined)),
        );
        return;
      }
      await rename(temporary.postings, join(this.root, "postings.bin"));
      await rename(temporary.terms, join(this.root, "terms.txt"));
      await rename(temporary.meta, join(this.root, "meta.json"));
      this.generation = generation;
    } catch (error) {
      this.logger.error("Unable to persist the search index", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async load(): Promise<boolean> {
    const raw = await readFile(join(this.root, "meta.json"), "utf8").catch(() => "");
    if (!raw) return false;
    try {
      const meta = JSON.parse(raw) as {
        version: number;
        generation: number;
        sessions: Array<{
          ref: string;
          providerID: string;
          title: string;
          project: string;
          updatedAt: number;
          docs: number[];
        }>;
        documents: {
          count: number;
          kind: number[];
          ordinal: number[];
          role: number[];
          at: number[];
          len: number[];
          messageIDs: string[];
          snippets: string[];
        };
        delta: Array<[string, PostingList]>;
      };
      if (meta.version !== INDEX_VERSION) return false;
      if (typeof meta.generation !== "number") return false;
      const docCount = meta.documents.count;
      this.docCount = docCount;
      this.docKind = Uint8Array.from(meta.documents.kind);
      this.docOrdinal = Int32Array.from(meta.documents.ordinal);
      this.docRole = Uint8Array.from(meta.documents.role);
      this.docAt = Float64Array.from(meta.documents.at);
      this.docLen = Float32Array.from(meta.documents.len);
      this.docMessageID = meta.documents.messageIDs ?? [];
      this.snippets = meta.documents.snippets;
      this.sessions = [];
      this.sessionByRef.clear();
      for (const session of meta.sessions) {
        const record: SessionRecord = { slot: this.sessions.length, ...session };
        this.sessions.push(record);
        this.sessionByRef.set(record.ref, record);
      }
      this.docSession = new Int32Array(docCount).fill(-1);
      for (let index = 0; index < this.sessions.length; index += 1) {
        const session = this.sessions[index];
        if (!session) continue;
        for (const doc of session.docs) this.docSession[doc] = index;
      }
      this.delta.clear();
      this.deltaDocs = 0;
      for (const [term, list] of meta.delta) {
        this.delta.set(term, list);
        this.deltaDocs += list.docs.length;
      }
      this.totalLen = 0;
      let live = 0;
      for (let doc = 0; doc < docCount; doc += 1) {
        if (this.docSession[doc] === -1) continue;
        this.totalLen += this.docLen[doc]!;
        live += 1;
      }
      this.tombstones = docCount - live;
      const termsRaw = await readFile(join(this.root, "terms.txt"), "utf8");
      const [header, ...rest] = termsRaw.split("\n");
      const lines = rest.filter((term) => term.length > 0);
      const expected = termsHeader(meta.generation, lines.length);
      if (header !== expected) {
        throw new Error("term table generation mismatch");
      }
      this.terms = lines;
      this.termToID.clear();
      this.terms.forEach((term, index) => this.termToID.set(term, index));
      const postings = await readFile(join(this.root, "postings.bin"));
      decodePostings(this, postings, {
        generation: meta.generation,
        documents: meta.documents.count,
      });
      this.generation = meta.generation;
      this.sealed = true;
      return true;
    } catch (error) {
      this.logger.warn("Discarding an unreadable search index", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private approximateBytes(): number {
    return (
      this.postDocs.byteLength +
      this.postTf.byteLength +
      this.postFields.byteLength +
      this.docSession.byteLength +
      this.docKind.byteLength +
      this.docOrdinal.byteLength +
      this.docRole.byteLength +
      this.docAt.byteLength +
      this.docLen.byteLength +
      this.snippets.reduce((total, snippet) => total + snippet.length, 0)
    );
  }

  // Serialization hooks used by the codec below.
  /** @internal */
  sealedState(): {
    terms: string[];
    offsets: Int32Array<ArrayBuffer>;
    docs: Int32Array<ArrayBuffer>;
    tf: Float32Array<ArrayBuffer>;
    fields: Uint8Array<ArrayBuffer>;
  } {
    return {
      terms: this.terms,
      offsets: this.postOffsets,
      docs: this.postDocs,
      tf: this.postTf,
      fields: this.postFields,
    };
  }

  /** @internal */
  applySealed(state: {
    offsets: Int32Array;
    docs: Int32Array;
    tf: Float32Array;
    fields: Uint8Array;
  }): void {
    this.postOffsets = new Int32Array(state.offsets);
    this.postDocs = new Int32Array(state.docs);
    this.postTf = new Float32Array(state.tf);
    this.postFields = new Uint8Array(state.fields);
  }
}

interface Candidates {
  docs: number[];
  scores: number[];
}

interface Postings {
  df: number;
  docAt: (position: number) => number;
  tfAt: (position: number) => number;
  fieldsAt: (position: number) => number;
}

interface RawHit {
  ref: string;
  kind: "message" | "title";
  ordinal?: number;
  messageID?: string;
  role?: string;
  at: number;
  score: number;
  snippet: string;
  title: string;
  providerID: string;
  project: string;
  updatedAt: number;
}

/** Keeps the best `limit` documents without sorting every candidate. */
function topK(
  docs: number[],
  scores: number[],
  limit: number,
): Array<{ doc: number; score: number }> {
  const best: Array<{ doc: number; score: number }> = [];
  for (let index = 0; index < docs.length; index += 1) {
    const score = scores[index]!;
    const doc = docs[index]!;
    const last = best[best.length - 1];
    if (best.length === limit && last && (score < last.score || (score === last.score && doc >= last.doc))) {
      continue;
    }
    const entry = { doc, score };
    let position = best.length;
    while (position > 0) {
      const previous = best[position - 1]!;
      if (previous.score > score) break;
      if (previous.score === score && previous.doc < doc) break;
      position -= 1;
    }
    best.splice(position, 0, entry);
    if (best.length > limit) best.pop();
  }
  return best;
}

const ROLE_NAMES = new Map(
  Object.entries(ROLE_CODES).map(([name, code]) => [code, name]),
);

function roleName(code: number): string | undefined {
  return ROLE_NAMES.get(code);
}

function fieldWeight(fields: number): number {
  let weight = 0;
  if (fields & FIELD_BODY) weight = Math.max(weight, FIELD_WEIGHT[FIELD_BODY]!);
  if (fields & FIELD_TITLE) weight = Math.max(weight, FIELD_WEIGHT[FIELD_TITLE]!);
  if (fields & FIELD_PROJECT) weight = Math.max(weight, FIELD_WEIGHT[FIELD_PROJECT]!);
  return weight || 1;
}

function countTokens(tokens: string[], field: number): Map<string, { tf: number; fields: number }> {
  const counts = new Map<string, { tf: number; fields: number }>();
  for (const token of tokens) {
    const current = counts.get(token);
    if (current) {
      current.tf += 1;
      current.fields |= field;
    } else {
      counts.set(token, { tf: 1, fields: field });
    }
  }
  return counts;
}

function mergeCounts(
  target: Map<string, { tf: number; fields: number }>,
  source: Map<string, { tf: number; fields: number }>,
): void {
  for (const [term, entry] of source) {
    const current = target.get(term);
    if (current) {
      current.tf += entry.tf;
      current.fields |= entry.fields;
    } else {
      target.set(term, { ...entry });
    }
  }
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_SNIPPET_CHARS) return flat;
  return `${flat.slice(0, MAX_SNIPPET_CHARS - 1)}…`;
}

const TOKEN = /[\p{L}\p{N}]+/gu;

/**
 * Splits identifiers as well as prose: `sessionService` and `session_service`
 * both yield `session` and `service`, so a search for either word matches.
 */
export function tokenize(text: string): string[] {
  if (!text) return [];
  const split = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  let match;
  while ((match = TOKEN.exec(split)) !== null) {
    const term = match[0].toLowerCase();
    if (term.length < 2) continue;
    tokens.push(term);
  }
  return tokens;
}

/** Query-time snippet: a window around the first matched term. */
function indexOfWord(haystack: string, needle: string): number {
  let from = 0;
  for (;;) {
    const found = haystack.indexOf(needle, from);
    if (found === -1) return -1;
    const before = found === 0 ? "" : haystack[found - 1]!;
    const after = haystack[found + needle.length] ?? "";
    const boundary = (char: string) => char === "" || !/[\p{L}\p{N}]/u.test(char);
    if (boundary(before) && boundary(after)) return found;
    from = found + 1;
  }
}

export function snippetAround(snippet: string, query: string): string {
  const terms = tokenize(query);
  if (terms.length === 0) return snippet;
  const lower = snippet.toLowerCase();
  let index = -1;
  for (const term of terms) {
    const found = indexOfWord(lower, term);
    if (found === -1) continue;
    if (index === -1 || found < index) index = found;
  }
  if (index === -1) return snippet;
  const start = Math.max(0, index - Math.floor(SNIPPET_WINDOW / 3));
  const window = snippet.slice(start, start + SNIPPET_WINDOW).trim();
  return `${start > 0 ? "…" : ""}${window}${start + SNIPPET_WINDOW < snippet.length ? "…" : ""}`;
}

// --- postings codec ---

const POSTINGS_MAGIC = "OKSP";
const POSTINGS_VERSION = 1;

function termsHeader(generation: number, terms: number): string {
  return `#oktoso-search v1 gen=${generation} terms=${terms}`;
}

function encodePostings(
  index: SearchIndexService,
  generation: number,
  docCount: number,
): Buffer {
  const { docs, tf, fields, offsets, terms } = index.sealedState();
  const header = Buffer.alloc(16);
  header.write(POSTINGS_MAGIC, 0, "ascii");
  header.writeUInt32LE(POSTINGS_VERSION, 4);
  header.writeUInt32LE(generation, 8);
  header.writeUInt32LE(docCount, 12);
  const chunks: Buffer[] = [header];
  for (let term = 0; term < terms.length; term += 1) {
    const start = offsets[term]!;
    const end = offsets[term + 1]!;
    const count = end - start;
    const header = Buffer.alloc(4);
    header.writeUInt32LE(count);
    chunks.push(header);
    const body = Buffer.alloc(count * 9);
    let previous = 0;
    for (let entry = 0; entry < count; entry += 1) {
      const at = entry * 9;
      const doc = docs[start + entry]!;
      body.writeInt32LE(doc - previous, at);
      body.writeFloatLE(tf[start + entry]!, at + 4);
      body.writeUInt8(fields[start + entry]!, at + 8);
      previous = doc;
    }
    chunks.push(body);
  }
  return Buffer.concat(chunks);
}

function decodePostings(
  index: SearchIndexService,
  buffer: Buffer,
  expected: { generation: number; documents: number },
): void {
  const { terms } = index.sealedState();
  if (
    buffer.length < 16 ||
    buffer.toString("ascii", 0, 4) !== POSTINGS_MAGIC ||
    buffer.readUInt32LE(4) !== POSTINGS_VERSION
  ) {
    throw new Error("unknown postings format");
  }
  if (
    buffer.readUInt32LE(8) !== expected.generation ||
    buffer.readUInt32LE(12) !== expected.documents
  ) {
    throw new Error("postings generation mismatch");
  }
  const offsets = new Int32Array(terms.length + 1);
  const docs: number[] = [];
  const tf: number[] = [];
  const fields: number[] = [];
  let offset = 16;
  for (let term = 0; term < terms.length; term += 1) {
    if (offset + 4 > buffer.length) throw new Error("truncated postings");
    const count = buffer.readUInt32LE(offset);
    offset += 4;
    let previous = 0;
    offsets[term] = docs.length;
    for (let entry = 0; entry < count; entry += 1) {
      if (offset + 9 > buffer.length) throw new Error("truncated postings");
      previous += buffer.readInt32LE(offset);
      docs.push(previous);
      tf.push(buffer.readFloatLE(offset + 4));
      fields.push(buffer.readUInt8(offset + 8));
      offset += 9;
    }
  }
  offsets[terms.length] = docs.length;
  index.applySealed({
    offsets,
    docs: Int32Array.from(docs),
    tf: Float32Array.from(tf),
    fields: Uint8Array.from(fields),
  });
}

async function writeTemporary(
  path: string,
  contents: string | Buffer,
): Promise<string> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  return temporary;
}
