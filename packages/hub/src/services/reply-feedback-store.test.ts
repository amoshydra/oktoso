import { appendFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ReplyFeedbackInput } from "@amoshydra/oktoso-contracts";
import { ReplyFeedbackStore } from "./reply-feedback-store";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function feedback(
  overrides: Partial<ReplyFeedbackInput> = {},
): ReplyFeedbackInput {
  return {
    sessionRef: "desktop-opencode:ses_1",
    mode: "reply",
    systemPrompt: "prompt",
    context: "context",
    options: [
      {
        id: "model-0",
        label: "Use the mirror",
        text: "Use the mirror",
        source: "model",
        action: "send",
      },
    ],
    ratings: [{ optionId: "model-0", verdict: "useful" }],
    ...overrides,
  };
}

async function createStore(): Promise<{
  store: ReplyFeedbackStore;
  filePath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "oktoso-reply-feedback-"));
  roots.push(root);
  const filePath = join(root, "reply-feedback.jsonl");
  const store = new ReplyFeedbackStore({ filePath, now: () => 1_000 });
  await store.init();
  return { store, filePath };
}

describe("ReplyFeedbackStore", () => {
  it("appends entries and lists them newest first", async () => {
    const { store } = await createStore();
    const first = await store.append(feedback());
    const second = await store.append(
      feedback({ sessionRef: "desktop-opencode:ses_2", note: "Second" }),
    );

    const entries = await store.list();
    expect(entries.map((entry) => entry.id)).toEqual([second.id, first.id]);
    expect(entries[0]).toMatchObject({
      sessionRef: "desktop-opencode:ses_2",
      note: "Second",
      createdAt: 1_000,
    });
    expect(entries[0]?.id).toMatch(/^rfb_/);
  });

  it("bounds the list limit and exports the raw JSONL", async () => {
    const { store } = await createStore();
    const first = await store.append(feedback());
    const second = await store.append(feedback({ note: "Second" }));

    expect(await store.list(1)).toHaveLength(1);
    const exported = await store.export();
    expect(exported).toContain(first.id);
    expect(exported).toContain(second.id);
    expect(exported.trim().split("\n")).toHaveLength(2);
  });

  it("skips a corrupt line without losing the rest", async () => {
    const { store, filePath } = await createStore();
    const saved = await store.append(feedback());
    await appendFile(filePath, "not json\n");

    const entries = await store.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.id).toBe(saved.id);
  });
});
