/**
 * Keep a list window stable while the cursor moves inside it.
 *
 * The glasses mirror should not scroll on every up/down. The selected row moves
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
