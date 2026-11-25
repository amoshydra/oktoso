import type { Message } from "@amoshydra/oktoso-contracts";

const MAX_SESSIONS = 6;
const MAX_MESSAGES = 300;

export interface TranscriptCacheEntry {
  messages: Message[];
  olderCursor: string | null;
  savedAt: number;
}

const entries = new Map<string, TranscriptCacheEntry>();

function prune(
  messages: Message[],
  olderCursor: string | null,
): { messages: Message[]; olderCursor: string | null } {
  if (messages.length <= MAX_MESSAGES) return { messages, olderCursor };
  // The cursor belonged to the dropped front. Clearing it lets the next
  // revalidation re-anchor pagination from the latest page; loadOlder dedupes
  // by message id, so re-fetching a page is harmless.
  return { messages: messages.slice(-MAX_MESSAGES), olderCursor: null };
}

export function readTranscriptCache(
  sessionRef: string,
): TranscriptCacheEntry | undefined {
  const entry = entries.get(sessionRef);
  if (!entry) return undefined;
  entries.delete(sessionRef);
  entries.set(sessionRef, entry);
  return entry;
}

export function writeTranscriptCache(
  sessionRef: string,
  value: { messages: Message[]; olderCursor: string | null },
): void {
  const trimmed = prune(value.messages, value.olderCursor);
  entries.delete(sessionRef);
  entries.set(sessionRef, {
    messages: trimmed.messages,
    olderCursor: trimmed.olderCursor,
    savedAt: Date.now(),
  });
  while (entries.size > MAX_SESSIONS) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

export function removeTranscriptCache(sessionRef: string): void {
  entries.delete(sessionRef);
}

export function clearTranscriptCache(): void {
  entries.clear();
}
