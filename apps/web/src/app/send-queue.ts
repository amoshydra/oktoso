import type {
  Attachment,
  Message,
  SendDelivery,
} from "@amoshydra/oktoso-contracts";
import { HubError, type HubClient } from "@amoshydra/oktoso-client";
import { createOptimisticMessage, updateOptimisticStatus } from "./optimistic";

const STORAGE_KEY = "oktoso-send-queue-v1";
const CHANGED_EVENT = "oktoso:send-queue-changed";
const RESULT_EVENT = "oktoso:send-queue-result";

export interface QueuedSend {
  version: 1;
  /** The optimistic message id, reused when the transcript hydrates. */
  id: string;
  sessionRef: string;
  text: string;
  attachments: Attachment[];
  idempotencyKey: string;
  createdAt: number;
  /** Preserve the steer/queue choice across an offline replay. */
  delivery?: SendDelivery;
}

export interface QueueResult {
  idempotencyKey: string;
  status: "sent" | "failed";
  error?: string;
}

/** True when the browser reports a connection. */
export function isOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return typeof navigator.onLine === "boolean" ? navigator.onLine : true;
}

/** A transport failure that should wait for the hub instead of failing. */
export function shouldQueue(reason: unknown): boolean {
  if (!(reason instanceof HubError)) return false;
  return reason.code === "network_error" || reason.code === "timeout";
}

/** A queued item survives network, timeout, rate-limit, and 5xx failures. */
function keepQueued(reason: unknown): boolean {
  if (!(reason instanceof HubError)) return true;
  if (reason.code === "network_error" || reason.code === "timeout") return true;
  if (reason.status === 408 || reason.status === 429) return true;
  return reason.status >= 500;
}

export function listQueued(sessionRef?: string): QueuedSend[] {
  const all = read();
  return sessionRef
    ? all.filter((item) => item.sessionRef === sessionRef)
    : all;
}

export function queueLength(): number {
  return read().length;
}

export function enqueueSend(
  input: Omit<QueuedSend, "version">,
): QueuedSend {
  const current = read();
  const existing = current.find(
    (item) => item.idempotencyKey === input.idempotencyKey,
  );
  if (existing) return existing;

  const item: QueuedSend = { version: 1, ...input };
  write([...current, item]);
  return item;
}

export function removeQueued(idempotencyKey: string): boolean {
  const current = read();
  const next = current.filter(
    (item) => item.idempotencyKey !== idempotencyKey,
  );
  if (next.length === current.length) return false;
  write(next);
  return true;
}

/** Optimistic transcript rows for one session, in queue order. */
export function queuedMessages(sessionRef: string): Message[] {
  return listQueued(sessionRef)
    .sort((left, right) => left.createdAt - right.createdAt)
    .map((item) => {
      const message = updateOptimisticStatus(
        createOptimisticMessage({
          sessionRef: item.sessionRef,
          text: item.text,
          attachments: item.attachments,
          idempotencyKey: item.idempotencyKey,
        }),
        "queued",
      );
      return { ...message, id: item.id, createdAt: item.createdAt };
    });
}

export function subscribeQueue(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
  };
  window.addEventListener(CHANGED_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGED_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function subscribeQueueResults(
  listener: (result: QueueResult) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = (event: Event) => {
    listener((event as CustomEvent<QueueResult>).detail);
  };
  window.addEventListener(RESULT_EVENT, handler);
  return () => window.removeEventListener(RESULT_EVENT, handler);
}

let flushing = false;

/**
 * Send queued prompts in order. A transport failure keeps the item and stops
 * the run so order is preserved; a terminal 4xx drops it and is reported.
 */
export async function flushSendQueue(
  client: Pick<HubClient, "sendMessage">,
): Promise<void> {
  if (flushing || !isOnline()) return;

  const pending = listQueued();
  if (pending.length === 0) return;

  flushing = true;
  try {
    for (const item of pending.sort(
      (left, right) => left.createdAt - right.createdAt,
    )) {
      // The user may have discarded it while this run was waiting.
      if (!read().some((queued) => queued.idempotencyKey === item.idempotencyKey)) {
        continue;
      }

      try {
        await client.sendMessage(
          item.sessionRef,
          {
            text: item.text,
            ...(item.attachments.length > 0
              ? { attachments: item.attachments.map((attachment) => attachment.id) }
              : {}),
            ...(item.delivery ? { delivery: item.delivery } : {}),
          },
          { idempotencyKey: item.idempotencyKey },
        );
        removeQueued(item.idempotencyKey);
        notifyResult({ idempotencyKey: item.idempotencyKey, status: "sent" });
      } catch (reason) {
        if (keepQueued(reason)) break;
        removeQueued(item.idempotencyKey);
        notifyResult({
          idempotencyKey: item.idempotencyKey,
          status: "failed",
          error: reason instanceof Error ? reason.message : "Unable to send",
        });
      }
    }
  } finally {
    flushing = false;
  }
}

function read(): QueuedSend[] {
  const storage = getStorage();
  if (!storage) return [];
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedSend);
  } catch {
    return [];
  }
}

function write(items: QueuedSend[]): void {
  const storage = getStorage();
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // A full or blocked storage must not break sending.
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }
}

function notifyResult(result: QueueResult): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<QueueResult>(RESULT_EVENT, { detail: result }));
}

function getStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function isQueuedSend(value: unknown): value is QueuedSend {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    item.version === 1 &&
    typeof item.id === "string" &&
    typeof item.sessionRef === "string" &&
    typeof item.text === "string" &&
    typeof item.idempotencyKey === "string" &&
    typeof item.createdAt === "number" &&
    (item.delivery === undefined ||
      item.delivery === "steer" ||
      item.delivery === "queue") &&
    Array.isArray(item.attachments) &&
    item.attachments.every(isAttachment)
  );
}

function isAttachment(value: unknown): value is Attachment {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.mimeType === "string" &&
    typeof item.size === "number" &&
    typeof item.createdAt === "number"
  );
}
