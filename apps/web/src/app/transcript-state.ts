export type TranscriptPhase =
  | "ready"
  | "loading"
  | "error"
  | "waiting"
  | "empty";

/**
 * What the transcript body should show.
 *
 * Count wins first so queued or optimistic rows are never replaced by a
 * skeleton. An error never falls through to the empty state: "No messages yet"
 * claims the transcript is complete, which a failed load cannot know. A running
 * session with an empty page is waiting on the agent, not empty.
 */
export function transcriptPhase(input: {
  loading: boolean;
  error: string | undefined;
  messageCount: number;
  running: boolean;
}): TranscriptPhase {
  if (input.messageCount > 0) return "ready";
  if (input.error) return "error";
  if (input.loading) return "loading";
  if (input.running) return "waiting";
  return "empty";
}
