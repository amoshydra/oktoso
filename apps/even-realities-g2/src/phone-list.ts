import { clampLine } from "@amoshydra/oktoso-wearable-core";

/**
 * Lines the 204px body container fits at G2 type size.
 *
 * The chat viewport uses the same six lines. A body that stays at or under this
 * limit has no overflow for the host to scroll, so a swipe only moves the
 * app-owned marker.
 */
export const MIRROR_LINES = 6;

/** The list page's summary container fits two lines. */
export const MIRROR_SUMMARY_LINES = 2;

export interface PhoneListBody {
  body: string;
  start: number;
  visible: number;
}

/**
 * Keep a list window stable while the cursor moves inside it.
 *
 * The glasses list should not scroll on every up/down. The selected row moves
 * within the visible window; the window shifts by one only when the cursor
 * crosses the top or bottom edge.
 */
export function phoneListWindow(
  cursor: number,
  total: number,
  visible: number,
  start: number,
): number {
  if (total <= 0) return 0;
  const size = Math.max(1, Math.min(visible, total));
  const maxStart = Math.max(0, total - size);
  const position = Math.max(0, Math.min(cursor, total - 1));
  let next = Math.max(0, Math.min(start, maxStart));
  if (position < next) next = position;
  else if (position >= next + size) next = position - size + 1;
  return Math.max(0, Math.min(next, maxStart));
}

/**
 * Build the body of an app-owned list page.
 *
 * The summary keeps the list page's two-line budget and the rows take the rest,
 * so the body never grows past `MIRROR_LINES`. Every row is clamped to 52
 * characters because the two-character marker prefix fills the 54-column line.
 */
export function phoneListBody(
  summary: string,
  items: string[],
  cursor: number,
  start: number,
): PhoneListBody {
  const summaryLines = summary
    .split("\n")
    .slice(0, MIRROR_SUMMARY_LINES)
    .map((line) => clampLine(line, 54));
  while (
    summaryLines.length > 0 &&
    summaryLines[summaryLines.length - 1] === ""
  ) {
    summaryLines.pop();
  }

  const visible = Math.max(1, MIRROR_LINES - summaryLines.length);
  const nextStart = phoneListWindow(cursor, items.length, visible, start);
  const rows = items
    .slice(nextStart, nextStart + visible)
    .map((item, offset) => {
      const marker = nextStart + offset === cursor ? "›" : " ";
      return `${marker} ${clampLine(item, 52)}`;
    });

  return {
    body: [...summaryLines, ...rows].join("\n"),
    start: nextStart,
    visible,
  };
}
