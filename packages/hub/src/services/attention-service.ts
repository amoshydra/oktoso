import type {
  Attention,
  AttentionActionInput,
  AttentionPage,
  AttentionType,
  Session,
} from "@amoshydra/oktoso-contracts";
import type { StateStore } from "@amoshydra/oktoso-storage";
import type { ProviderAdapter } from "@amoshydra/oktoso-providers";
import { AppError, notFound, notImplemented } from "../domain/errors";
import type { Logger } from "../lib/logger";
import type { EventBus } from "./event-bus";
import type { ProviderRegistry } from "./provider-registry";
import type { SessionService } from "./session-service";
import {
  DEFAULT_ATTENTION_COLD_START_MS,
  DEFAULT_SYNC_TIMEOUT_MS,
  providerOfflineError,
  providerUnavailableReason,
  syncSignal,
  waitAtMost,
} from "./provider-sync";

export interface AttentionServiceOptions {
  ttlMs?: number;
  now?: () => number;
  unreadWindowMs?: number;
  maxUnread?: number;
  syncTimeoutMs?: number;
  coldStartWaitMs?: number;
}

const PRIORITY_ORDER = { blocking: 0, high: 1, normal: 2 } as const;

export class AttentionService {
  private items = new Map<string, Attention>();
  private lastRefresh = 0;
  private synced = false;
  private refreshing?: Promise<void>;
  private readonly pendingActions = new Set<string>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly unreadWindowMs: number;
  private readonly maxUnread: number;
  private readonly syncTimeoutMs: number;
  private readonly coldStartWaitMs: number;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly sessions: SessionService,
    private readonly store: StateStore,
    private readonly eventBus: EventBus,
    private readonly logger: Logger,
    options: AttentionServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? 5_000;
    this.now = options.now ?? Date.now;
    this.unreadWindowMs = options.unreadWindowMs ?? 24 * 60 * 60 * 1_000;
    this.maxUnread = options.maxUnread ?? 10;
    this.syncTimeoutMs = options.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
    this.coldStartWaitMs =
      options.coldStartWaitMs ?? DEFAULT_ATTENTION_COLD_START_MS;
  }

  get count(): number {
    return this.items.size;
  }

  get lastSync(): number {
    return this.lastRefresh;
  }

  invalidate(): void {
    this.lastRefresh = 0;
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;

    const run = (async () => {
      const previous = this.items;
      const next = new Map<string, Attention>();
      const adapters = this.registry.adapters();
      const sessionPromise = this.sessions.list({ limit: 200 });
      const cachedSessions = this.sessions.cached?.() ?? [];
      const cachedByRef = new Map(
        cachedSessions.map((session) => [session.ref, session]),
      );
      const directoriesByProvider = new Map<string, Set<string>>();
      const addDirectory = (providerID: string, directory: string) => {
        let directories = directoriesByProvider.get(providerID);
        if (!directories) {
          directories = new Set();
          directoriesByProvider.set(providerID, directories);
        }
        directories.add(directory);
      };

      for (const session of cachedSessions) {
        if (session.status === "running" && session.directory) {
          addDirectory(session.providerID, session.directory);
        }
      }
      // Keep polling a directory while one of its provider attention items is
      // still pending, even if the session's status briefly changed.
      for (const item of previous.values()) {
        if (item.type !== "permission" && item.type !== "approval" && item.type !== "question") {
          continue;
        }
        const session = cachedByRef.get(item.sessionRef);
        const directory = session?.directory;
        if (directory) {
          const separator = item.sessionRef.indexOf(":");
          addDirectory(
            session?.providerID ??
              (separator > 0
                ? item.sessionRef.slice(0, separator)
                : item.sessionRef),
            directory,
          );
        }
      }
      const resultsPromise = Promise.all(
        adapters.map(async (adapter) => {
          const unavailable = providerUnavailableReason(
            this.registry,
            adapter.id,
          );
          if (unavailable) {
            return {
              adapterID: adapter.id,
              items: [] as Attention[],
              skipped: true,
              error: new Error(`Provider ${adapter.id} is ${unavailable}`),
            };
          }
          if (!adapter.listAttention) return { adapterID: adapter.id, items: [] };
          try {
            return {
              adapterID: adapter.id,
              items: await adapter.listAttention(
                [...(directoriesByProvider.get(adapter.id) ?? [])],
                syncSignal(this.registry, adapter.id, this.syncTimeoutMs),
              ),
            };
          } catch (error) {
            return {
              adapterID: adapter.id,
              items: [] as Attention[],
              error,
            };
          }
        }),
      );

      const sessionPage = await sessionPromise;
      const sessionByRef = new Map(
        sessionPage.data.map((session) => [session.ref, session]),
      );
      const results = await resultsPromise;
      for (const result of results) {
        if (!result.error) {
          for (const item of result.items) {
            const enriched = this.enrichProviderItem(
              item,
              sessionByRef.get(item.sessionRef),
            );
            const existing = previous.get(enriched.id);
            next.set(
              enriched.id,
              existing ? { ...enriched, createdAt: existing.createdAt } : enriched,
            );
          }
          continue;
        }

        if (!("skipped" in result && result.skipped)) {
          this.logger.warn("Attention sync failed", {
            providerID: result.adapterID,
            error:
              result.error instanceof Error
                ? result.error.message
                : String(result.error),
          });
        }
        // A provider outage must not look like the user resolved every item.
        for (const [id, item] of previous) {
          if (
            item.sessionRef.startsWith(`${result.adapterID}:`) &&
            item.type !== "unread" &&
            item.type !== "error"
          ) {
            next.set(id, item);
          }
        }
      }

      // A blocking provider form already represents the session's next action.
      // Do not add an unread row for the same session.
      const blockingRefs = new Set(
        [...next.values()]
          .filter(
            (item) =>
              item.type === "permission" ||
              item.type === "approval" ||
              item.type === "question",
          )
          .map((item) => item.sessionRef),
      );

      // Child sessions are implementation detail for the parent task. They
      // should not create unread/error noise. Provider-native permission and
      // question items are still kept above because they can block the parent;
      // OpenCode does not reliably propagate those prompts to the parent UI.
      const unreadSessions = sessionPage.data
        .filter(
          (session) =>
            !session.parentRef &&
            !blockingRefs.has(session.ref) &&
            session.status !== "error" &&
            session.unread &&
            this.now() - session.updatedAt <= this.unreadWindowMs,
        )
        .sort((left, right) => right.updatedAt - left.updatedAt)
        .slice(0, this.maxUnread);
      const unreadRefs = new Set(unreadSessions.map((session) => session.ref));

      for (const session of sessionPage.data) {
        if (session.parentRef) continue;
        if (session.status === "error") {
          const item: Attention = {
            id: `${session.providerID}:error:${session.nativeID}:${session.updatedAt}`,
            sessionRef: session.ref,
            type: "error",
            priority: "high",
            title: session.title,
            summary: `Session failed${session.project ? ` · ${session.project}` : ""}`,
            createdAt: session.updatedAt,
            actions: [{ id: "dismiss", label: "Dismiss", style: "danger" }],
          };
          next.set(item.id, item);
        } else if (session.unread && unreadRefs.has(session.ref)) {
          const item: Attention = {
            id: `${session.providerID}:unread:${session.nativeID}:${session.updatedAt}`,
            sessionRef: session.ref,
            type: "unread",
            priority: "normal",
            title: session.title,
            summary: `New activity in ${session.project ?? session.providerID}`,
            createdAt: session.updatedAt,
            actions: [{ id: "mark_read", label: "Mark read" }],
          };
          next.set(item.id, item);
        }
      }

      const acknowledged = this.store.getState().attention;
      for (const [id, item] of next) {
        if (acknowledged[id]?.acknowledgedAt !== undefined) next.delete(id);
        else next.set(id, item);
      }

      this.items = next;
      this.lastRefresh = this.now();
      this.synced = true;
      await this.emitChanges(previous, next);
    })();

    this.refreshing = run;
    try {
      await run;
    } finally {
      this.refreshing = undefined;
    }
  }

  async list(query: {
    type?: AttentionType;
    sessionRef?: string;
  } = {}): Promise<AttentionPage> {
    await this.ensureReady();
    let data = [...this.items.values()];
    if (query.type) data = data.filter((item) => item.type === query.type);
    if (query.sessionRef) data = data.filter((item) => item.sessionRef === query.sessionRef);
    data.sort(
      (left, right) =>
        PRIORITY_ORDER[left.priority] - PRIORITY_ORDER[right.priority] ||
        right.createdAt - left.createdAt ||
        left.id.localeCompare(right.id),
    );
    return { data };
  }

  async act(
    id: string,
    action: string,
    input: AttentionActionInput = {},
  ): Promise<void> {
    await this.ensureReady();
    const item = this.items.get(id);
    if (!item) throw notFound("Attention item not found");
    if (this.pendingActions.has(id)) {
      throw new AppError("conflict", "Attention action is already pending", 409);
    }
    this.pendingActions.add(id);

    try {
      if (item.type === "unread" || item.type === "error") {
        if (action === "mark_read") {
          await this.sessions.markRead(item.sessionRef);
          await this.acknowledge(id);
        } else if (action === "dismiss") {
          await this.acknowledge(id);
        } else {
          throw notImplemented(`Unsupported attention action: ${action}`);
        }
      } else {
        const providerID = item.sessionRef.slice(0, item.sessionRef.indexOf(":"));
        const reason = providerUnavailableReason(this.registry, providerID);
        if (reason) throw providerOfflineError(providerID, reason);
        const adapter = this.registry.adapter(providerID);
        if (!adapter?.actOnAttention) {
          throw notImplemented("This provider does not support attention actions");
        }
        await adapter.actOnAttention(
          item.id,
          action,
          input,
          AbortSignal.timeout(30_000),
        );
        await this.acknowledge(id);
        this.sessions.invalidate();
      }

      await this.publishAttention("attention.resolved", item);
      this.items.delete(id);
    } finally {
      this.pendingActions.delete(id);
    }
  }

  private enrichProviderItem(
    item: Attention,
    session: Session | undefined,
  ): Attention {
    if (!session) return item;
    const parent = session.parentRef ? { parentRef: session.parentRef } : {};
    if (item.type === "permission" || item.type === "approval") {
      return {
        ...item,
        ...parent,
        title: session.title,
        summary: item.summary || item.title,
      };
    }
    if (item.type === "question") {
      return {
        ...item,
        ...parent,
        title: session.title,
        summary: [item.title, item.summary].filter(Boolean).join(" · "),
      };
    }
    return { ...item, ...parent };
  }

  private async emitChanges(
    previous: Map<string, Attention>,
    next: Map<string, Attention>,
  ): Promise<void> {
    for (const [id, item] of next) {
      const before = previous.get(id);
      if (!before) {
        await this.publishAttention("attention.created", item);
      } else if (JSON.stringify(before) !== JSON.stringify(item)) {
        await this.publishAttention("attention.updated", item);
      }
    }
    for (const [id, item] of previous) {
      if (!next.has(id)) {
        await this.publishAttention("attention.resolved", item);
      }
    }
  }

  private async publishAttention(
    type: "attention.created" | "attention.updated" | "attention.resolved",
    item: Attention,
  ): Promise<void> {
    try {
      await this.eventBus.publish(type, item, {
        sessionRef: item.sessionRef,
        attentionID: item.id,
      });
    } catch (error) {
      this.logger.warn("Attention event publish failed", {
        attentionID: item.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private ensureReady(): Promise<void> {
    if (this.synced && this.now() - this.lastRefresh < this.ttlMs) {
      return Promise.resolve();
    }
    const refresh = this.refresh().catch((error) => {
      this.logger.warn("Attention refresh failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
    if (!this.synced) return waitAtMost(refresh, this.coldStartWaitMs);
    void refresh;
    return Promise.resolve();
  }

  private async acknowledge(id: string): Promise<void> {
    await this.store.update((state) => {
      state.attention[id] = {
        ...state.attention[id],
        acknowledgedAt: this.now(),
      };
    });
  }
}
