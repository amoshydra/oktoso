import type { Attachment, Message, MessagePart } from "@amoshydra/oktoso-contracts";
import { createID } from "./ids";

export type OptimisticSendStatus = "sending" | "sent" | "failed";

export interface OptimisticSend {
  status: OptimisticSendStatus;
  text: string;
  attachmentIDs: string[];
  idempotencyKey: string;
  error?: string;
}

const OPTIMISTIC_PREFIX = "local:";

export function isOptimisticMessage(message: Message): boolean {
  return message.id.startsWith(OPTIMISTIC_PREFIX);
}

export function optimisticSend(message: Message): OptimisticSend | undefined {
  const value = message.metadata?.optimistic;
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    (record.status !== "sending" &&
      record.status !== "sent" &&
      record.status !== "failed") ||
    typeof record.text !== "string" ||
    !Array.isArray(record.attachmentIDs) ||
    typeof record.idempotencyKey !== "string"
  ) {
    return undefined;
  }
  return {
    status: record.status,
    text: record.text,
    attachmentIDs: record.attachmentIDs.filter(
      (id): id is string => typeof id === "string",
    ),
    idempotencyKey: record.idempotencyKey,
    ...(typeof record.error === "string" ? { error: record.error } : {}),
  };
}

export function createOptimisticMessage(input: {
  sessionRef: string;
  text: string;
  attachments: Attachment[];
  idempotencyKey: string;
}): Message {
  const parts: MessagePart[] = [];
  if (input.text) parts.push({ type: "text", text: input.text });
  for (const attachment of input.attachments) {
    parts.push({
      type: "file",
      name: attachment.name,
      mimeType: attachment.mimeType,
    });
  }
  const send: OptimisticSend = {
    status: "sending",
    text: input.text,
    attachmentIDs: input.attachments.map((attachment) => attachment.id),
    idempotencyKey: input.idempotencyKey,
  };
  return {
    id: `${OPTIMISTIC_PREFIX}${createID()}`,
    sessionRef: input.sessionRef,
    role: "user",
    parts,
    createdAt: Date.now(),
    metadata: { optimistic: send },
  };
}

export function updateOptimisticStatus(
  message: Message,
  status: OptimisticSendStatus,
  error?: string,
): Message {
  const current = optimisticSend(message);
  if (!current) return message;
  return {
    ...message,
    metadata: {
      ...message.metadata,
      optimistic: {
        ...current,
        status,
        ...(error ? { error } : { error: undefined }),
      },
    },
  };
}

/**
 * Remove optimistic user messages once the provider echoes the real message.
 * Match on role, text, and file names to avoid removing a different send.
 */
export function reconcileOptimistic(
  current: readonly Message[],
  incoming: readonly Message[],
): Message[] {
  const optimistic = current.filter(isOptimisticMessage);
  if (optimistic.length === 0) return [...current];

  const realUsers = incoming.filter((message) => message.role === "user");
  if (realUsers.length === 0) return [...current];

  const matched = new Set<string>();
  for (const real of realUsers) {
    const candidate = optimistic.find(
      (message) =>
        !matched.has(message.id) &&
        Math.abs(real.createdAt - message.createdAt) <= 5 * 60_000 &&
        sameContent(message, real),
    );
    if (candidate) matched.add(candidate.id);
  }
  if (matched.size === 0) return [...current];
  return current.filter((message) => !matched.has(message.id));
}

function sameContent(left: Message, right: Message): boolean {
  return (
    textOf(left) === textOf(right) &&
    JSON.stringify(fileNames(left)) === JSON.stringify(fileNames(right))
  );
}

function textOf(message: Message): string {
  return message.parts
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n\n")
    .trim();
}

function fileNames(message: Message): string[] {
  return message.parts
    .flatMap((part) => (part.type === "file" ? [part.name] : []))
    .sort();
}
