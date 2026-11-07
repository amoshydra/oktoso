import { describe, expect, it } from "vitest";
import {
  forgetPendingSend,
  loadPendingSends,
  rememberPendingSend,
  savePendingSends,
  type PendingSend,
  type PendingStorage,
} from "./pending-send";

function memoryStorage(): PendingStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function pending(key: string, createdAt = Date.now()): PendingSend {
  return {
    idempotencyKey: key,
    sessionRef: "provider:session",
    sessionTitle: "Session",
    payload: { text: `message ${key}` },
    createdAt,
  };
}

describe("pending sends", () => {
  it("remembers and forgets a send", () => {
    const storage = memoryStorage();
    rememberPendingSend(pending("key-1"), storage);
    expect(loadPendingSends(storage)).toHaveLength(1);

    expect(forgetPendingSend("key-1", storage)).toEqual([]);
    expect(loadPendingSends(storage)).toEqual([]);
  });

  it("replaces an entry with the same idempotency key", () => {
    const storage = memoryStorage();
    rememberPendingSend(pending("key-1"), storage);
    rememberPendingSend(
      { ...pending("key-1"), payload: { text: "updated" } },
      storage,
    );

    expect(loadPendingSends(storage)).toMatchObject([
      { idempotencyKey: "key-1", payload: { text: "updated" } },
    ]);
  });

  it("caps the queue", () => {
    const storage = memoryStorage();
    for (let index = 0; index < 12; index += 1) {
      rememberPendingSend(pending(`key-${index}`), storage);
    }

    const items = loadPendingSends(storage);
    expect(items).toHaveLength(10);
    expect(items[0]?.idempotencyKey).toBe("key-2");
  });

  it("drops expired entries", () => {
    const storage = memoryStorage();
    savePendingSends([pending("old", Date.now() - 31 * 24 * 60 * 60 * 1_000)], storage);
    expect(loadPendingSends(storage)).toEqual([]);
  });

  it("ignores malformed storage", () => {
    const storage = memoryStorage();
    storage.setItem("oktoso-g2-pending-sends", "{not json");
    expect(loadPendingSends(storage)).toEqual([]);
  });
});
