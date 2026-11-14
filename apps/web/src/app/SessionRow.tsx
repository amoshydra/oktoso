import type { Session } from "@amoshydra/oktoso-contracts";
import type { ReactNode } from "react";

export interface SessionRowProps {
  session: Session;
  provider: string;
  time: string;
  ariaLabel: string;
  active?: boolean;
  attention?: { type: string; label: string };
  metaPrefix?: ReactNode;
  metaSuffix?: ReactNode;
  showStatusChip?: boolean;
  reserveTrailing?: boolean;
  onOpen: () => void;
}

/**
 * One session row, shared by the Sessions list, the chat sidebar, and search.
 *
 * The tree owns nesting and the disclosure; this component is only the row so
 * every surface keeps the same status, unread, attention, and metadata grammar.
 */
export function SessionRow(props: SessionRowProps) {
  const { session } = props;
  return (
    <button
      className={`session-list-item ${session.unread ? "unread" : ""} ${
        props.active ? "active" : ""
      } ${props.reserveTrailing ? "session-row-trailing" : ""}`}
      type="button"
      aria-current={props.active ? "page" : undefined}
      aria-label={props.ariaLabel}
      onClick={props.onOpen}
    >
      <span className={`session-status-dot ${session.status}`} />
      <span className="session-list-main">
        <strong>{session.title}</strong>
        <span className="session-list-meta">
          {props.metaPrefix}
          {props.provider}
          {session.project || session.directory ? (
            <> · {session.project ?? session.directory}</>
          ) : null}
          {props.metaSuffix}
        </span>
      </span>
      <span className="session-list-side">
        {props.attention ? (
          <span className={`type-badge ${props.attention.type}`}>
            {props.attention.label}
          </span>
        ) : null}
        {session.unread ? <span className="sr-only">Unread</span> : null}
        <span className="mono">{props.time}</span>
        {props.showStatusChip ? (
          <span className={`status-chip ${session.status}`}>
            <i />
            {session.status}
          </span>
        ) : null}
      </span>
    </button>
  );
}
