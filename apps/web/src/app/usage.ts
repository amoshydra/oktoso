import type { Session } from "@amoshydra/oktoso-contracts";

export type UsageGroup = "provider" | "project" | "model" | "day";

export interface UsageRow {
  key: string;
  label: string;
  sessions: number;
  /** Sum of reported tokens. Null when nothing was reported. */
  tokens: number | null;
  /** Sum of reported cost. Null when nothing was reported. */
  cost: number | null;
  /** Sessions contributing to each figure, for the "N did not report" note. */
  tokensReportedBy: number;
  costReportedBy: number;
}

export interface UsageReport {
  rows: UsageRow[];
  sessions: number;
  tokens: number | null;
  cost: number | null;
  missingTokens: number;
  missingCost: number;
}

const DAY = 24 * 60 * 60 * 1_000;

/**
 * Rolls sessions up for the Overview usage report.
 *
 * Tokens prefer the provider's own total (OpenCode already folds reasoning in)
 * and fall back to input + output. A session that reports nothing contributes
 * to the session count but not to the figures, so unreported data stays visibly
 * missing instead of reading as zero.
 */
export function buildUsageReport(
  sessions: Session[],
  group: UsageGroup,
): UsageReport {
  const rows = new Map<string, UsageRow>();
  let tokens = 0;
  let cost = 0;
  let reportedTokens = 0;
  let reportedCost = 0;

  for (const session of sessions) {
    const { key, label } = groupKey(session, group);
    const row = rows.get(key) ?? {
      key,
      label,
      sessions: 0,
      tokens: null,
      cost: null,
      tokensReportedBy: 0,
      costReportedBy: 0,
    };
    row.sessions += 1;

    const sessionTokens = tokenTotal(session);
    if (sessionTokens !== null) {
      row.tokens = (row.tokens ?? 0) + sessionTokens;
      row.tokensReportedBy += 1;
      tokens += sessionTokens;
      reportedTokens += 1;
    }
    if (session.cost !== undefined) {
      row.cost = (row.cost ?? 0) + session.cost;
      row.costReportedBy += 1;
      cost += session.cost;
      reportedCost += 1;
    }
    rows.set(key, row);
  }

  const sorted = [...rows.values()].sort(
    (left, right) =>
      (right.cost ?? -1) - (left.cost ?? -1) ||
      (right.tokens ?? -1) - (left.tokens ?? -1) ||
      right.sessions - left.sessions ||
      left.label.localeCompare(right.label),
  );

  return {
    rows: sorted,
    sessions: sessions.length,
    tokens: reportedTokens > 0 ? tokens : null,
    cost: reportedCost > 0 ? cost : null,
    missingTokens: sessions.length - reportedTokens,
    missingCost: sessions.length - reportedCost,
  };
}

function groupKey(
  session: Session,
  group: UsageGroup,
): { key: string; label: string } {
  switch (group) {
    case "provider":
      return { key: session.providerID, label: providerName(session.providerID) };
    case "project":
      return session.project
        ? { key: session.project, label: session.project }
        : { key: "\u0000none", label: "No project" };
    case "model":
      return session.model
        ? { key: session.model, label: session.model }
        : { key: "\u0000none", label: "No model" };
    case "day": {
      const date = new Date(session.updatedAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const today = new Date();
      const yesterday = new Date(today.getTime() - DAY);
      const sameDay = (other: Date) =>
        other.getFullYear() === date.getFullYear() &&
        other.getMonth() === date.getMonth() &&
        other.getDate() === date.getDate();
      const label = sameDay(today)
        ? "Today"
        : sameDay(yesterday)
          ? "Yesterday"
          : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      return { key, label };
    }
  }
}

export function tokenTotal(session: Session): number | null {
  const tokens = session.tokens;
  if (!tokens) return null;
  if (tokens.total !== undefined) return tokens.total;
  if (tokens.input === undefined && tokens.output === undefined) return null;
  return (tokens.input ?? 0) + (tokens.output ?? 0);
}

export function providerName(providerID: string): string {
  if (providerID.includes("opencode")) return "OpenCode";
  if (providerID.includes("openwebui")) return "Open WebUI";
  if (providerID.includes("hermes")) return "Hermes";
  return providerID;
}
