import type {
  MessagePage,
  MessagesQuery,
  Session,
  SessionListQuery,
  SessionPage,
} from "@agent-hub/contracts";
import type { ProviderAdapter } from "@agent-hub/providers";
import { badRequest, notFound } from "../domain/errors";
import type { Logger } from "../lib/logger";
import type { ProviderRegistry } from "./provider-registry";

export interface SessionServiceOptions {
  ttlMs?: number;
  now?: () => number;
}

interface CursorValue {
  v: 1;
  offset: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export class SessionService {
  private readonly sessions = new Map<string, Session>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private lastSyncAt = 0;
  private refreshing?: Promise<void>;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly logger: Logger,
    options: SessionServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  get lastSync(): number {
    return this.lastSyncAt;
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;

    const run = (async () => {
      const adapters = this.registry.adapters();
      const results = await Promise.allSettled(
        adapters.map(async (adapter) => ({
          adapter,
          page: await adapter.listSessions(
            { limit: MAX_LIMIT },
            AbortSignal.timeout(15_000),
          ),
        })),
      );

      for (const result of results) {
        if (result.status === "fulfilled") {
          for (const session of result.value.page.data) {
            this.sessions.set(session.ref, session);
          }
        } else {
          this.logger.warn("Session sync failed", {
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      }

      this.lastSyncAt = this.now();
    })();

    this.refreshing = run;
    try {
      await run;
    } finally {
      this.refreshing = undefined;
    }
  }

  async list(query: SessionListQuery): Promise<SessionPage> {
    await this.ensureFresh();

    const offset = decodeCursor(query.cursor);
    const limit = clampLimit(query.limit);
    const search = query.q?.trim().toLowerCase();

    let data = [...this.sessions.values()];
    if (query.provider) data = data.filter((session) => session.providerID === query.provider);
    if (query.status) data = data.filter((session) => session.status === query.status);
    if (search) {
      data = data.filter((session) =>
        [session.title, session.project, session.directory, session.agent]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(search),
      );
    }

    data.sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.ref.localeCompare(right.ref),
    );

    const page = data.slice(offset, offset + limit);
    const next = offset + limit < data.length ? encodeCursor(offset + limit) : null;
    const previous = offset > 0 ? encodeCursor(Math.max(0, offset - limit)) : null;

    return {
      data: page,
      cursor: { next, previous },
    };
  }

  async get(ref: string): Promise<Session> {
    const adapter = this.adapterForRef(ref);
    if (adapter) {
      const session = await adapter.getSession(ref, AbortSignal.timeout(15_000));
      this.sessions.set(session.ref, session);
      return session;
    }

    const session = this.sessions.get(ref);
    if (!session) throw notFound("Session not found");
    return session;
  }

  async messages(ref: string, query: MessagesQuery): Promise<MessagePage> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) {
      const session = this.sessions.get(ref);
      if (!session) throw notFound("Session not found");
      return { data: [], cursor: { next: null, previous: null } };
    }
    return adapter.getMessages(ref, query, AbortSignal.timeout(15_000));
  }

  async markRead(ref: string): Promise<void> {
    const adapter = this.adapterForRef(ref);
    if (!adapter?.markRead) {
      const session = this.sessions.get(ref);
      if (!session) throw notFound("Session not found");
      this.sessions.set(ref, { ...session, unread: false });
      return;
    }

    await adapter.markRead(ref, AbortSignal.timeout(15_000));
    const session = this.sessions.get(ref);
    if (session) this.sessions.set(ref, { ...session, unread: false });
  }

  private async ensureFresh(): Promise<void> {
    if (this.now() - this.lastSyncAt >= this.ttlMs) {
      await this.refresh();
    }
  }

  private adapterForRef(ref: string): ProviderAdapter | undefined {
    const providerID = ref.slice(0, ref.indexOf(":"));
    if (!providerID) throw notFound("Session not found");
    return this.registry.adapter(providerID);
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw badRequest("limit must be between 1 and 200");
  }
  return limit;
}

function encodeCursor(offset: number): string {
  const cursor: CursorValue = { v: 1, offset };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Partial<CursorValue>;
    if (parsed.v !== 1 || !Number.isInteger(parsed.offset) || (parsed.offset ?? 0) < 0) {
      throw new Error("invalid");
    }
    return parsed.offset ?? 0;
  } catch {
    throw badRequest("Invalid session cursor");
  }
}
