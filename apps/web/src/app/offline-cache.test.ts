import { beforeEach, describe, expect, it } from "vitest";
import type { Session } from "@amoshydra/oktoso-contracts";
import { readSessionsCache, writeSessionsCache, readSessionCache, writeSessionCache } from "./offline-cache";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const session: Session = {
  ref: "desktop-opencode:ses_auth",
  providerID: "desktop-opencode",
  nativeID: "ses_auth",
  title: "Fix auth race in gateway",
  status: "idle",
  unread: false,
  updatedAt: 1_793_000_000_000,
  createdAt: 1_792_900_000_000,
};

describe("offline session cache", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: new MemoryStorage(),
      configurable: true,
    });
  });

  it("round-trips the first page", () => {
    writeSessionsCache({ sessions: [session], cursor: "next" });

    const cached = readSessionsCache();

    expect(cached?.sessions).toEqual([session]);
    expect(cached?.cursor).toBe("next");
    expect(cached?.savedAt).toBeTypeOf("number");
  });

  it("ignores malformed data", () => {
    localStorage.setItem("oktoso-sessions-cache-v1", "{not json");

    expect(readSessionsCache()).toBeUndefined();
  });

  it("rejects a row without the session fields", () => {
    localStorage.setItem(
      "oktoso-sessions-cache-v1",
      JSON.stringify({ savedAt: Date.now(), sessions: [{ nope: true }], cursor: null }),
    );

    expect(readSessionsCache()).toBeUndefined();
  });

  it("round-trips a session header for the offline chat", () => {
    writeSessionCache(session);

    expect(readSessionCache(session.ref)).toEqual(session);
    expect(readSessionCache("desktop-opencode:missing")).toBeUndefined();
  });
});
