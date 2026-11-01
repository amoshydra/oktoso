import { describe, expect, it } from "vitest";
import type { Attention, Session } from "@amoshydra/oktoso-contracts";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import type { ProviderRegistry } from "./provider-registry";
import type { SessionService } from "./session-service";
import type { EventBus } from "./event-bus";
import type { Logger } from "../lib/logger";
import { AttentionService } from "./attention-service";

const now = 1_793_000_000_000;

function session(overrides: Partial<Session> = {}): Session {
  return {
    ref: "desktop-opencode:ses_main",
    providerID: "desktop-opencode",
    nativeID: "ses_main",
    title: "Main session",
    status: "idle",
    unread: false,
    updatedAt: now - 1_000,
    createdAt: now - 10_000,
    ...overrides,
  };
}

function attention(
  id: string,
  sessionRef: string,
  type: Attention["type"],
): Attention {
  return {
    id,
    sessionRef,
    type,
    priority: type === "unread" ? "normal" : "blocking",
    title: id,
    summary: id,
    createdAt: now,
    actions: [],
  };
}

const logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

describe("AttentionService subagent policy", () => {
  it("suppresses child unread and error noise but keeps child blocking items", async () => {
    const parentRef = "desktop-opencode:ses_main";
    const childRef = "desktop-opencode:ses_child";
    const childErrorRef = "desktop-opencode:ses_child_error";
    const rootUnreadRef = "desktop-opencode:ses_root_unread";
    const sessions = [
      session({ ref: parentRef, unread: true, updatedAt: now - 1_000 }),
      session({
        ref: rootUnreadRef,
        nativeID: "ses_root_unread",
        unread: true,
        updatedAt: now - 950,
      }),
      session({
        ref: childRef,
        nativeID: "ses_child",
        parentRef,
        unread: true,
        updatedAt: now - 900,
      }),
      session({
        ref: childErrorRef,
        nativeID: "ses_child_error",
        parentRef,
        status: "error",
        updatedAt: now - 800,
      }),
    ];
    const providerItems = [
      attention("permission-root", parentRef, "permission"),
      attention("permission-child", childRef, "permission"),
      attention("question-child", childRef, "question"),
    ];

    const registry = {
      adapters: () => [
        {
          id: "desktop-opencode",
          listAttention: async () => providerItems,
        },
      ],
    } as unknown as ProviderRegistry;
    const sessionService = {
      list: async () => ({
        data: sessions,
        cursor: { previous: null, next: null },
      }),
      markRead: async () => undefined,
      invalidate: () => undefined,
    } as unknown as SessionService;
    const store = new MemoryStateStore();
    const eventBus = {
      publish: async () => ({}),
    } as unknown as EventBus;
    const service = new AttentionService(
      registry,
      sessionService,
      store,
      eventBus,
      logger,
      { now: () => now },
    );

    await service.refresh();
    const page = await service.list();

    expect(page.data.some((item) => item.id === "permission-root")).toBe(true);
    expect(
      page.data.find((item) => item.id === "permission-child"),
    ).toMatchObject({ parentRef });
    expect(
      page.data.find((item) => item.id === "question-child"),
    ).toMatchObject({ parentRef });

    expect(
      page.data.some(
        (item) => item.type === "unread" && item.sessionRef === rootUnreadRef,
      ),
    ).toBe(true);
    expect(
      page.data.some(
        (item) => item.type === "unread" && item.sessionRef === parentRef,
      ),
    ).toBe(false);
    expect(
      page.data.some(
        (item) => item.type === "unread" && item.sessionRef === childRef,
      ),
    ).toBe(false);
    expect(
      page.data.some(
        (item) =>
          item.type === "error" && item.sessionRef === childErrorRef,
      ),
    ).toBe(false);
  });
});
