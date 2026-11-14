import type { Session } from "@amoshydra/oktoso-contracts";

export interface SessionTreeNode {
  session: Session;
  children: SessionTreeNode[];
  /** The newest update in this branch, including descendants. */
  latestAt: number;
}

export interface SessionTree {
  nodes: SessionTreeNode[];
  /** Subagents whose parent is not in the loaded page. */
  orphans: Session[];
  /** Every loaded session that has a parent. */
  childCount: number;
}

/**
 * Build a parent/child tree from the flat session list.
 *
 * Rows are ordered newest first. A parent is ordered by the newest update in
 * its branch, so a running subagent lifts its parent instead of leaving it
 * buried under older sessions.
 */
export function buildSessionTree(sessions: Session[]): SessionTree {
  const byRef = new Map(sessions.map((session) => [session.ref, session]));
  const children = new Map<string, Session[]>();
  for (const session of sessions) {
    if (!session.parentRef || !byRef.has(session.parentRef)) continue;
    const list = children.get(session.parentRef) ?? [];
    list.push(session);
    children.set(session.parentRef, list);
  }

  const seen = new Set<string>();
  const build = (session: Session, depth: number): SessionTreeNode => {
    seen.add(session.ref);
    const kids =
      depth >= 4
        ? []
        : (children.get(session.ref) ?? [])
            .filter((child) => !seen.has(child.ref))
            .sort((left, right) => right.updatedAt - left.updatedAt)
            .map((child) => build(child, depth + 1));
    return {
      session,
      children: kids,
      latestAt: Math.max(
        session.updatedAt,
        ...kids.map((child) => child.latestAt),
      ),
    };
  };

  const nodes = sessions
    .filter((session) => !session.parentRef)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map((session) => build(session, 0))
    .sort((left, right) => right.latestAt - left.latestAt);

  const orphans = sessions
    .filter(
      (session) =>
        session.parentRef && !byRef.has(session.parentRef) && !seen.has(session.ref),
    )
    .sort((left, right) => right.updatedAt - left.updatedAt);

  return {
    nodes,
    orphans,
    childCount: sessions.filter((session) => Boolean(session.parentRef)).length,
  };
}

/**
 * Keep a root when it or any descendant matches. A parent that only matches
 * through a child is kept as context, with only the matching children.
 */
export function filterSessionTree(
  nodes: SessionTreeNode[],
  matches: (session: Session) => boolean,
): SessionTreeNode[] {
  const result: SessionTreeNode[] = [];
  for (const node of nodes) {
    const children = filterSessionTree(node.children, matches);
    if (!matches(node.session) && children.length === 0) continue;
    result.push({
      ...node,
      children,
      latestAt: Math.max(
        node.session.updatedAt,
        ...children.map((child) => child.latestAt),
      ),
    });
  }
  return result;
}

export function countTreeSessions(nodes: SessionTreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + countTreeSessions(node.children),
    0,
  );
}
