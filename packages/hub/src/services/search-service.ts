import type {
  SearchPage,
  SearchQuery,
  SearchResult,
} from "@amoshydra/oktoso-contracts";
import { badRequest } from "../domain/errors";
import { snippetAround, type SearchHit, type SearchIndexService } from "./search-index";
import type { SessionService } from "./session-service";
import type { TranscriptCacheService } from "./transcript-cache";

/** Hard ceiling on the candidates one query may rank. */
const MAX_CANDIDATES = 500;

export interface SearchServiceOptions {
  index: SearchIndexService;
  sessions: SessionService;
  /** Optional: used to re-snippet a deep match whose stored excerpt misses it. */
  cache?: TranscriptCacheService;
  /** Whether the transcript cache is on; the UI uses it to explain empties. */
  enabled?: () => boolean;
}

/**
 * Turns index hits into API rows.
 *
 * Sessions dedupe by ref and keep their best-scoring message; the messages
 * scope returns one row per matching message. Ordering is total and stable so
 * an offset cursor cannot skip or repeat a row between pages.
 */
export class SearchService {
  constructor(private readonly options: SearchServiceOptions) {}

  async search(query: SearchQuery): Promise<SearchPage> {
    const limit = query.limit ?? 20;
    const offset = decodeCursor(query.cursor);
    const scope = query.scope ?? "all";
    const wanted = Math.min(MAX_CANDIDATES, offset + limit + 1);

    const hits = this.options.index.search(query.q, {
      limit: wanted,
      ...(query.provider ? { providerID: query.provider } : {}),
      ...(scope === "messages"
        ? { kind: "message" as const }
        : { scope: "session" as const }),
    });

    const best = new Map<string, SearchHit>();
    for (const hit of hits) {
      if (scope === "messages" && hit.kind === "title") continue;
      const key =
        scope === "messages" ? `${hit.ref}#${hit.messageID ?? hit.createdAt}` : hit.ref;
      const current = best.get(key);
      if (!current || hit.score > current.score) best.set(key, hit);
    }

    const rows: SearchResult[] = [];
    for (const hit of best.values()) {
      const session = this.options.sessions.peek(hit.ref);
      if (query.status && session?.status !== query.status) continue;
      const directory = session?.directory;
      rows.push({
        ref: hit.ref,
        title: hit.title,
        providerID: hit.providerID,
        ...(hit.project ? { project: hit.project } : {}),
        ...(directory ? { directory } : {}),
        updatedAt: hit.updatedAt,
        ...(hit.snippet ? { snippet: hit.snippet } : {}),
        match: hit.kind === "title" ? "session" : "message",
        ...(hit.messageID ? { messageID: hit.messageID } : {}),
        ...(hit.role ? { role: hit.role as SearchResult["role"] } : {}),
        ...(hit.createdAt ? { createdAt: hit.createdAt } : {}),
        score: hit.score,
      });
    }

    rows.sort(
      (left, right) =>
        (right.score ?? 0) - (left.score ?? 0) ||
        right.updatedAt - left.updatedAt ||
        left.ref.localeCompare(right.ref) ||
        (left.messageID ?? "").localeCompare(right.messageID ?? ""),
    );

    const page = rows.slice(offset, offset + limit);
    await this.refreshSnippets(page, query.q);
    return {
      data: page,
      cursor: {
        previous: offset > 0 ? encodeCursor(Math.max(0, offset - limit)) : null,
        next: offset + limit < rows.length ? encodeCursor(offset + limit) : null,
      },
      ready: this.options.index.stats().ready,
      enabled: this.options.enabled ? this.options.enabled() : true,
    };
  }

  /**
   * A document's stored excerpt is its first 200 characters, so a deep match
   * can land outside it. When the transcript is still cached, re-cut the
   * snippet from the message text; otherwise the stored excerpt stands.
   */
  private async refreshSnippets(page: SearchResult[], query: string): Promise<void> {
    const cache = this.options.cache;
    if (!cache || page.length === 0) return;
    const terms = query.toLowerCase();
    await Promise.all(
      page.map(async (row) => {
        if (!row.snippet || row.snippet.toLowerCase().includes(terms)) return;
        if (!row.messageID) return;
        const transcript = await cache.read(row.ref, { touch: false });
        const message = transcript?.messages.find(
          (entry) => entry.id === row.messageID,
        );
        if (message) row.snippet = snippetAround(message.text, query);
      }),
    );
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as { v?: number; offset?: number };
    if (parsed.v !== 1 || typeof parsed.offset !== "number") throw new Error("bad cursor");
    if (!Number.isInteger(parsed.offset) || parsed.offset < 0) throw new Error("bad cursor");
    return parsed.offset;
  } catch {
    throw badRequest("Invalid search cursor");
  }
}
