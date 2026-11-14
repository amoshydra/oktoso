import { describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadOrCreateVapidKeys,
  loadVapidKeys,
  vapidKeysPath,
} from "./vapid";

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "oktoso-vapid-"));
}

describe("VAPID keys", () => {
  it("returns undefined before the first use", async () => {
    const dir = await tempDir();
    try {
      expect(await loadVapidKeys(dir)).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("generates one owner-only pair and reuses it", async () => {
    const dir = await tempDir();
    try {
      const first = await loadOrCreateVapidKeys(dir);
      const second = await loadOrCreateVapidKeys(dir);

      expect(first.publicKey).not.toHaveLength(0);
      expect(first.privateKey).not.toHaveLength(0);
      expect(second).toEqual(first);

      const file = await stat(vapidKeysPath(dir));
      expect(file.mode & 0o777).toBe(0o600);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
