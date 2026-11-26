import { describe, expect, it, vi } from "vitest";
import type {
  HubEvent,
  Message,
  Session,
} from "@amoshydra/oktoso-contracts";
import { MemoryStateStore } from "@amoshydra/oktoso-storage";
import type { EventBus } from "./event-bus";
import { HandoffService } from "./handoff-service";
import type { SessionActions } from "./session-actions";
import type { SessionService } from "./session-service";

const source: Session = {
  ref: "desktop-opencode:ses_source",
  providerID: "desktop-opencode",
  nativeID: "ses_source",
  title: "GPU Orchestrator",
  status: "idle",
  unread: false,
  updatedAt: 2,
  createdAt: 1,
};

const target: Session = {
  ref: "desktop-opencode:ses_target",
  providerID: "desktop-opencode",
  nativeID: "ses_target",
  title: "3D Kitchen",
  project: "atlas",
  status: "idle",
  unread: false,
  updatedAt: 2,
  createdAt: 1,
};

function setup(
  sendResult: { accepted: boolean; messageID?: string } = {
    accepted: true,
    messageID: "msg_1",
  },
  queueResult: boolean | Error = true,
) {
  const store = new MemoryStateStore();
  const send = vi.fn(async () => sendResult);
  const listeners = new Set<(event: HubEvent) => void>();
  const publish = vi.fn(
    async (
      type: HubEvent["type"],
      data: unknown,
      options: { sessionRef?: string } = {},
    ) => {
      const event: HubEvent = {
        seq: 1,
        type,
        data,
        at: 1_000,
        ...(options.sessionRef ? { sessionRef: options.sessionRef } : {}),
      };
      for (const listener of listeners) listener(event);
      return event;
    },
  );
  const emitMessage = (
    message: Message,
    type: "created" | "updated" = "created",
  ) => {
    const event: HubEvent = {
      seq: 2,
      type: type === "created" ? "message.created" : "message.updated",
      data: { message },
      at: 1_000,
      sessionRef: message.sessionRef,
    };
    for (const listener of listeners) listener(event);
  };
  const queueSynthetic = vi.fn(
    async (_ref: string, _input: Record<string, unknown>) => {
      if (queueResult instanceof Error) throw queueResult;
      return queueResult;
    },
  );
  const sessions = {
    get: vi.fn(async (ref: string) => {
      if (ref === source.ref) return source;
      if (ref === target.ref) return target;
      throw new Error("not found");
    }),
    list: vi.fn(async () => ({
      data: [source, target],
      cursor: { next: null, previous: null },
    })),
    queueSynthetic,
  } as unknown as SessionService;
  const service = new HandoffService({
    store,
    sessions,
    actions: { send } as unknown as SessionActions,
    events: {
      publish,
      subscribe: (listener: (event: HubEvent) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as EventBus,
    now: () => 1_000,
    idFactory: () => "hnd_test",
  });
  return { service, store, send, publish, queueSynthetic, emitMessage };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("timed out waiting for the handoff state");
}

describe("HandoffService", () => {
  it("creates a pending handoff with source and target metadata", async () => {
    const { service, publish } = setup();
    const handoff = await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Implement THREED_LAUNCH_OPTIONS.",
      reason: "Follow-up from the orchestrator.",
    });
    expect(handoff).toMatchObject({
      id: "hnd_test",
      sourceRef: source.ref,
      sourceTitle: "GPU Orchestrator",
      targetRef: target.ref,
      targetTitle: "3D Kitchen",
      targetProviderID: "desktop-opencode",
      targetProject: "atlas",
      status: "pending",
      message: "Implement THREED_LAUNCH_OPTIONS.",
    });
    expect(service.list({ sourceRef: source.ref })).toHaveLength(1);
    expect(publish).toHaveBeenCalledWith(
      "handoff.created",
      { handoff },
      { sessionRef: source.ref },
    );
  });

  it("resolves the source from a caller native session ID", async () => {
    const { service } = setup();
    const handoff = await service.propose({
      sourceRef: undefined,
      callerSessionId: "ses_source",
      targetRef: target.ref,
      message: "Do the follow-up.",
    });
    expect(handoff.sourceRef).toBe(source.ref);
  });

  it("rejects a self handoff", async () => {
    const { service } = setup();
    await expect(
      service.propose({
        sourceRef: source.ref,
        targetRef: source.ref,
        message: "Nope",
      }),
    ).rejects.toThrow(/cannot hand off work to itself/);
  });

  it("approves by sending once with an idempotency key", async () => {
    const { service, send, publish, queueSynthetic } = setup();
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial.",
      evidence: "queue entry 90",
    });
    const sent = await service.approve("hnd_test", "Final instruction.");
    expect(send).toHaveBeenCalledWith(
      target.ref,
      { text: "Final instruction." },
      "handoff:hnd_test",
    );
    expect(sent.status).toBe("sent");
    expect(sent.sentMessageID).toBe("msg_1");
    expect(sent.receiptQueuedAt).toBe(1_000);
    expect(queueSynthetic).toHaveBeenCalledWith(
      source.ref,
      expect.objectContaining({
        description: "Handoff sent to 3D Kitchen",
        text: expect.stringContaining("Evidence: queue entry 90"),
        metadata: expect.objectContaining({
          handoffID: "hnd_test",
          targetRef: target.ref,
          message: "Final instruction.",
          evidence: "queue entry 90",
        }),
      }),
    );
    const receipt = queueSynthetic.mock.calls[0]?.[1] as {
      text?: string;
      id?: string;
    };
    expect(receipt.text).not.toContain("Final instruction.");
    expect(receipt.id).toMatch(/^msg_handoff_/);
    expect(publish).toHaveBeenLastCalledWith(
      "handoff.updated",
      { handoff: sent },
      { sessionRef: source.ref },
    );
  });

  it("records agent provenance when the transport supplies it", async () => {
    const { service } = setup();
    const handoff = await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial.",
      createdBy: "agent",
      createdByRef: source.ref,
    });
    expect(handoff.createdBy).toBe("agent");
    expect(handoff.createdByRef).toBe(source.ref);
  });

  it("keeps a sent handoff when the receipt cannot be queued", async () => {
    const { service, queueSynthetic } = setup(
      { accepted: true, messageID: "msg_1" },
      new Error("receipt unavailable"),
    );
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial.",
    });
    const sent = await service.approve("hnd_test");
    expect(sent.status).toBe("sent");
    expect(sent.receiptQueuedAt).toBeUndefined();
    expect(queueSynthetic).toHaveBeenCalledTimes(1);
  });

  it("backfills a receipt once for a sent handoff", async () => {
    const { service, queueSynthetic } = setup(
      { accepted: true, messageID: "msg_1" },
      false,
    );
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial.",
    });
    const sent = await service.approve("hnd_test");
    expect(sent.receiptQueuedAt).toBeUndefined();

    queueSynthetic.mockResolvedValueOnce(true);
    const receipt = await service.queueReceipt("hnd_test");
    expect(receipt.receiptQueuedAt).toBe(1_000);
    expect(queueSynthetic).toHaveBeenCalledTimes(2);

    const again = await service.queueReceipt("hnd_test");
    expect(again.receiptQueuedAt).toBe(1_000);
    expect(queueSynthetic).toHaveBeenCalledTimes(2);
  });

  it("refuses a receipt before the handoff is sent", async () => {
    const { service } = setup();
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial.",
    });
    await expect(service.queueReceipt("hnd_test")).rejects.toThrow(
      /Only a sent handoff/,
    );
  });

  it("keeps a failed send editable and retryable", async () => {
    const { service, send } = setup();
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial.",
    });
    send.mockRejectedValueOnce(new Error("provider down"));
    const failed = await service.approve("hnd_test");
    expect(failed.status).toBe("failed");
    expect(failed.error).toContain("provider down");
    const updated = await service.update("hnd_test", "Retry instruction.");
    expect(updated.message).toBe("Retry instruction.");
    expect(updated.error).toBeUndefined();
  });

  it("cancels a pending handoff and refuses to send it", async () => {
    const { service, send } = setup();
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial.",
    });
    const cancelled = await service.cancel("hnd_test");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelReason).toBe("manual");
    await expect(service.approve("hnd_test")).rejects.toThrow(/cancelled/);
    expect(send).not.toHaveBeenCalled();
  });

  it("aborts a pending proposal when the source receives a user message", async () => {
    const { service, emitMessage } = setup();
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial proposal.",
    });
    emitMessage(
      {
        id: "msg_user",
        sessionRef: source.ref,
        role: "user",
        createdAt: 1_001,
        parts: [{ type: "text", text: "new direction" }],
      },
      "updated",
    );
    await waitFor(
      () =>
        service.list({ sourceRef: source.ref })[0]?.status === "cancelled",
    );
    expect(service.list({ sourceRef: source.ref })[0]?.cancelReason).toBe(
      "session-advanced",
    );
    expect(service.list({ sourceRef: source.ref })).toHaveLength(1);
  });

  it("does not abort for an update to an older user message", async () => {
    const { service, emitMessage } = setup();
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial proposal.",
    });
    emitMessage(
      {
        id: "msg_old",
        sessionRef: source.ref,
        role: "user",
        createdAt: 999,
        parts: [{ type: "text", text: "old message" }],
      },
      "updated",
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.list({ sourceRef: source.ref })[0]?.status).toBe("pending");
  });

  it("does not abort a proposal for another session or an assistant message", async () => {
    const { service, emitMessage } = setup();
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial.",
    });
    emitMessage({
      id: "msg_assistant",
      sessionRef: source.ref,
      role: "assistant",
      createdAt: 1_001,
      parts: [{ type: "text", text: "working on it" }],
    });
    emitMessage({
      id: "msg_other",
      sessionRef: "desktop-opencode:ses_other",
      role: "user",
      createdAt: 1_002,
      parts: [{ type: "text", text: "elsewhere" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.list({ sourceRef: source.ref })[0]?.status).toBe("pending");
  });

  it("leaves a sent handoff alone when the source receives a user message", async () => {
    const { service, emitMessage } = setup();
    await service.propose({
      sourceRef: source.ref,
      targetRef: target.ref,
      message: "Initial.",
    });
    await service.approve("hnd_test");
    emitMessage({
      id: "msg_user",
      sessionRef: source.ref,
      role: "user",
      createdAt: 1_001,
      parts: [{ type: "text", text: "new direction" }],
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.list({ sourceRef: source.ref })[0]?.status).toBe("sent");
  });
});
