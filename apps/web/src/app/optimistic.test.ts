import { describe, expect, it } from "vitest";
import type { Attachment, Message } from "@amoshydra/oktoso-contracts";
import {
  createOptimisticMessage,
  isOptimisticMessage,
  optimisticSend,
  reconcileOptimistic,
  updateOptimisticStatus,
} from "./optimistic";

const attachment: Attachment = {
  id: "att_1",
  name: "spec.md",
  mimeType: "text/markdown",
  size: 10,
  createdAt: 1,
};

function realUser(text: string, createdAt: number): Message {
  return {
    id: "provider:message-1",
    sessionRef: "opencode:ses_a",
    role: "user",
    parts: [
      { type: "text", text },
      { type: "file", name: attachment.name, mimeType: attachment.mimeType },
    ],
    createdAt,
  };
}

describe("optimistic sending", () => {
  it("creates a local user message with a retry key", () => {
    const message = createOptimisticMessage({
      sessionRef: "opencode:ses_a",
      text: "Hello",
      attachments: [attachment],
      idempotencyKey: "key-1",
    });

    expect(isOptimisticMessage(message)).toBe(true);
    expect(message.role).toBe("user");
    expect(message.parts).toEqual([
      { type: "text", text: "Hello" },
      { type: "file", name: "spec.md", mimeType: "text/markdown" },
    ]);
    expect(optimisticSend(message)).toMatchObject({
      status: "sending",
      text: "Hello",
      attachmentIDs: ["att_1"],
      idempotencyKey: "key-1",
    });
  });

  it("tracks sent and failed states", () => {
    const message = createOptimisticMessage({
      sessionRef: "opencode:ses_a",
      text: "Hello",
      attachments: [],
      idempotencyKey: "key-1",
    });

    const failed = updateOptimisticStatus(message, "failed", "Network down");
    expect(optimisticSend(failed)).toMatchObject({
      status: "failed",
      error: "Network down",
    });
    const retried = updateOptimisticStatus(failed, "sending");
    expect(optimisticSend(retried)).toMatchObject({ status: "sending" });
    expect(optimisticSend(retried)?.error).toBeUndefined();
  });

  it("removes a matching optimistic message when the provider echoes it", () => {
    const optimistic = createOptimisticMessage({
      sessionRef: "opencode:ses_a",
      text: "Hello",
      attachments: [attachment],
      idempotencyKey: "key-1",
    });
    const incoming = realUser("Hello", optimistic.createdAt + 1_000);

    expect(reconcileOptimistic([optimistic], [incoming])).toEqual([]);
  });

  it("keeps unmatched or different optimistic messages", () => {
    const optimistic = createOptimisticMessage({
      sessionRef: "opencode:ses_a",
      text: "Hello",
      attachments: [],
      idempotencyKey: "key-1",
    });
    const different = realUser("Something else", optimistic.createdAt);
    const old = realUser("Hello", optimistic.createdAt - 10 * 60_000);

    expect(reconcileOptimistic([optimistic], [different])).toEqual([optimistic]);
    expect(reconcileOptimistic([optimistic], [old])).toEqual([optimistic]);
  });

  it("ignores ordinary provider messages", () => {
    const message = realUser("Hello", 1);
    expect(isOptimisticMessage(message)).toBe(false);
    expect(optimisticSend(message)).toBeUndefined();
    expect(updateOptimisticStatus(message, "failed")).toBe(message);
  });
});
