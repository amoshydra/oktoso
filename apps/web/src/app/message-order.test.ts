import { describe, expect, it } from "vitest";
import type { Message } from "@amoshydra/oktoso-contracts";
import { mergeLatestPage, mergeMessageUpdates } from "./message-order";

const NOW = 1_800_000_000_000;

function message(
  id: string,
  role: Message["role"],
  createdAt: number,
  text = id,
): Message {
  return {
    id,
    sessionRef: "openwebui:chat_1",
    role,
    parts: [{ type: "text", text }],
    createdAt,
  };
}

function ids(messages: readonly Message[]): string[] {
  return messages.map((entry) => entry.id);
}

describe("mergeLatestPage", () => {
  it("keeps the provider order for same-timestamp prompt and reply", () => {
    // The ids are deliberately reversed: sorting by id would put the reply
    // before the prompt, which is the Open WebUI regression.
    const prompt = message("zz-prompt", "user", NOW, "Prompt");
    const reply = message("aa-reply", "assistant", NOW, "Reply");

    expect(ids(mergeLatestPage([], [prompt, reply]))).toEqual([
      "zz-prompt",
      "aa-reply",
    ]);
  });

  it("keeps loaded older messages before the latest page", () => {
    const older = message("older", "user", NOW - 10_000);
    const prompt = message("prompt", "user", NOW);
    const reply = message("reply", "assistant", NOW);

    expect(ids(mergeLatestPage([older, prompt], [prompt, reply]))).toEqual([
      "older",
      "prompt",
      "reply",
    ]);
  });

  it("keeps held newer messages after the latest page", () => {
    const older = message("older", "user", NOW - 10_000);
    const held = message("held", "assistant", NOW + 10_000);
    const prompt = message("prompt", "user", NOW);
    const reply = message("reply", "assistant", NOW);

    expect(ids(mergeLatestPage([older, held], [prompt, reply]))).toEqual([
      "older",
      "prompt",
      "reply",
      "held",
    ]);
  });

  it("replaces overlapping messages without duplicating them", () => {
    const prompt = message("prompt", "user", NOW, "Old prompt");
    const reply = message("reply", "assistant", NOW, "Old reply");
    const updatedPrompt = message("prompt", "user", NOW, "New prompt");
    const updatedReply = message("reply", "assistant", NOW, "New reply");

    const merged = mergeLatestPage(
      [prompt, reply],
      [updatedPrompt, updatedReply],
    );

    expect(ids(merged)).toEqual(["prompt", "reply"]);
    expect(merged[0]?.parts).toEqual([{ type: "text", text: "New prompt" }]);
    expect(merged[1]?.parts).toEqual([{ type: "text", text: "New reply" }]);
  });

  it("returns the current transcript when the page is empty", () => {
    const current = [message("a", "user", NOW)];
    expect(mergeLatestPage(current, [])).toEqual(current);
  });

  it("returns the page when the transcript is empty", () => {
    const latest = [message("a", "user", NOW)];
    expect(mergeLatestPage([], latest)).toEqual(latest);
  });
});

describe("mergeMessageUpdates", () => {
  it("replaces an existing message in place", () => {
    const first = message("a", "user", NOW, "A");
    const second = message("b", "assistant", NOW, "B");
    const third = message("c", "user", NOW + 1, "C");
    const updatedSecond = message("b", "assistant", NOW, "B updated");

    const merged = mergeMessageUpdates(
      [first, second, third],
      [updatedSecond],
    );

    expect(ids(merged)).toEqual(["a", "b", "c"]);
    expect(merged[1]?.parts).toEqual([
      { type: "text", text: "B updated" },
    ]);
  });

  it("appends new messages in event order", () => {
    const first = message("a", "user", NOW);
    const second = message("b", "assistant", NOW);
    const third = message("c", "user", NOW + 1);
    const fourth = message("d", "assistant", NOW + 1);

    expect(
      ids(mergeMessageUpdates([first, second], [third, fourth])),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("updates one message and appends another", () => {
    const first = message("a", "user", NOW);
    const second = message("b", "assistant", NOW, "B");
    const updatedSecond = message("b", "assistant", NOW, "B updated");
    const third = message("c", "user", NOW + 1);

    const merged = mergeMessageUpdates(
      [first, second],
      [updatedSecond, third],
    );

    expect(ids(merged)).toEqual(["a", "b", "c"]);
    expect(merged[1]?.parts).toEqual([
      { type: "text", text: "B updated" },
    ]);
  });

  it("does not reorder existing same-timestamp messages", () => {
    const prompt = message("zz-prompt", "user", NOW, "Prompt");
    const reply = message("aa-reply", "assistant", NOW, "Reply");
    const updatedReply = message("aa-reply", "assistant", NOW, "Reply updated");
    const updatedPrompt = message("zz-prompt", "user", NOW, "Prompt updated");

    const merged = mergeMessageUpdates(
      [prompt, reply],
      [updatedReply, updatedPrompt],
    );

    expect(ids(merged)).toEqual(["zz-prompt", "aa-reply"]);
    expect(merged[0]?.parts).toEqual([
      { type: "text", text: "Prompt updated" },
    ]);
    expect(merged[1]?.parts).toEqual([
      { type: "text", text: "Reply updated" },
    ]);
  });

  it("returns the current transcript when there are no updates", () => {
    const current = [message("a", "user", NOW)];
    expect(mergeMessageUpdates(current, [])).toEqual(current);
  });
});
