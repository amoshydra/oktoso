import type { Session } from "@amoshydra/oktoso-contracts";

/** The glasses fit five session rows; older sessions live on the next page. */
export const SESSIONS_PER_PAGE = 5;

export interface SessionListPage {
  /** Sessions on the requested page, in list order. */
  sessions: Session[];
  /** Zero-based page, clamped to the available range. */
  page: number;
  /** Pages in the loaded window; the hub cursor can extend it. */
  pages: number;
  /** Another page exists in the window, or the hub has an older cursor. */
  hasMore: boolean;
}

/**
 * Slice the loaded window into glasses-sized pages.
 *
 * The hub returns sessions newest first and a cursor for older ones, so the
 * window can grow without refetching earlier pages.
 */
export function sessionListPage(
  sessions: Session[],
  page: number,
  hasCursor: boolean,
  perPage: number = SESSIONS_PER_PAGE,
): SessionListPage {
  const size = Math.max(1, Math.floor(perPage));
  const pages = Math.max(1, Math.ceil(sessions.length / size));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const start = current * size;
  return {
    sessions: sessions.slice(start, start + size),
    page: current,
    pages,
    hasMore:
      sessions.length > 0 && (current < pages - 1 || hasCursor),
  };
}
