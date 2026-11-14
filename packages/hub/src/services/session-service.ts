import type {
  BranchPoint,
  CreateSessionInput,
  ForkInput,
  MessagePage,
  MessagesQuery,
  ProviderOptions,
  SendInput,
  SendResult,
  Session,
  SessionListQuery,
  SessionPage,
  SessionSelectionInput,
} from "@amoshydra/oktoso-contracts";
import {
  isAbsoluteSessionPath,
  relativeSessionPath,
  type ProviderAdapter,
  type ProviderResource,
} from "@amoshydra/oktoso-providers";
import { badRequest, notFound, notImplemented } from "../domain/errors";
import type { Logger } from "../lib/logger";
import type { StateStore } from "@amoshydra/oktoso-storage";
import type { AttachmentStore } from "./attachment-store";
import type { ProviderRegistry } from "./provider-registry";
import {
  DEFAULT_SESSION_COLD_START_MS,
  DEFAULT_SYNC_TIMEOUT_MS,
  operationSignal,
  providerOfflineError,
  providerUnavailableReason,
  syncSignal,
  waitAtMost,
} from "./provider-sync";

export interface SessionServiceOptions {
  ttlMs?: number;
  now?: () => number;
  store?: StateStore;
  attachments?: AttachmentStore;
  syncTimeoutMs?: number;
  coldStartWaitMs?: number;
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
  private readonly store?: StateStore;
  private readonly attachments?: AttachmentStore;
  private readonly syncTimeoutMs: number;
  private readonly coldStartWaitMs: number;
  private lastSyncAt = 0;
  private synced = false;
  private refreshing?: Promise<void>;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly logger: Logger,
    options: SessionServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 30_000;
    this.now = options.now ?? Date.now;
    this.store = options.store;
    this.attachments = options.attachments;
    this.syncTimeoutMs = options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
    this.coldStartWaitMs =
      options.coldStartWaitMs ?? DEFAULT_SESSION_COLD_START_MS;
  }

  get sessionCount(): number {
    return this.sessions.size;
  }

  get lastSync(): number {
    return this.lastSyncAt;
  }

  cached(): Session[] {
    return [...this.sessions.values()];
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;

    const run = (async () => {
      const adapters = this.registry
        .adapters()
        .filter(
          (adapter) =>
            !providerUnavailableReason(this.registry, adapter.id),
        );
      await Promise.allSettled(
        adapters.map(async (adapter) => {
          try {
            const page = await adapter.listSessions(
              { limit: MAX_LIMIT },
              syncSignal(this.registry, adapter.id, this.syncTimeoutMs),
            );
            const refs = new Set<string>();
            for (const session of page.data) {
              refs.add(session.ref);
              this.sessions.set(session.ref, this.applyReadMarker(session));
            }
            // The provider is authoritative for its own sessions. Drop cached
            // rows it no longer reports, but never drop rows for a provider
            // that failed or was skipped.
            for (const [ref, session] of this.sessions) {
              if (session.providerID === adapter.id && !refs.has(ref)) {
                this.sessions.delete(ref);
              }
            }
            this.synced = true;
          } catch (error) {
            this.logger.warn("Session sync failed", {
              providerID: adapter.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }),
      );

      this.lastSyncAt = this.now();
      this.synced = true;
    })();

    this.refreshing = run;
    try {
      await run;
    } finally {
      this.refreshing = undefined;
    }
  }

  private startRefresh(): Promise<void> {
    return this.refresh().catch((error) => {
      this.logger.warn("Session refresh failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  async list(query: SessionListQuery): Promise<SessionPage> {
    const search = query.q?.trim();
    if (search) return this.searchSessions(query, search);

    if (!this.synced || this.now() - this.lastSyncAt >= this.ttlMs) {
      const refresh = this.startRefresh();
      if (!this.synced) {
        await waitAtMost(refresh, this.coldStartWaitMs);
      } else {
        void refresh;
      }
      // Warm cache: return immediately while the refresh continues in the
      // background. Slow or offline providers must not hold up the response.
    }
    return this.paginate(
      this.filterSessions([...this.sessions.values()], query),
      query,
    );
  }

  private filterSessions(
    data: Session[],
    query: SessionListQuery,
  ): Session[] {
    let filtered = data;
    if (query.scope === "root") {
      filtered = filtered.filter((session) => !session.parentRef);
    }
    if (query.provider) {
      filtered = filtered.filter(
        (session) => session.providerID === query.provider,
      );
    }
    if (query.status) {
      filtered = filtered.filter(
        (session) => session.status === query.status,
      );
    }
    filtered.sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.ref.localeCompare(right.ref),
    );
    return filtered;
  }

  private paginate(
    data: Session[],
    query: SessionListQuery,
  ): SessionPage {
    const offset = decodeCursor(query.cursor);
    const limit = clampLimit(query.limit);
    const page = data.slice(offset, offset + limit);
    const next =
      offset + limit < data.length ? encodeCursor(offset + limit) : null;
    const previous =
      offset > 0 ? encodeCursor(Math.max(0, offset - limit)) : null;

    return {
      data: page,
      cursor: { next, previous },
    };
  }

  private async searchSessions(
    query: SessionListQuery,
    search: string,
  ): Promise<SessionPage> {
    const limit = clampLimit(query.limit);
    const needle = search.toLowerCase();
    const merged = new Map<string, Session>();

    // Start with recent cache matches, then let provider results replace them.
    for (const session of this.sessions.values()) {
      if (matchesSearch(session, needle)) {
        merged.set(session.ref, session);
      }
    }

    const adapters = this.registry
      .adapters()
      .filter(
        (adapter) =>
          (!query.provider || adapter.id === query.provider) &&
          !providerUnavailableReason(this.registry, adapter.id),
      );

    const results = await Promise.all(
      adapters.map(async (adapter) => {
        try {
          const page = await adapter.listSessions(
            { q: search, limit },
            syncSignal(this.registry, adapter.id, this.syncTimeoutMs),
          );
          return { page };
        } catch (error) {
          this.logger.warn("Session search failed", {
            provider: adapter.id,
            error: error instanceof Error ? error.message : String(error),
          });
          return { page: undefined };
        }
      }),
    );

    for (const result of results) {
      if (!result.page) continue;
      for (const session of result.page.data) {
        merged.set(session.ref, this.applyReadMarker(session));
      }
    }

    // Provider cursors are opaque, so cross-provider search stays single-page.
    return {
      data: this.filterSessions([...merged.values()], query).slice(0, limit),
      cursor: { next: null, previous: null },
    };
  }

  async get(ref: string): Promise<Session> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) {
      const cached = this.sessions.get(ref);
      if (!cached) throw notFound("Session not found");
      return cached;
    }

    const unavailable = providerUnavailableReason(this.registry, adapter.id);
    if (unavailable) {
      const cached = this.sessions.get(ref);
      if (cached) return cached;
      throw providerOfflineError(adapter.id, unavailable);
    }

    try {
      const session = this.applyReadMarker(
        await adapter.getSession(
          ref,
          operationSignal(this.registry, adapter.id, 15_000),
        ),
      );
      this.sessions.set(session.ref, session);
      return session;
    } catch (error) {
      const cached = this.sessions.get(ref);
      if (cached) return cached;
      throw error;
    }
  }

  /**
   * Return the last synced session without touching the provider. Read-path
   * callers use this for cheap metadata on a latency budget.
   */
  cachedSession(ref: string): Session | undefined {
    return this.sessions.get(ref);
  }

  async messages(ref: string, query: MessagesQuery): Promise<MessagePage> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) {
      const session = this.sessions.get(ref);
      if (!session) throw notFound("Session not found");
      return { data: [], cursor: { next: null, previous: null } };
    }
    this.assertProviderAvailable(adapter.id);
    return adapter.getMessages(
      ref,
      query,
      operationSignal(this.registry, adapter.id, 15_000),
    );
  }

  /**
   * Read a file from a session's working directory.
   *
   * The provider owns the filesystem, so the hub asks it to resolve the path
   * instead of reading the host disk. `path` is jailed to the session directory
   * before it reaches the adapter.
   */
  async readFile(ref: string, path: string): Promise<ProviderResource> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) throw notFound("Session not found");
    if (!adapter.capabilities.files || !adapter.readFile) {
      throw notImplemented("This provider does not expose session files");
    }
    this.assertProviderAvailable(adapter.id);

    let directory = this.sessions.get(ref)?.directory;
    if (!directory && isAbsoluteSessionPath(path)) {
      directory = (
        await adapter.getSession(
          ref,
          operationSignal(this.registry, adapter.id, 15_000),
        )
      ).directory;
    }

    return adapter.readFile(
      {
        ref,
        directory,
        path: relativeSessionPath(path, directory),
      },
      operationSignal(this.registry, adapter.id, 20_000),
    );
  }

  async sendMessage(ref: string, input: SendInput): Promise<SendResult> {
    const adapter = this.adapterForRef(ref);
    if (!adapter?.capabilities.send) {
      throw notImplemented("This provider does not support sending messages");
    }
    this.assertProviderAvailable(adapter.id);
    const attachmentIDs = input.attachments ?? [];
    if (input.text.trim().length === 0 && attachmentIDs.length === 0) {
      throw badRequest("A message needs text or an attachment");
    }
    if (attachmentIDs.length > 0 && !adapter.capabilities.attach) {
      throw notImplemented("This provider does not accept attachments");
    }

    const files = [];
    if (attachmentIDs.length > 0) {
      if (!this.attachments) {
        throw notImplemented("Attachment staging is not configured");
      }
      for (const id of attachmentIDs) {
        const staged = await this.attachments.read(id);
        files.push({
          name: staged.attachment.name,
          mimeType: staged.attachment.mimeType,
          data: staged.data,
        });
      }
    }

    const result = await adapter.sendMessage(
      ref,
      { ...input, ...(files.length > 0 ? { files } : {}) },
      operationSignal(this.registry, adapter.id, 180_000, 5_000),
    );

    for (const id of attachmentIDs) {
      await this.attachments?.remove(id).catch(() => undefined);
    }

    const session = this.sessions.get(ref);
    if (session) this.sessions.set(ref, { ...session, status: "running" });
    return result;
  }

  async listBranches(ref: string): Promise<BranchPoint[]> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) throw notFound("Session not found");
    if (!adapter.capabilities.branches || !adapter.listBranches) {
      return [];
    }
    this.assertProviderAvailable(adapter.id);
    return adapter.listBranches(
      ref,
      operationSignal(this.registry, adapter.id, 15_000, 5_000),
    );
  }

  async retryMessage(ref: string, messageId: string): Promise<SendResult> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) throw notFound("Session not found");
    if (!adapter.capabilities.retry || !adapter.retryMessage) {
      throw notImplemented("This provider does not support retrying messages");
    }
    this.assertProviderAvailable(adapter.id);
    const result = await adapter.retryMessage(
      ref,
      messageId,
      operationSignal(this.registry, adapter.id, 180_000, 5_000),
    );
    const session = this.sessions.get(ref);
    if (session) this.sessions.set(ref, { ...session, status: "running" });
    return result;
  }

  async switchBranch(ref: string, siblingId: string): Promise<void> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) throw notFound("Session not found");
    if (!adapter.capabilities.branches || !adapter.switchBranch) {
      throw notImplemented("This provider does not support switching branches");
    }
    this.assertProviderAvailable(adapter.id);
    await adapter.switchBranch(
      ref,
      siblingId,
      operationSignal(this.registry, adapter.id, 15_000, 5_000),
    );
  }

  async fork(ref: string, input: ForkInput): Promise<Session> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) throw notFound("Session not found");
    if (!adapter.capabilities.fork || !adapter.forkSession) {
      throw notImplemented("This provider does not support forking sessions");
    }
    this.assertProviderAvailable(adapter.id);
    const session = await adapter.forkSession(
      ref,
      input,
      operationSignal(this.registry, adapter.id, 30_000, 5_000),
    );
    this.sessions.set(session.ref, session);
    return session;
  }

  async setSessionOptions(
    ref: string,
    input: SessionSelectionInput,
  ): Promise<Session> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) throw notFound("Session not found");
    if (!adapter.setSessionOptions) {
      throw notImplemented("This provider does not support changing the model or agent");
    }
    this.assertProviderAvailable(adapter.id);

    await adapter.setSessionOptions(
      ref,
      input,
      operationSignal(this.registry, adapter.id, 15_000, 5_000),
    );
    const cached = this.sessions.get(ref);
    const fetched = await this.get(ref).catch(() => undefined);
    const base = fetched ?? cached;
    if (!base) throw notFound("Session not found");

    const updated: Session = {
      ...base,
      ...(input.model ? { model: input.model } : {}),
      ...(input.agent ? { agent: input.agent } : {}),
    };
    this.sessions.set(ref, updated);
    return updated;
  }

  async create(input: CreateSessionInput): Promise<Session> {
    const adapter = this.registry.adapter(input.providerID);
    if (!adapter?.capabilities.create) {
      throw notImplemented("This provider does not support creating sessions");
    }
    this.assertProviderAvailable(adapter.id);
    const session = await adapter.createSession(
      input,
      operationSignal(this.registry, adapter.id, 30_000, 5_000),
    );
    this.sessions.set(session.ref, session);
    return session;
  }

  async interrupt(ref: string): Promise<void> {
    const adapter = this.adapterForRef(ref);
    if (!adapter?.interrupt) {
      throw notImplemented("This provider does not support interrupting sessions");
    }
    this.assertProviderAvailable(adapter.id);
    await adapter.interrupt(
      ref,
      operationSignal(this.registry, adapter.id, 15_000, 5_000),
    );
    const session = this.sessions.get(ref);
    if (session) this.sessions.set(ref, { ...session, status: "idle" });
  }

  async options(providerID: string): Promise<ProviderOptions> {
    if (!this.synced || this.now() - this.lastSyncAt >= this.ttlMs) {
      void this.startRefresh();
    }
    const adapter = this.registry.adapter(providerID);
    if (!adapter?.getOptions) {
      throw notImplemented("This provider does not expose creation options");
    }
    this.assertProviderAvailable(providerID);
    const options = await adapter.getOptions(
      operationSignal(this.registry, providerID, 15_000, 5_000),
    );
    const providerSessions = [...this.sessions.values()]
      .filter((session) => session.providerID === providerID)
      .sort((left, right) => right.updatedAt - left.updatedAt);
    const latest = providerSessions[0];
    const directories = [
      ...new Set(
        providerSessions
          .map((session) => session.directory)
          .filter((directory): directory is string => Boolean(directory))
          .sort(),
      ),
    ];
    const latestModel = latest?.model?.split("#")[0];
    return {
      ...options,
      directories: directories.length > 0 ? directories : options.directories,
      defaults: {
        ...options.defaults,
        ...(latest?.directory ?? directories[0]
          ? { directory: latest?.directory ?? directories[0] }
          : {}),
        ...(options.agents[0] && !options.defaults?.agent
          ? { agent: latest?.agent ?? options.agents[0].id }
          : {}),
        ...(latestModel && options.models.some((model) => model.id === latestModel)
          ? { model: latestModel }
          : options.models[0] && !options.defaults?.model
            ? { model: options.models[0].id }
            : {}),
      },
    };
  }

  invalidate(): void {
    this.lastSyncAt = 0;
  }

  async markRead(ref: string): Promise<void> {
    const adapter = this.adapterForRef(ref);
    const session = this.sessions.get(ref);
    const unavailable = adapter
      ? providerUnavailableReason(this.registry, adapter.id)
      : undefined;
    if (!adapter?.markRead || unavailable) {
      if (!session) throw notFound("Session not found");
    } else {
      await adapter.markRead(
        ref,
        operationSignal(this.registry, adapter.id, 15_000, 5_000),
      );
    }

    const readAt = this.now();
    if (this.store) {
      await this.store.update((state) => {
        state.readMarkers[ref] = {
          readAt,
          updatedAt: session?.updatedAt ?? readAt,
        };
      });
    }
    if (session) this.sessions.set(ref, { ...session, unread: false });
  }

  private applyReadMarker(session: Session): Session {
    const marker = this.store?.getState().readMarkers[session.ref];
    if (!marker || session.updatedAt > marker.updatedAt) return session;
    return session.unread ? { ...session, unread: false } : session;
  }

  private assertProviderAvailable(providerID: string): void {
    const reason = providerUnavailableReason(this.registry, providerID);
    if (reason) throw providerOfflineError(providerID, reason);
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

function matchesSearch(session: Session, needle: string): boolean {
  return [session.title, session.project, session.directory, session.agent]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
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
