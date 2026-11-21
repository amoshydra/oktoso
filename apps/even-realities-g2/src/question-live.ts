import type { Message } from "@amoshydra/oktoso-contracts";

/** Screens where a question refetch would wipe a draft or a decision. */
const DRAFT_SCREENS = new Set([
  "answer",
  "answer-type",
  "answer-confirm",
  "answer-suggestions",
  "answer-stale",
  "batch",
  "batch-review",
]);

export function holdsQuestionDraft(screen: string): boolean {
  return DRAFT_SCREENS.has(screen);
}

/**
 * A provider `question` tool call that is still open. Mirrors the hub's
 * `findToolQuestion` predicate: completed and failed calls are history.
 */
export function hasPendingQuestionTool(message: Message): boolean {
  return message.parts.some(
    (part) =>
      part.type === "tool" &&
      part.name === "question" &&
      part.status !== "completed" &&
      part.status !== "error",
  );
}

/**
 * The summary revision is the cheap signal; the full prompt is expensive
 * (a provider fetch). Refresh only when the two differ, or when there is no
 * summary to compare against.
 */
export function shouldRefreshQuestion(input: {
  summaryRevision?: string;
  currentRevision?: string;
}): boolean {
  if (!input.summaryRevision) return true;
  return input.summaryRevision !== input.currentRevision;
}
