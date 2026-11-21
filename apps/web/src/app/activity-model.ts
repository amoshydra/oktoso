import type { AssistantStep } from "@amoshydra/oktoso-contracts";
import type { ActivityStep, StepKind } from "./activity";
import type { IconName } from "./Icon";

/**
 * One activity grammar for both renderers.
 *
 * The chat derives steps from provider message parts; the assistant dock gets
 * them as hub facts. They speak the same language here, so the tile grid, the
 * counts, and the detail panel are one component with two adapters.
 */
export type ActivityKind =
  | StepKind
  | "context"
  | "history"
  | "model"
  | "tool";

export type ActivityStatus = "running" | "completed" | "error" | "cancelled";

export interface ActivityItem<T = unknown> {
  id: string;
  kind: ActivityKind;
  label: string;
  status: ActivityStatus;
  /** Short value under the icon; always paired with an exact `title`. */
  metric?: string;
  title?: string;
  durationMs?: number;
  /** One sentence of prose, when the facts need explaining. */
  detail?: string;
  /** Structured facts, rendered as rows; never parsed out of `detail`. */
  metrics?: Record<string, string | number>;
  /** Groups a step under another one, e.g. tool calls inside one model turn. */
  parentId?: string;
  /** The adapter's original record, for a richer detail panel. */
  data?: T;
}

export const ACTIVITY_ICONS: Record<ActivityKind, IconName> = {
  think: "bulb",
  shell: "terminal",
  execute: "code",
  read: "file",
  write: "file-plus",
  edit: "pencil",
  search: "search",
  fetch: "globe",
  subagent: "bot",
  image: "image",
  other: "activity",
  context: "file",
  history: "bulb",
  model: "bot",
  tool: "code",
};

export function activityStatusLabel(status: ActivityStatus): string {
  switch (status) {
    case "error":
      return "error";
    case "running":
      return "running";
    case "cancelled":
      return "cancelled";
    default:
      return "completed";
  }
}

export function durationLabel(ms: number): string {
  return ms < 1_000 ? `${ms}ms` : `${(ms / 1_000).toFixed(1)}s`;
}

/** The tile's short label: a count if the step has one, else its duration. */
function tileMetric(step: AssistantStep): string | undefined {
  const metrics = step.metrics ?? {};
  const count = (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined;
  const plural = (value: number, one: string, many: string): string =>
    `${value} ${value === 1 ? one : many}`;

  const turns = count(metrics.turns);
  if (turns !== undefined) return plural(turns, "turn", "turns");
  const sessions = count(metrics.sessions);
  if (sessions !== undefined) return plural(sessions, "session", "sessions");
  const hits = count(metrics.hits);
  if (hits !== undefined) return plural(hits, "hit", "hits");
  if (typeof metrics.compaction === "string") {
    return metrics.compaction === "none" ? "none" : "compacted";
  }
  if (typeof metrics.action === "string") return "call";
  if (step.durationMs !== undefined) return durationLabel(step.durationMs);
  return step.status === "running" ? "…" : undefined;
}

/** Hub facts → the shared view model. */
export function itemsFromAssistantSteps(
  steps: AssistantStep[],
): ActivityItem<AssistantStep>[] {
  return steps.map((step) => {
    const metric = tileMetric(step);
    return {
    id: step.id,
    kind: step.kind,
    label: step.label,
    status: step.status === "ok" ? "completed" : step.status,
    ...(metric ? { metric } : {}),
    title: step.title ?? step.detail,
    ...(step.durationMs === undefined ? {} : { durationMs: step.durationMs }),
    ...(step.detail ? { detail: step.detail } : {}),
    ...(step.metrics ? { metrics: step.metrics } : {}),
    ...(step.parentId ? { parentId: step.parentId } : {}),
    data: step,
    };
  });
}

/** Provider parts → the shared view model. */
export function itemsFromChatSteps(
  steps: ActivityStep[],
): ActivityItem<ActivityStep>[] {
  return steps.map((step) => ({
    id: step.key,
    kind: step.kind,
    label: step.label,
    status: step.status,
    ...(step.metric ? { metric: step.metric } : {}),
    ...(step.title ? { title: step.title } : {}),
    data: step,
  }));
}

export interface FlatActivityItem<T> {
  item: ActivityItem<T>;
  /** 0 for a top-level step, 1 for a step grouped under its parent. */
  depth: number;
}

/**
 * Order the grid: each parent immediately followed by its children.
 *
 * A child whose parent is missing (an evicted step, a partial stream) is
 * promoted rather than dropped, so activity is never silently lost.
 */
export function flattenActivity<T>(
  items: ActivityItem<T>[],
): FlatActivityItem<T>[] {
  const ids = new Set(items.map((item) => item.id));
  const children = new Map<string, ActivityItem<T>[]>();
  const roots: ActivityItem<T>[] = [];

  for (const item of items) {
    const parent = item.parentId;
    if (parent && parent !== item.id && ids.has(parent)) {
      const list = children.get(parent);
      if (list) list.push(item);
      else children.set(parent, [item]);
    } else {
      roots.push(item);
    }
  }

  const flat: FlatActivityItem<T>[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (seen.has(root.id)) continue;
    seen.add(root.id);
    flat.push({ item: root, depth: 0 });
    for (const child of children.get(root.id) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      flat.push({ item: child, depth: 1 });
    }
  }
  return flat;
}
