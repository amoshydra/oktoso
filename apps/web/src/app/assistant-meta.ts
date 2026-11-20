import type { AssistantTurn } from "@amoshydra/oktoso-contracts";

export function startOfDay(ts: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dayLabel(ts: number): string {
  const day = startOfDay(ts);
  const today = startOfDay(Date.now());
  if (day === today) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === yesterday.getTime()) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The session's last activity, not the answer time. */
export function asOfLabel(ts: number): string {
  if (startOfDay(ts) === startOfDay(Date.now())) return timeLabel(ts);
  return `${new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} ${timeLabel(ts)}`;
}

/**
 * A compaction is dated, not timed: only one from today earns a clock time.
 * Same branch as the session stamp so the two clauses read alike.
 */
export function historyLabel(ts: number): string {
  if (startOfDay(ts) === startOfDay(Date.now())) return timeLabel(ts);
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** One evidence line: what the answer read, and how stale it is. */
export function turnMetaParts(turn: AssistantTurn): string[] {
  const parts: string[] = [];
  if (turn.context) {
    const { messages, omitted, attention, asOf, failures, historyAt } =
      turn.context;
    if (messages !== undefined) {
      parts.push(`Read ${messages} ${messages === 1 ? "turn" : "turns"}`);
    }
    if (omitted !== undefined && omitted > 0) {
      parts.push(`${omitted} older omitted`);
    }
    if (failures !== undefined && failures > 0) {
      parts.push(`${failures} ${failures === 1 ? "failure" : "failures"}`);
    }
    if (asOf !== undefined) {
      parts.push(`session as of ${asOfLabel(asOf)}`);
    }
    if (historyAt !== undefined) {
      parts.push(`history ${historyLabel(historyAt)}`);
    }
    if (attention !== undefined && attention > 0) {
      parts.push(`${attention} attention ${attention === 1 ? "item" : "items"}`);
    }
  }
  if (turn.usage) {
    parts.push(
      `${turn.usage.promptTokens} in · ${turn.usage.completionTokens} out`,
    );
  }
  return parts;
}
