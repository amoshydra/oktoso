import type { Attention } from "@amoshydra/oktoso-contracts";

/**
 * Blocking items always come first. The hub sorts too, but the glass keeps its
 * own guarantee so a provider-specific list cannot push a permission or
 * question behind an unread row.
 */
export function sortAttention(items: Attention[]): Attention[] {
  return [...items].sort((left, right) => {
    const leftBlocking = left.priority === "blocking" ? 0 : 1;
    const rightBlocking = right.priority === "blocking" ? 0 : 1;
    return leftBlocking - rightBlocking;
  });
}

/**
 * The first Inbox page holds five rows, but every blocking item must remain
 * reachable. Unread rows fill the remaining slots and `More` expands the rest.
 */
export function visibleAttention(
  items: Attention[],
  expanded: boolean,
): Attention[] {
  if (expanded) return items;
  const blocking = items.filter((item) => item.priority === "blocking");
  const normal = items.filter((item) => item.priority !== "blocking");
  const limit = Math.max(5, blocking.length);
  return [...blocking, ...normal.slice(0, Math.max(0, limit - blocking.length))];
}
