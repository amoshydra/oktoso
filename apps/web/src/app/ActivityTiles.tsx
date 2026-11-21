import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { Icon } from "./Icon";
import {
  ACTIVITY_ICONS,
  activityStatusLabel,
  flattenActivity,
  type ActivityItem,
} from "./activity-model";

export interface ActivityDetailContext<T> {
  item: ActivityItem<T>;
  /** Position in the flat grid, including grouped children. */
  index: number;
  total: number;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export interface ActivityTilesProps<T> {
  items: ActivityItem<T>[];
  /** Toggle row label. */
  label: string;
  /** Pre-formatted, because the chat and dock use different clocks. */
  time?: string;
  onStepOpenChange?: (open: boolean) => void;
  renderDetail: (context: ActivityDetailContext<T>) => ReactNode;
}

/**
 * Agent activity as a wrapping tile grid.
 *
 * Every step is a thumb-size button. Selecting one opens the step inline, on
 * its own line under the row of the selected tile, like a disclosure - never a
 * modal. The grid height is the only cost; the transcript keeps scrolling.
 *
 * This is the only renderer. The chat and the assistant dock differ in their
 * adapters - and therefore in what a detail panel can show - not in the grid,
 * the counts, the status rules, or the keyboard model.
 */
export function ActivityTiles<T>(props: ActivityTilesProps<T>) {
  const [expanded, setExpanded] = useState(false);
  const [openId, setOpenId] = useState<string>();
  const [perRow, setPerRow] = useState(Math.max(1, props.items.length));
  const gridRef = useRef<HTMLDivElement | null>(null);
  const flat = useMemo(() => flattenActivity(props.items), [props.items]);
  const openIndex = flat.findIndex((entry) => entry.item.id === openId);
  const errors = flat.filter((entry) => entry.item.status === "error").length;
  const running = flat.some((entry) => entry.item.status === "running");

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const update = () => {
      const tile = grid.querySelector<HTMLElement>(".activity-tile");
      if (!tile) return;
      const gap = Number.parseFloat(getComputedStyle(grid).columnGap) || 0;
      const width = tile.getBoundingClientRect().width;
      if (width <= 0) return;
      const next = Math.max(
        1,
        Math.floor((grid.clientWidth + gap) / (width + gap)),
      );
      setPerRow((current) => (current === next ? current : next));
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [flat.length, expanded]);

  useEffect(() => {
    props.onStepOpenChange?.(openId !== undefined);
    if (openId === undefined) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(undefined);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId]);

  if (props.items.length === 0) return null;

  const insertAt =
    openIndex >= 0
      ? Math.min((Math.floor(openIndex / perRow) + 1) * perRow, flat.length) - 1
      : -1;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const grid = gridRef.current;
    if (!grid) return;
    const buttons = Array.from(
      grid.querySelectorAll<HTMLButtonElement>(".activity-tile"),
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return;
    let next = current;
    if (event.key === "ArrowRight") next = Math.min(current + 1, buttons.length - 1);
    else if (event.key === "ArrowLeft") next = Math.max(current - 1, 0);
    else if (event.key === "ArrowDown") next = Math.min(current + perRow, buttons.length - 1);
    else if (event.key === "ArrowUp") next = Math.max(current - perRow, 0);
    else return;
    event.preventDefault();
    buttons[next]?.focus();
  };

  return (
    <article className={`agent-activity ${expanded ? "expanded" : "collapsed"}`}>
      <button
        className="agent-activity-toggle"
        type="button"
        aria-expanded={expanded}
        aria-label={`${props.label}: ${flat.length} ${flat.length === 1 ? "step" : "steps"}${errors > 0 ? `, ${errors} error${errors === 1 ? "" : "s"}` : ""}`}
        onClick={() => {
          if (expanded) setOpenId(undefined);
          setExpanded(!expanded);
        }}
      >
        <span className="agent-activity-label">{props.label}</span>
        <span className="agent-activity-count">
          {flat.length} {flat.length === 1 ? "step" : "steps"}
        </span>
        {errors > 0 ? (
          <span className="agent-activity-error">
            {errors} {errors === 1 ? "error" : "errors"}
          </span>
        ) : null}
        {running && errors === 0 ? (
          <span className="agent-activity-running">running</span>
        ) : null}
        {props.time ? (
          <time className="agent-activity-time">{props.time}</time>
        ) : null}
        <span className="agent-activity-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={14} />
        </span>
      </button>

      {expanded ? null : (
        <div className="agent-activity-dots" aria-hidden="true">
          {flat.map(({ item }) => (
            <span
              className="activity-dot"
              key={item.id}
              data-kind={item.kind}
              data-status={item.status}
            />
          ))}
        </div>
      )}

      {expanded ? (
        <div
          className="agent-activity-grid"
          role="group"
          aria-label={props.label}
          ref={gridRef}
          onKeyDown={onKeyDown}
        >
          {flat.map(({ item, depth }, index) => {
            const open = item.id === openId;
            return (
              <Fragment key={item.id}>
                <button
                  className="activity-tile"
                  type="button"
                  data-kind={item.kind}
                  data-status={item.status}
                  data-open={open ? "true" : "false"}
                  {...(depth > 0 ? { "data-depth": depth } : {})}
                  aria-expanded={open}
                  aria-label={[
                    item.label,
                    activityStatusLabel(item.status),
                    item.metric &&
                    item.metric !== activityStatusLabel(item.status)
                      ? item.metric
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  title={item.title ?? item.metric}
                  onClick={() => setOpenId(open ? undefined : item.id)}
                >
                  <Icon name={ACTIVITY_ICONS[item.kind]} size={18} />
                  <span className="activity-tile-meta">{item.metric ?? ""}</span>
                  {item.status !== "completed" ? (
                    <span className="activity-tile-dot" aria-hidden="true" />
                  ) : null}
                </button>
                {openIndex >= 0 && index === insertAt
                  ? props.renderDetail({
                      item: flat[openIndex]!.item,
                      index: openIndex,
                      total: flat.length,
                      onClose: () => setOpenId(undefined),
                      ...(flat[openIndex - 1]
                        ? { onPrev: () => setOpenId(flat[openIndex - 1]!.item.id) }
                        : {}),
                      ...(flat[openIndex + 1]
                        ? { onNext: () => setOpenId(flat[openIndex + 1]!.item.id) }
                        : {}),
                    })
                  : null}
              </Fragment>
            );
          })}
        </div>
      ) : null}
    </article>
  );
}
