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
import type { ProviderAdapter } from "@amoshydra/oktoso-providers";
import { badRequest, notFound, notImplemented } from "../domain/errors";
import type { Logger } from "../lib/logger";
import type { StateStore } from "@amoshydra/oktoso-storage";
import type { AttachmentStore } from "./attachment-store";
import type { ProviderRegistry } from "./provider-registry";

export interface SessionServiceOptions {
  ttlMs?: number;
  now?: () => number;
  store?: StateStore;
  attachments?: AttachmentStore;
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
  private lastSyncAt = 0;
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

      const successfulProviders = new Map<string, Set<string>>();
      for (const result of results) {
        if (result.status === "fulfilled") {
          const refs = new Set<string>();
          for (const session of result.value.page.data) {
            refs.add(session.ref);
            this.sessions.set(session.ref, this.applyReadMarker(session));
          }
          successfulProviders.set(result.value.adapter.id, refs);
        } else {
          this.logger.warn("Session sync failed", {
            error:
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
          });
        }
      }

      // Providers are authoritative: drop cached sessions they no longer
      // report, but only for providers whose sync succeeded.
      for (const [providerID, refs] of successfulProviders) {
        for (const [ref, session] of this.sessions) {
          if (session.providerID === providerID && !refs.has(ref)) {
            this.sessions.delete(ref);
          }
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
    if (query.scope === "root") data = data.filter((session) => !session.parentRef);
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
      const session = this.applyReadMarker(
        await adapter.getSession(ref, AbortSignal.timeout(15_000)),
      );
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

  async sendMessage(ref: string, input: SendInput): Promise<SendResult> {
    const adapter = this.adapterForRef(ref);
    if (!adapter?.capabilities.send) {
      throw notImplemented("This provider does not support sending messages");
    }
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
      AbortSignal.timeout(180_000),
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
    return adapter.listBranches(ref, AbortSignal.timeout(15_000));
  }

  async retryMessage(ref: string, messageId: string): Promise<SendResult> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) throw notFound("Session not found");
    if (!adapter.capabilities.retry || !adapter.retryMessage) {
      throw notImplemented("This provider does not support retrying messages");
    }
    const result = await adapter.retryMessage(
      ref,
      messageId,
      AbortSignal.timeout(180_000),
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
    await adapter.switchBranch(ref, siblingId, AbortSignal.timeout(15_000));
  }

  async fork(ref: string, input: ForkInput): Promise<Session> {
    const adapter = this.adapterForRef(ref);
    if (!adapter) throw notFound("Session not found");
    if (!adapter.capabilities.fork || !adapter.forkSession) {
      throw notImplemented("This provider does not support forking sessions");
    }
    const session = await adapter.forkSession(
      ref,
      input,
      AbortSignal.timeout(30_000),
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

    await adapter.setSessionOptions(ref, input, AbortSignal.timeout(15_000));
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
    const session = await adapter.createSession(
      input,
      AbortSignal.timeout(30_000),
    );
    this.sessions.set(session.ref, session);
    return session;
  }

  async interrupt(ref: string): Promise<void> {
    const adapter = this.adapterForRef(ref);
    if (!adapter?.interrupt) {
      throw notImplemented("This provider does not support interrupting sessions");
    }
    await adapter.interrupt(ref, AbortSignal.timeout(15_000));
    const session = this.sessions.get(ref);
    if (session) this.sessions.set(ref, { ...session, status: "idle" });
  }

  async options(providerID: string): Promise<ProviderOptions> {
    await this.ensureFresh();
    const adapter = this.registry.adapter(providerID);
    if (!adapter?.getOptions) {
      throw notImplemented("This provider does not expose creation options");
    }
    const options = await adapter.getOptions(AbortSignal.timeout(15_000));
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
    if (!adapter?.markRead) {
      if (!session) throw notFound("Session not found");
    } else {
      await adapter.markRead(ref, AbortSignal.timeout(15_000));
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
