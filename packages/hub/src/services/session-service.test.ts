import { describe, expect, it } from "vitest";
import type { Session } from "@amoshydra/oktoso-contracts";
import type { ProviderAdapter } from "@amoshydra/oktoso-providers";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { createLogger } from "../lib/logger";
import type { ProviderRegistry } from "./provider-registry";
import { SessionService } from "./session-service";

const logger = createLogger({ level: "silent" });

describe("SessionService read markers", () => {  it("keeps a session read across provider refreshes until new activity", async () => {
    const session: Session = {
      ref: "test:ses_1",
      providerID: "test",
      nativeID: "ses_1",
      title: "Read marker test",
      status: "idle",
      unread: true,
      updatedAt: 100,
      createdAt: 50,
    };
    const adapter = {
      id: "test",
      listSessions: async () => ({
        data: [{ ...session }],
        cursor: { next: null, previous: null },
      }),
      getSession: async () => ({ ...session }),
      markRead: async () => undefined,
    } as unknown as ProviderAdapter;
    const registry = {
      adapters: () => [adapter],
      adapter: (id: string) => (id === "test" ? adapter : undefined),
    } as unknown as ProviderRegistry;
    const store = new MemoryStateStore();
    const sessions = new SessionService(registry, logger, {
      store,
      ttlMs: 0,
    });

    await sessions.refresh();
    expect((await sessions.list({})).data[0]?.unread).toBe(true);

    await sessions.markRead(session.ref);
    expect(store.getState().readMarkers[session.ref]).toMatchObject({
      updatedAt: 100,
    });

    sessions.invalidate();
    await sessions.refresh();
    expect((await sessions.list({})).data[0]?.unread).toBe(false);

    session.updatedAt = 200;
    sessions.invalidate();
    await sessions.refresh();
    expect((await sessions.list({})).data[0]?.unread).toBe(true);
  });
  it("can exclude child sessions from the session list", async () => {
    const root: Session = {
      ref: "test:ses_root",
      providerID: "test",
      nativeID: "ses_root",
      title: "Root session",
      status: "idle",
      unread: false,
      updatedAt: 200,
      createdAt: 100,
    };
    const child: Session = {
      ...root,
      ref: "test:ses_child",
      nativeID: "ses_child",
      title: "Child session",
      parentRef: root.ref,
      updatedAt: 300,
    };
    const adapter = {
      id: "test",
      listSessions: async () => ({
        data: [root, child],
        cursor: { next: null, previous: null },
      }),
    } as unknown as ProviderAdapter;
    const registry = {
      adapters: () => [adapter],
      adapter: (id: string) => (id === "test" ? adapter : undefined),
    } as unknown as ProviderRegistry;
    const sessions = new SessionService(registry, logger);

    expect((await sessions.list({})).data).toHaveLength(2);
    expect((await sessions.list({ scope: "root" })).data).toEqual([
      expect.objectContaining({ ref: root.ref }),
    ]);
  });
});
;
