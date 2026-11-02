import type { Message } from "@amoshydra/oktoso-contracts";

/**
 * Merge the latest hub page into a loaded transcript.
 *
 * Hub pages are already in provider display order. Open WebUI can give a
 * prompt and its reply the same second-resolution timestamp, so re-sorting
 * ties by message id moves the reply before the prompt. Keep the page order
 * instead: loaded older messages stay before the page, and held messages that
 * are newer than the page stay after it.
 */
export function mergeLatestPage(
  current: readonly Message[],
  latest: readonly Message[],
): Message[] {
  if (latest.length === 0) return [...current];
  if (current.length === 0) return [...latest];

  const latestIds = new Set(latest.map((message) => message.id));
  const oldestLatest = Math.min(
    ...latest.map((message) => message.createdAt),
  );
  const older: Message[] = [];
  const newer: Message[] = [];

  for (const message of current) {
    if (latestIds.has(message.id)) continue;
    if (message.createdAt <= oldestLatest) older.push(message);
    else newer.push(message);
  }

  return [...older, ...latest, ...newer];
}

/**
 * Apply SSE message upserts without reordering the transcript.
 *
 * Updates replace an existing message in place. A message that is not loaded
 * yet appends in event order. This is deliberately different from a page
 * merge: an SSE update for an older message must not move it to the end.
 */
export function mergeMessageUpdates(
  current: readonly Message[],
  updates: readonly Message[],
): Message[] {
  if (updates.length === 0) return [...current];

  const byId = new Map(current.map((message) => [message.id, message]));
  const order = current.map((message) => message.id);

  for (const update of updates) {
    if (!byId.has(update.id)) order.push(update.id);
    byId.set(update.id, update);
  }

  return order.map((id) => byId.get(id)!);
}
