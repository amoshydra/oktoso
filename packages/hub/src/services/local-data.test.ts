import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDataService } from "./local-data";
import { ReplyFeedbackStore } from "./reply-feedback-store";
import type { TranscriptCacheService } from "./transcript-cache";

const roots: string[] = [];
const DAY = 24 * 60 * 60 * 1_000;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function setup(options: { now?: () => number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "oktoso-local-"));
  roots.push(root);
  const store = new MemoryStateStore();
  const feedback = new ReplyFeedbackStore({
    filePath: join(root, "reply-feedback.jsonl"),
  });
  await feedback.init();
  let cacheCleared = 0;
  const transcripts = {
    async clear() {
      cacheCleared += 1;
    },
  } as unknown as TranscriptCacheService;
  const service = new LocalDataService({
    store,
    feedback,
    transcripts,
    ...(options.now ? { now: options.now } : {}),
  });
  return {
    service,
    store,
    feedback,
    cleared: () => cacheCleared,
    feedbackPath: join(root, "reply-feedback.jsonl"),
  };
}

describe("LocalDataService", () => {
  it("counts every store", async () => {
    const { service, store, feedback } = await setup();
    await store.update((state) => {
      state.drafts["a:1"] = { text: "draft", updatedAt: 10 };
      state.readMarkers["a:1"] = { readAt: 10, updatedAt: 10 };
    });
    await feedback.append({
      sessionRef: "a:1",
      messageID: "m1",
      vote: "up",
    } as never);

    const view = await service.view();
    expect(view).toMatchObject({ drafts: 1, markers: 1, feedback: 1 });
    expect(view.feedbackBytes).toBeGreaterThan(0);
    expect(view.retention).toEqual({
      draftsDays: 0,
      markersDays: 30,
      feedbackDays: 30,
    });
  });

  it("clears one store without touching the others", async () => {
    const { service, store, feedback } = await setup();
    await store.update((state) => {
      state.drafts["a:1"] = { text: "draft", updatedAt: 10 };
      state.readMarkers["a:1"] = { readAt: 10, updatedAt: 10 };
    });
    await feedback.append({
      sessionRef: "a:1",
      messageID: "m1",
      vote: "up",
    } as never);

    await service.clear("drafts");
    expect(await service.view()).toMatchObject({ drafts: 0, markers: 1, feedback: 1 });

    await service.clear("feedback");
    expect(await service.view()).toMatchObject({ drafts: 0, markers: 1, feedback: 0 });
  });

  it("clears everything, including the cache", async () => {
    const { service, store, feedback, cleared } = await setup();
    await store.update((state) => {
      state.drafts["a:1"] = { text: "draft", updatedAt: 10 };
      state.readMarkers["a:1"] = { readAt: 10, updatedAt: 10 };
    });
    await feedback.append({
      sessionRef: "a:1",
      messageID: "m1",
      vote: "up",
    } as never);

    await service.clearAll();

    expect(await service.view()).toMatchObject({ drafts: 0, markers: 0, feedback: 0 });
    expect(cleared()).toBe(1);
  });

  it("prunes stores past their own window and leaves drafts alone by default", async () => {
    let now = 100 * DAY;
    const { service, store, feedback, feedbackPath } = await setup({
      now: () => now,
    });
    await store.update((state) => {
      state.drafts["old:1"] = { text: "old", updatedAt: 1 };
      state.drafts["new:1"] = { text: "new", updatedAt: now };
      state.readMarkers["old:1"] = { readAt: 1, updatedAt: 1 };
      state.readMarkers["new:1"] = { readAt: now, updatedAt: now };
    });
    const { readFile: readFeedback, writeFile } = await import("node:fs/promises");
    const input = {
      sessionRef: "a:1",
      mode: "reply" as const,
      systemPrompt: "prompt",
      context: "context",
      options: [],
      ratings: [],
    };
    await feedback.append(input);
    await feedback.append(input);
    const lines = (await readFeedback(feedbackPath, "utf8")).trim().split("\n");
    const rewritten = lines.map((line, index) => {
      const at = index === 0 ? 1 : now;
      return line.replace(/"createdAt":\d+/, `"createdAt":${at}`);
    });
    await writeFile(feedbackPath, `${rewritten.join("\n")}\n`);

    await service.prune();

    const view = await service.view();
    expect(view.drafts).toBe(2); // drafts default to Never
    expect(view.markers).toBe(1); // 30-day default drops the old one
    expect(view.feedback).toBe(1); // only the recent entry survives

    now = 200 * DAY;
    await service.prune();
    expect((await service.view()).feedback).toBe(0);
  });

  it("saves retention per store and prunes immediately", async () => {
    let now = 100 * DAY;
    const { service, store } = await setup({ now: () => now });
    await store.update((state) => {
      state.drafts["old:1"] = { text: "old", updatedAt: 1 };
      state.drafts["new:1"] = { text: "new", updatedAt: now };
    });

    const view = await service.updateRetention({ draftsDays: 7 });
    expect(view.retention.draftsDays).toBe(7);
    expect(view.drafts).toBe(1);
  });
});
