import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { JsonStateStore } from "./json-store";

const roots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agent-hub-store-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("JsonStateStore", () => {
  it("creates, persists, and reloads hub state", async () => {
    const root = await tempRoot();
    const filePath = join(root, "state.json");
    const store = await JsonStateStore.open({ filePath });

    expect(store.getState().lastSeq).toBe(0);
    await store.update((state) => {
      state.lastSeq = 7;
      state.readMarkers["desktop-opencode:ses_1"] = {
        readAt: 10,
        updatedAt: 10,
      };
    });
    await store.close();

    const reopened = await JsonStateStore.open({ filePath });
    expect(reopened.getState().lastSeq).toBe(7);
    expect(reopened.getState().readMarkers["desktop-opencode:ses_1"]?.readAt).toBe(10);
    await reopened.close();

    const mode = (await stat(filePath)).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      lastSeq: 7,
    });
  });

  it("serializes concurrent updates", async () => {
    const root = await tempRoot();
    const store = await JsonStateStore.open({ filePath: join(root, "state.json") });

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        store.update((state) => {
          state.readMarkers[`s${index}`] = {
            readAt: index,
            updatedAt: index,
          };
        }),
      ),
    );

    expect(Object.keys(store.getState().readMarkers)).toHaveLength(20);
    await store.close();
  });

  it("refuses unsupported schema versions", async () => {
    const root = await tempRoot();
    const filePath = join(root, "state.json");
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(filePath, JSON.stringify({ schemaVersion: 99 }), "utf8"),
    );

    await expect(JsonStateStore.open({ filePath })).rejects.toThrow(
      /Unsupported hub state schema version/,
    );
  });
});
