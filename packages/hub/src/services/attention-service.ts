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

export interface AttentionServiceOptions {
  ttlMs?: number;
  now?: () => number;
  unreadWindowMs?: number;
  maxUnread?: number;
}

const PRIORITY_ORDER = { blocking: 0, high: 1, normal: 2 } as const;

export class AttentionService {
  private items = new Map<string, Attention>();
  private lastRefresh = 0;
  private refreshing?: Promise<void>;
  private readonly pendingActions = new Set<string>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly unreadWindowMs: number;
  private readonly maxUnread: number;

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
      const sessionPage = await this.sessions.list({ limit: 200 });
      const sessionByRef = new Map(
        sessionPage.data.map((session) => [session.ref, session]),
      );
      const directorySet = new Set(
        sessionPage.data
          .filter((session) => session.status === "running" && session.directory)
          .map((session) => session.directory!),
      );
      // Keep polling a directory while one of its provider attention items is
      // still pending, even if the session's status briefly changed.
      for (const item of previous.values()) {
        if (item.type !== "permission" && item.type !== "approval" && item.type !== "question") {
          continue;
        }
        const directory = sessionByRef.get(item.sessionRef)?.directory;
        if (directory) directorySet.add(directory);
      }
      const directories = [...directorySet];
      const results = await Promise.all(
        adapters.map(async (adapter) => {
          if (!adapter.listAttention) return { adapterID: adapter.id, items: [] };
          try {
            return {
              adapterID: adapter.id,
              items: await adapter.listAttention(
                directories,
                AbortSignal.timeout(15_000),
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

        this.logger.warn("Attention sync failed", {
          providerID: result.adapterID,
          error:
            result.error instanceof Error
              ? result.error.message
              : String(result.error),
        });
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
    await this.ensureFresh();
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
    await this.ensureFresh();
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

  private async ensureFresh(): Promise<void> {
    if (this.now() - this.lastRefresh >= this.ttlMs) await this.refresh();
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
