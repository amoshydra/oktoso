import { createHash, randomUUID } from "node:crypto";
import type {
  Handoff,
  HandoffStatus,
  Message,
} from "@amoshydra/oktoso-contracts";
import type { StateStore } from "@amoshydra/oktoso-storage";
import { badRequest, conflict, notFound, notImplemented } from "../domain/errors";
import type { EventBus } from "./event-bus";
import type { SessionActions } from "./session-actions";
import type { SessionService } from "./session-service";

const MAX_PENDING_PER_SOURCE = 3;

export interface HandoffServiceOptions {
  store: StateStore;
  sessions: SessionService;
  actions: SessionActions;
  events: EventBus;
  now?: () => number;
  idFactory?: () => string;
}

export interface ProposeHandoffInput {
  sourceRef?: string;
  targetRef: string;
  message: string;
  reason?: string;
  /** Compact evidence reference: queue entry, log line, commit, or run. */
  evidence?: string;
  /** The calling agent's native session ID, when the transport knows it. */
  callerSessionId?: string;
  /** Provenance from the calling surface; defaults from the caller hint. */
  createdBy?: "agent" | "owner";
  /** The caller's resolved session ref, when known. */
  createdByRef?: string;
}

function matchesSession(
  session: { ref: string; nativeID: string },
  value: string,
): boolean {
  return (
    session.ref === value ||
    session.nativeID === value ||
    session.ref.endsWith(`:${value}`)
  );
}

