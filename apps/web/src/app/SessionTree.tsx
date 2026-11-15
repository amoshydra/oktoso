import type { Session } from "@amoshydra/oktoso-contracts";
import { Icon } from "./Icon";
import { SessionRow } from "./SessionRow";
import type { SessionTreeNode } from "./session-tree";

export interface SessionTreeLabels {
  provider: (id: string) => string;
  time: (at: number) => string;
  aria: (session: Session, parentTitle?: string) => string;
  attention?: (session: Session) => { type: string; label: string } | undefined;
}

export interface SessionTreeProps {
  nodes: SessionTreeNode[];
  expanded: Set<string>;
  onToggle: (ref: string) => void;
  onOpen: (ref: string) => void;
  labels: SessionTreeLabels;
  activeRef?: string;
  depth?: number;
}

/**
 * Parent sessions with their subagents nested behind a disclosure.
 *
 * The parent row keeps its normal session action; the chevron is a separate
 * control, so expanding a family never opens a session by accident.
 */
export function SessionTree(props: SessionTreeProps) {
  return (
    <div className="session-tree">
      {props.nodes.map((node) => (
        <SessionTreeBranch
          key={node.session.ref}
          node={node}
          depth={props.depth ?? 0}
          expanded={props.expanded}
          onToggle={props.onToggle}
          onOpen={props.onOpen}
          labels={props.labels}
          activeRef={props.activeRef}
        />
      ))}
    </div>
  );
}

function SessionTreeBranch(props: {
  node: SessionTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (ref: string) => void;
  onOpen: (ref: string) => void;
  labels: SessionTreeLabels;
  activeRef?: string;
  parentTitle?: string;
}) {
  const { node, depth } = props;
  const session = node.session;
  const hasChildren = node.children.length > 0;
  const open = props.expanded.has(session.ref);
  const childID = `subagents-${session.ref.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
  const running = node.children.filter(
    (child) => child.session.status === "running",
  ).length;
  const childLabel = `${node.children.length} subagent${
    node.children.length === 1 ? "" : "s"
  }${running > 0 ? ` · ${running} running` : ""}`;

  return (
    <div className="session-tree-branch" data-depth={depth}>
      <div className="session-tree-row">
        <SessionRow
          session={session}
          provider={props.labels.provider(session.providerID)}
          time={props.labels.time(node.latestAt)}
          ariaLabel={props.labels.aria(session, props.parentTitle)}
          active={props.activeRef === session.ref}
          attention={props.labels.attention?.(session)}
          metaPrefix={
            <>
              {depth > 0 ? (
                <span className="session-subagent-tag">Subagent</span>
              ) : null}
              {hasChildren ? (
                <span className="session-child-count">{childLabel}</span>
              ) : null}
            </>
          }
          reserveTrailing={hasChildren}
          onOpen={() => props.onOpen(session.ref)}
        />
        {hasChildren ? (
          <button
            className="session-disclosure"
            type="button"
            aria-expanded={open}
            aria-controls={childID}
            aria-label={`${open ? "Hide" : "Show"} ${node.children.length} subagent${
              node.children.length === 1 ? "" : "s"
            } of ${session.title}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggle(session.ref);
            }}
          >
            <Icon
              name="chevron-right"
              size={14}
              className={`session-disclosure-chevron ${open ? "open" : ""}`}
            />
          </button>
        ) : null}
      </div>
      {hasChildren ? (
        <div
          className="session-tree-children"
          id={childID}
          role="group"
          aria-label={`Subagents of ${session.title}`}
          hidden={!open}
        >
          {node.children.map((child) => (
            <SessionTreeBranch
              key={child.session.ref}
              node={child}
              depth={depth + 1}
              expanded={props.expanded}
              onToggle={props.onToggle}
              onOpen={props.onOpen}
              labels={props.labels}
              activeRef={props.activeRef}
              parentTitle={session.title}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