function shortLabel(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Build the provider-visible receipt that is queued for the source session.
 *
 * The model-visible text is deliberately compact: the source agent already
 * accepted the handoff and does not need the full instruction repeated in its
 * context. The full payload stays in metadata for audit and rehydration.
 */
function syntheticReceipt(handoff: Handoff, at: number) {
  const timestamp = new Date(at).toISOString();
  return {
    id: `msg_handoff_${createHash("sha256")
      .update(handoff.id)
      .digest("hex")
      .slice(0, 24)}`,
    description: shortLabel(`Handoff sent to ${handoff.targetTitle}`, 120),
    text: [
      `Handoff receipt: the owner sent a handoff from this session to "${handoff.targetTitle}" (${handoff.targetRef}) at ${timestamp}.`,
      "No action is required.",
      ...(handoff.evidence ? [`Evidence: ${handoff.evidence}`] : []),
    ].join("\n\n"),
    metadata: {
      handoffID: handoff.id,
      sourceRef: handoff.sourceRef,
      targetRef: handoff.targetRef,
      targetTitle: handoff.targetTitle,
      message: handoff.message,
      ...(handoff.reason ? { reason: handoff.reason } : {}),
      ...(handoff.evidence ? { evidence: handoff.evidence } : {}),
      ...(handoff.createdBy ? { createdBy: handoff.createdBy } : {}),
      ...(handoff.createdByRef ? { createdByRef: handoff.createdByRef } : {}),
      sentAt: at,
    },
  };
}

/**
 * Cross-session work handoffs.
 *
 * An agent proposes; the hub stores a pending card in the source session. The
 * owner edits/approves in that chat, and only then does the hub call the normal
 * send path with an idempotency key. Proposal alone never messages the target.
 */
export class HandoffService {
  private readonly now: () => number;
  private readonly idFactory: () => string;

  constructor(private readonly options: HandoffServiceOptions) {
    this.now = options.now ?? Date.now;
    this.idFactory = options.idFactory ?? (() => `hnd_${randomUUID()}`);
    options.events.subscribe((event) => {
      if (
        event.type !== "message.created" &&
        event.type !== "message.updated"
      ) {
        return;
      }
      const message = (event.data as { message?: Message } | undefined)?.message;
      if (!message || message.role !== "user") return;
      const sourceRef = event.sessionRef ?? message.sessionRef;
      if (!sourceRef) return;
      // A new user message means the conversation moved on. Pending proposals
      // are stale; abort them instead of leaving an action at the bottom.
      // Updates to an older user message must not abort a newer proposal, so
      // an update only cancels proposals created at or before that message.
      void this.cancelPendingForSource(
        sourceRef,
        event.type === "message.updated"
          ? { createdBefore: message.createdAt }
          : {},
      ).catch(() => undefined);
    });
  }

  async propose(input: ProposeHandoffInput): Promise<Handoff> {
    const message = input.message.trim();
    if (!message) throw badRequest("A handoff message is required");
    const source = await this.resolveSource(
      input.sourceRef,
      input.callerSessionId,
    );
    const target = await this.options.sessions.get(input.targetRef);
    if (source.ref === target.ref) {
      throw badRequest("A session cannot hand off work to itself");
    }

    const createdBy =
      input.createdBy ?? (input.callerSessionId ? "agent" : "owner");
    const createdByRef =
      input.createdByRef ?? (createdBy === "agent" ? source.ref : undefined);
    const handoff: Handoff = {
      id: this.idFactory(),
      sourceRef: source.ref,
      sourceTitle: source.title,
      targetRef: target.ref,
      targetTitle: target.title,
      targetProviderID: target.providerID,
      ...(target.project ? { targetProject: target.project } : {}),
      message,
      ...(input.reason ? { reason: input.reason.trim() } : {}),
      ...(input.evidence ? { evidence: input.evidence.trim() } : {}),
      status: "pending",
      createdAt: this.now(),
      updatedAt: this.now(),
      createdBy,
      ...(createdByRef ? { createdByRef } : {}),
    };

    await this.options.store.update((state) => {
      const pending = state.handoffs.filter(
        (entry) =>
          entry.sourceRef === handoff.sourceRef && entry.status === "pending",
      );
      if (pending.length >= MAX_PENDING_PER_SOURCE) {
        throw conflict(
          `This session already has ${MAX_PENDING_PER_SOURCE} pending handoffs`,
        );
      }
      state.handoffs.unshift(handoff);
      state.handoffs = state.handoffs.slice(0, 100);
    });
    await this.publish("handoff.created", handoff);
    return handoff;
  }

  list(query: { sourceRef?: string; status?: HandoffStatus } = {}): Handoff[] {
    return this.options.store
      .getState()
      .handoffs.filter(
        (handoff) =>
          (!query.sourceRef || handoff.sourceRef === query.sourceRef) &&
          (!query.status || handoff.status === query.status),
      )
      .sort((left, right) => right.createdAt - left.createdAt);
  }

  get(id: string): Handoff | undefined {
    return this.options.store
      .getState()
      .handoffs.find((handoff) => handoff.id === id);
  }

  async update(id: string, message: string): Promise<Handoff> {
    const trimmed = message.trim();
    if (!trimmed) throw badRequest("A handoff message is required");
    const handoff = await this.mutate(id, (entry) => {
      if (entry.status !== "pending" && entry.status !== "failed") {
        throw conflict("Only a pending or failed handoff can be edited");
      }
      entry.message = trimmed;
      entry.error = undefined;
      entry.updatedAt = this.now();
    });
    await this.publish("handoff.updated", handoff);
    return handoff;
  }

  async cancel(
    id: string,
    reason: "manual" | "session-advanced" = "manual",
  ): Promise<Handoff> {
    const handoff = await this.mutate(id, (entry) => {
      if (entry.status === "sent" || entry.status === "cancelled") {
        throw conflict("This handoff is already closed");
      }
      entry.status = "cancelled";
      entry.cancelReason = reason;
      entry.updatedAt = this.now();
    });
    await this.publish("handoff.updated", handoff);
    return handoff;
  }

  /**
   * Abort open proposals for a source session.
   *
   * Called when the session receives a new user message: the conversation has
   * moved on, so a pending card must not remain as a stale action. Failed
   * handoffs are left alone because they are already a record with an explicit
   * Retry path; sending is never in flight here.
   */
  async cancelPendingForSource(
    sourceRef: string,
    options: { createdBefore?: number } = {},
  ): Promise<Handoff[]> {
    const pending = this.list({ sourceRef, status: "pending" }).filter(
      (handoff) =>
        options.createdBefore === undefined ||
        handoff.createdAt <= options.createdBefore,
    );
    const cancelled: Handoff[] = [];
    for (const handoff of pending) {
      try {
        cancelled.push(await this.cancel(handoff.id, "session-advanced"));
      } catch {
        // A concurrent decision may have moved it; leave that outcome alone.
      }
    }
    return cancelled;
  }

  async approve(id: string, message?: string): Promise<Handoff> {
    const existing = this.get(id);
    if (!existing) throw notFound("Handoff not found");
    if (existing.status === "sent") return existing;
    if (existing.status === "cancelled") {
      throw conflict("This handoff was cancelled");
    }
    if (existing.status === "sending") {
      throw conflict("This handoff is already being sent");
    }

    const text = (message ?? existing.message).trim();
    if (!text) throw badRequest("A handoff message is required");
    const sending = await this.mutate(id, (entry) => {
      entry.message = text;
      entry.status = "sending";
      entry.error = undefined;
      entry.updatedAt = this.now();
    });
    await this.publish("handoff.updated", sending);

    try {
      const result = await this.options.actions.send(
        sending.targetRef,
        { text: sending.message },
        `handoff:${sending.id}`,
      );
      if (!result.accepted) {
        throw new Error("The target session did not accept the handoff");
      }
      const sentAt = this.now();
      // Best effort: the handoff is already sent. A provider without synthetic
      // notices, or a transient failure, must not turn the send into a failure.
      const receiptQueued = await this.queueSyntheticReceipt(
        sending,
        sentAt,
      ).catch(() => false);
      return await this.mutate(id, (entry) => {
        entry.status = "sent";
        entry.sentAt = sentAt;
        entry.updatedAt = sentAt;
        if (result.messageID) entry.sentMessageID = result.messageID;
        if (receiptQueued) entry.receiptQueuedAt = sentAt;
      }).then(async (handoff) => {
        await this.publish("handoff.updated", handoff);
        return handoff;
      });
    } catch (reason) {
      const failed = await this.mutate(id, (entry) => {
        entry.status = "failed";
        entry.error =
          reason instanceof Error ? reason.message : String(reason);
        entry.updatedAt = this.now();
      });
      await this.publish("handoff.updated", failed);
      return failed;
    }
  }

  /**
   * Queue the provider-visible receipt for an already-sent handoff.
   *
   * Sending does this best-effort; this method also backs the manual/backfill
   * endpoint. The synthetic message ID is deterministic, so a retry does not
   * add a second notice.
   */
  async queueReceipt(id: string): Promise<Handoff> {
    const existing = this.get(id);
    if (!existing) throw notFound("Handoff not found");
    if (existing.status !== "sent") {
      throw conflict("Only a sent handoff can queue a receipt");
    }
    if (existing.receiptQueuedAt) return existing;
    const queued = await this.queueSyntheticReceipt(
      existing,
      existing.sentAt ?? this.now(),
    );
    if (!queued) {
      throw notImplemented("This provider does not expose synthetic notices");
    }
    const handoff = await this.mutate(id, (entry) => {
      entry.receiptQueuedAt = this.now();
      entry.updatedAt = this.now();
    });
    await this.publish("handoff.updated", handoff);
    return handoff;
  }

  private async queueSyntheticReceipt(
    handoff: Handoff,
    at: number,
  ): Promise<boolean> {
    return this.options.sessions.queueSynthetic(
      handoff.sourceRef,
      syntheticReceipt(handoff, at),
    );
  }

  private async resolveSource(
    sourceRef?: string,
    callerSessionId?: string,
  ) {
    const candidates = [sourceRef, callerSessionId].filter(
      (value): value is string => Boolean(value),
    );
    if (candidates.length === 0) {
      throw badRequest("A source session is required");
    }
    for (const candidate of candidates) {
      try {
        return await this.options.sessions.get(candidate);
      } catch {
        // Fall through to the session search by native ID.
      }
      const page = await this.options.sessions.list({
        q: candidate,
        limit: 50,
      });
      const found = page.data.find((session) =>
        matchesSession(session, candidate),
      );
      if (found) return found;
    }
    throw notFound("Source session not found");
  }

  private async mutate(
    id: string,
    mutator: (handoff: Handoff) => void,
  ): Promise<Handoff> {
    let result: Handoff | undefined;
    await this.options.store.update((state) => {
      const handoff = state.handoffs.find((entry) => entry.id === id);
      if (!handoff) return;
      mutator(handoff);
      result = { ...handoff };
    });
    if (!result) throw notFound("Handoff not found");
    return result;
  }

  private async publish(type: "handoff.created" | "handoff.updated", handoff: Handoff) {
    await this.options.events
      .publish(type, { handoff }, { sessionRef: handoff.sourceRef })
      .catch(() => undefined);
  }
}
