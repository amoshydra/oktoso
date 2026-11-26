import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { HubClient } from "@amoshydra/oktoso-client";
import type {
  AssistantAction,
  AssistantEvent,
  AssistantScope,
  AssistantSource,
  AssistantStep,
  AssistantThreadDetail,
  AssistantTurn,
} from "@amoshydra/oktoso-contracts";
import {
  ActivityTiles as ActivityGrid,
  type ActivityDetailContext,
} from "./ActivityTiles";
import {
  activityStatusLabel,
  durationLabel,
  itemsFromAssistantSteps,
  type ActivityItem,
} from "./activity-model";
import { FilePreview } from "./FilePreview";
import { Icon } from "./Icon";
import { Markdown } from "./Markdown";
import { dayLabel, timeLabel, turnMetaParts } from "./assistant-meta";
import {
  draftSlotStatusText,
  useDraftSlot,
} from "./use-draft-slot";
import { artifactPathsFromMessages } from "@amoshydra/oktoso-contracts";
import type { ResourceContext } from "./urls";

export interface AssistantDockProps {
  client: HubClient;
  /** The scope this dock opens on. The user can switch session ↔ project. */
  initialScope: AssistantScope;
  title: string;
  project?: string;
  /** Global threads are a modal dialog; session/project threads dock. */
  presentation?: "dock" | "dialog";
  onOpenSettings?: () => void;
  /** Jump to a referenced message in the session chat. */
  onOpenMessage?: (ref: string, messageID?: string) => void;
  onClose: () => void;
}

const SUGGESTIONS = [
  "Why is this stuck?",
  "What changed most recently?",
  "Draft a reply for me",
  "Draft a handoff",
];

const ACTION_LABEL: Record<AssistantAction["kind"], string> = {
  send: "Send",
  answer: "Answer",
  interrupt: "Stop turn",
  handoff: "Handoff",
};

/**
 * Hub assistant panel.
 *
 * M1 read-only answers, M2 confirmed actions, M3 project/global scopes, plus a
 * per-thread model and the hub activity that produced each answer.
 */
export function AssistantDock({
  client,
  initialScope,
  title,
  project,
  presentation = "dock",
  onOpenSettings,
  onOpenMessage,
  onClose,
}: AssistantDockProps) {
  const [scope, setScope] = useState<AssistantScope>(initialScope);
  const sessionRef =
    initialScope.kind === "session" ? initialScope.sessionRef : undefined;
  const label =
    scope.kind === "project"
      ? scope.project
      : scope.kind === "global"
        ? "All sessions"
        : title;
  const [thread, setThread] = useState<AssistantThreadDetail | null>(null);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [input, setInput] = useState("");
  const [streamText, setStreamText] = useState("");
  const [liveSteps, setLiveSteps] = useState<AssistantStep[]>([]);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [resource, setResource] = useState<ResourceContext>({});
  const [previewPath, setPreviewPath] = useState<string | undefined>(undefined);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [modelsBase, setModelsBase] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const modelWrap = useRef<HTMLDivElement>(null);

  const composerDraftKey =
    scope.kind === "global"
      ? "draft:assistant:global"
      : scope.kind === "project"
        ? `draft:assistant:project:${scope.project}`
        : `draft:assistant:session:${scope.sessionRef}`;
  const composerDraft = useDraftSlot({
    client,
    key: composerDraftKey,
    onLoad: (text) => {
      if (text) setInput(text);
    },
  });
  const composerDraftStatus = draftSlotStatusText(composerDraft.status);

  const canWriteHere = canWrite;

  useEffect(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    return () => {
      const target = returnFocus.current;
      if (target && document.contains(target)) target.focus();
    };
  }, []);

  useEffect(() => {
    if (busy) return;
    textareaRef.current?.focus();
  }, [busy]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setThread(null);
    setTurns([]);
    setError(undefined);
    setRunId(undefined);
    setStreamText("");
    setLiveSteps([]);
    setInput("");
    Promise.all([
      client.createAssistantThread({ scope }),
      client.assistantStatus().catch(() => undefined),
      client.assistantAgentModels().catch(() => undefined),
    ])
      .then(async ([created, status, catalog]) => {
        const detail = await client.assistantThread(created.id);
        if (cancelled) return;
        setThread(detail);
        setTurns(detail.turns);
        setCanWrite(Boolean(status?.canWrite));
        setModels(catalog?.data ?? []);
        setModelsBase(catalog?.baseUrl ?? "");
        setModel(
          detail.thread.model ??
            catalog?.current ??
            status?.model ??
            "",
        );
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Unable to open the assistant");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
      streamAbort.current?.abort();
    };
  }, [client, scope]);

  /**
   * The session resource context, so an answer renders like a chat message.
   *
   * Only the session scope has a directory to resolve files against; project
   * and global threads keep plain Markdown because a mention has no single
   * session to open.
   */
  useEffect(() => {
    if (scope.kind !== "session") {
      setResource({});
      return;
    }
    const ref = scope.sessionRef;
    let cancelled = false;
    void Promise.all([
      client.session(ref),
      client.providers(),
      client.fileRoots(ref).catch(() => []),
      client.messages(ref, { limit: 200, order: "desc" }).catch(() => ({
        data: [],
        cursor: { next: null, previous: null },
      })),
    ])
      .then(([session, providers, roots, page]) => {
        if (cancelled) return;
        const provider = providers.find((entry) => entry.id === session.providerID);
        setResource({
          baseUrl: provider?.baseUrl,
          providerID: session.providerID,
          providerType: provider?.type,
          directory: session.directory,
          sessionRef: session.ref,
          fileRead: Boolean(provider?.capabilities.files),
          previewRoots: roots,
          artifactPaths: artifactPathsFromMessages(page.data, session.directory),
        });
      })
      .catch(() => {
        // Without the session the answer still renders, minus file previews.
        if (!cancelled) setResource({ sessionRef: ref });
      });
    return () => {
      cancelled = true;
    };
  }, [client, scope]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, streamText, liveSteps]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The preview sheet owns Escape while it is open.
      if (previewPath) return;
      if (modelOpen) {
        setModelOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modelOpen, onClose, previewPath]);

  useEffect(() => {
    if (!modelOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (modelWrap.current?.contains(event.target as Node)) return;
      setModelOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [modelOpen]);

  const resync = useCallback(async () => {
    if (!thread) return;
    const detail = await client.assistantThread(thread.thread.id);
    setTurns(detail.turns);
  }, [client, thread]);

  const pending = turns.find(
    (turn) =>
      turn.action?.status === "pending" || turn.action?.status === "deciding",
  );

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || !thread || runId || busy) return;
      if (pending) {
        setError("Decide the pending action first");
        return;
      }
      setError(undefined);
      setStreamText("");
      setLiveSteps([]);
      try {
        const accepted = await client.sendAssistantMessage(thread.thread.id, {
          text: question,
        });
        setInput("");
        void composerDraft.clear();
        setTurns((current) => addTurn(current, accepted.turn));
        setRunId(accepted.run.id);
        const controller = new AbortController();
        streamAbort.current = controller;
        await client.streamAssistantRun(accepted.run.id, {
          signal: controller.signal,
          onEvent: (event: AssistantEvent) => {
            if (event.type === "delta") {
              setStreamText((current) => current + event.text);
              return;
            }
            if (event.type === "step") {
              setLiveSteps((current) => upsertStep(current, event.step));
              return;
            }
            if (event.type === "done" || event.type === "action") {
              setTurns((current) => addTurn(current, event.turn));
              setStreamText("");
              setLiveSteps([]);
              setRunId(undefined);
              return;
            }
            setError(event.message);
            setStreamText("");
            setLiveSteps([]);
            setRunId(undefined);
            void resync();
          },
        });
      } catch (cause) {
        if ((cause as { name?: string })?.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "The answer failed");
        setRunId(undefined);
        void resync();
      } finally {
        setRunId(undefined);
      }
    },
    [busy, client, composerDraft, pending, resync, runId, thread],
  );

  const stop = useCallback(async () => {
    if (!runId) return;
    try {
      await client.stopAssistantRun(runId);
    } catch {
      // The run may already have finished; the resync below settles the UI.
    }
    streamAbort.current?.abort();
    setRunId(undefined);
    setStreamText("");
    setLiveSteps([]);
    void resync();
  }, [client, resync, runId]);

  const decide = useCallback(
    async (
      turn: AssistantTurn,
      decision: "confirm" | "cancel",
      text?: string,
      reason?: string,
      evidence?: string,
    ): Promise<boolean> => {
      if (!thread) return false;
      try {
        const updated = await client.decideAssistantAction(
          thread.thread.id,
          turn.id,
          {
            decision,
            ...(text ? { text } : {}),
            ...(reason !== undefined ? { reason } : {}),
            ...(evidence !== undefined ? { evidence } : {}),
          },
        );
        setTurns((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        );
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The action failed");
        void resync();
        return false;
      }
    },
    [client, resync, thread],
  );

  const chooseModel = useCallback(
    async (next: string) => {
      if (!thread || next === model || modelSaving) return;
      setModelSaving(true);
      try {
        await client.setAssistantThreadModel(thread.thread.id, next);
        setModel(next);
        setModelOpen(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not change the model");
      } finally {
        setModelSaving(false);
      }
    },
    [client, model, modelSaving, thread],
  );

  const disabled = turns.length === 0 && !streamText && !runId;

  const panel = (
    <aside className="assistant-dock" id="session-assistant" aria-label={`Assistant for ${label}`}>
      <header className="assistant-head">
        <div className="assistant-head-title">
          <span className="assistant-mark" aria-hidden="true">
            <Icon
              name={
                scope.kind === "global"
                  ? "globe"
                  : scope.kind === "project"
                    ? "layers"
                    : "bot"
              }
              size={16}
            />
          </span>
          <div>
            <h2>Assistant</h2>
            <p>{label}</p>
          </div>
        </div>
        <div className="assistant-head-actions">
          {project && sessionRef ? (
            <button
              className="assistant-scope"
              type="button"
              aria-label={
                scope.kind === "project"
                  ? "Switch to this session"
                  : "Switch to this project"
              }
              onClick={() =>
                setScope(
                  scope.kind === "project"
                    ? { kind: "session", sessionRef }
                    : { kind: "project", project },
                )
              }
            >
              {scope.kind === "project" ? "This project" : "This session"}
            </button>
          ) : (
            <span className="assistant-scope">
              {scope.kind === "global" ? "All sessions" : "This session"}
            </span>
          )}
          <button
            className="icon-btn"
            type="button"
            onClick={onClose}
            aria-label="Close assistant"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </header>

      <div className="assistant-log" ref={logRef} role="log" aria-live="polite">
        {busy ? <p className="assistant-note">Reading this session…</p> : null}
        {!busy && disabled ? (
          <div className="assistant-empty">
            <p>Ask about this session. It reads the session, not your providers.</p>
            <div className="assistant-suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  className="assistant-suggestion"
                  type="button"
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((turn, index) => {
          const day = dayLabel(turn.createdAt);
          const newDay =
            index === 0 || dayLabel(turns[index - 1]!.createdAt) !== day;
          return (
            <Fragment key={turn.id}>
              {newDay ? <div className="assistant-day">{day}</div> : null}
              <article
                className={`assistant-turn ${turn.role}`}
                aria-label={turn.role === "user" ? "Your question" : "Assistant answer"}
              >
                <div className="assistant-turn-role">
                  <span>
                    {turn.role === "user" ? "You" : "Assistant"}
                    {turn.error ? (
                      <span className="assistant-turn-error"> · {turn.error}</span>
                    ) : null}
                  </span>
                  <time
                    className="assistant-turn-time"
                    dateTime={new Date(turn.createdAt).toISOString()}
                  >
                    {timeLabel(turn.createdAt)}
                  </time>
                </div>
                {turn.activity && turn.activity.length > 0 ? (
                  <ActivityBlock steps={turn.activity} at={turn.createdAt} />
                ) : null}
                {turn.text || turn.error ? (
                  turn.role === "assistant" ? (
                    <div className="assistant-turn-text">
                      <Markdown
                        text={turn.text}
                        client={client}
                        resource={resource}
                        headingOffset={1}
                        {...(resource.sessionRef
                          ? { onPreviewFile: setPreviewPath }
                          : {})}
                      />
                    </div>
                  ) : (
                    <div className="assistant-turn-text">{turn.text}</div>
                  )
                ) : turn.action ? null : (
                  <div className="assistant-turn-text">…</div>
                )}
                <TurnMeta turn={turn} />
                {turn.role === "assistant" && turn.sources?.length ? (
                  <AssistantSources
                    sources={turn.sources}
                    onOpenMessage={onOpenMessage}
                  />
                ) : null}
                {turn.action ? (
                  <ActionCard
                    turn={turn}
                    client={client}
                    canWrite={canWriteHere}
                    onDecide={decide}
                  />
                ) : null}
              </article>
            </Fragment>
          );
        })}

        {runId ? (
          <article className="assistant-turn assistant" aria-label="Assistant is answering">
            <div className="assistant-turn-role">
              <span>Assistant</span>
            </div>
            {liveSteps.length > 0 ? (
              <ActivityBlock steps={liveSteps} at={Date.now()} />
            ) : null}
            <div
              className={`assistant-turn-text${streamText ? " is-streaming" : ""}`}
            >
              {streamText ? (
                <Markdown
                  text={streamText}
                  client={client}
                  resource={resource}
                  headingOffset={1}
                  {...(resource.sessionRef
                    ? { onPreviewFile: setPreviewPath }
                    : {})}
                />
              ) : (
                <span className="assistant-waiting">Reading…</span>
              )}
            </div>
          </article>
        ) : null}

        {error ? (
          <p className="assistant-error" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      <footer className="assistant-foot">
        <form
          className="assistant-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send(input);
          }}
        >
          <label className="sr-only" htmlFor="assistant-input">
            Ask about this session
          </label>
          <textarea
            id="assistant-input"
            ref={textareaRef}
            value={input}
            rows={2}
            maxLength={4_000}
            disabled={busy || Boolean(pending)}
            placeholder={
              busy
                ? "Reading this session…"
                : pending
                  ? "Decide the action above first…"
                  : "Ask about this session…"
            }
            onChange={(event) => {
              setInput(event.target.value);
              composerDraft.save(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                // Read the element, not the closed-over state: Enter can land
                // before the change has re-rendered.
                void send(event.currentTarget.value);
              }
            }}
          />
          {runId ? (
            <button className="btn small" type="button" onClick={() => void stop()}>
              Stop
            </button>
          ) : (
            <button
              className="btn small primary"
              type="submit"
              disabled={input.trim().length === 0 || busy || Boolean(pending)}
            >
              Ask
            </button>
          )}
        </form>
        <div className="assistant-composer-meta">
          <div className="assistant-model-wrap" ref={modelWrap}>
            <button
              className="assistant-scope assistant-model-chip"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={modelOpen}
              disabled={busy || Boolean(runId) || modelSaving}
              onClick={() => setModelOpen((open) => !open)}
              title={model || "Default model"}
            >
              {modelLabel(model)}
              <span aria-hidden="true">▾</span>
            </button>
            {modelOpen ? (
              <div
                className="assistant-model-menu up"
                role="listbox"
                aria-label="Model for this thread"
              >
                <div className="assistant-model-head">Model for this thread</div>
                <div className="assistant-model-source">
                  {endpointLabel(modelsBase)}
                </div>
                {models.length === 0 ? (
                  <div className="assistant-model-empty">No models reported</div>
                ) : (
                  models.map((entry) => (
                    <button
                      key={entry}
                      className={`assistant-model-item ${entry === model ? "on" : ""}`}
                      type="button"
                      role="option"
                      aria-selected={entry === model}
                      onClick={() => void chooseModel(entry)}
                    >
                      <span className="assistant-model-radio" aria-hidden="true" />
                      <span className="assistant-model-name">{entry}</span>
                    </button>
                  ))
                )}
                <div className="assistant-model-note">
                  Applies to the next question. Past answers keep the model that
                  wrote them.
                </div>
                {onOpenSettings ? (
                  <button
                    className="assistant-model-link"
                    type="button"
                    onClick={() => {
                      setModelOpen(false);
                      onOpenSettings();
                    }}
                  >
                    Change endpoint
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {composerDraftStatus ? (
            <span className="assistant-draft-note" role="status">
              {composerDraftStatus}
            </span>
          ) : null}
          <span className="assistant-readonly">
            {canWriteHere ? "Writes need your confirmation" : "Read-only · no writes"}
          </span>
        </div>
      </footer>

      {previewPath && resource.sessionRef ? (
        <FilePreview
          path={previewPath}
          client={client}
          resource={resource}
          onPreviewFile={setPreviewPath}
          onClose={() => setPreviewPath(undefined)}
        />
      ) : null}
    </aside>
  );

  if (presentation === "dialog") {
    return <AssistantDialog onClose={onClose}>{panel}</AssistantDialog>;
  }
  return panel;
}

/** Global assistant: a modal sheet, not another fixed dock. */
function AssistantDialog({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", cancel);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      if (dialog.open) dialog.close();
    };
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="assistant-dialog"
      id="session-assistant"
      aria-label="Assistant"
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
    >
      {children}
    </dialog>
  );
}

function ActivityBlock({
  steps,
  at,
}: {
  steps: AssistantStep[];
  at: number;
}) {
  const items = useMemo(() => itemsFromAssistantSteps(steps), [steps]);
  return (
    <ActivityGrid
      items={items}
      label="Agent activity"
      time={timeLabel(at)}
      renderDetail={({
        item,
        onClose,
      }: ActivityDetailContext<AssistantStep>) => (
        <ActivityDetail item={item} onClose={onClose} />
      )}
    />
  );
}

/**
 * The dock's detail panel: the chat's chrome, hub facts only.
 *
 * There are no provider message parts behind these steps, so this shows the
 * recorded metrics instead of a file preview or a diff.
 */
function ActivityDetail({
  item,
  onClose,
}: {
  item: ActivityItem<AssistantStep>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const metrics = Object.entries(item.metrics ?? {});
  useEffect(() => {
    // The tile row may sit at the bottom of the transcript; bring the panel
    // into view without moving the composer.
    const timer = window.setTimeout(() => {
      ref.current?.scrollIntoView({ block: "nearest" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [item.id]);
  return (
    <section
      className="activity-step"
      aria-label={`${item.label} step`}
      ref={ref}
    >
      <header className="activity-step-head">
        <span className={`tool-status ${item.status}`}>
          {activityStatusLabel(item.status)}
        </span>
        <span className="activity-step-title">{item.label}</span>
        {item.metric ? (
          <span className="activity-step-subtitle">{item.metric}</span>
        ) : null}
        {item.durationMs !== undefined ? (
          <span className="activity-step-time">
            {durationLabel(item.durationMs)}
          </span>
        ) : null}
        <button
          className="icon-btn activity-step-close"
          type="button"
          aria-label="Close step"
          onClick={onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="activity-step-body">
        {item.detail ? <p className="activity-step-detail">{item.detail}</p> : null}
        {metrics.length > 0 ? (
          <dl className="activity-step-metrics">
            {metrics.map(([key, value]) => (
              <div key={key}>
                <dt>{metricLabel(key)}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>
    </section>
  );
}

const METRIC_LABELS: Record<string, string> = {
  turns: "Turns",
  sessions: "Sessions",
  attention: "Attention",
  query: "Query",
  hits: "Hits",
  compaction: "Compaction",
  action: "Action",
  bytes: "Payload",
  promptTokens: "Prompt tokens",
  completionTokens: "Completion tokens",
};

function metricLabel(key: string): string {
  return (
    METRIC_LABELS[key] ??
    key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase())
  );
}

function AssistantSources(props: {
  sources: AssistantSource[];
  onOpenMessage?: (ref: string, messageID?: string) => void;
}) {
  return (
    <div className="assistant-sources" aria-label="Referenced messages">
      <span className="assistant-sources-label">Referenced messages</span>
      <ul className="assistant-source-list">
        {props.sources.map((source) => {
          const href = `/sessions/${encodeURIComponent(source.ref)}${
            source.messageID
              ? `?message=${encodeURIComponent(source.messageID)}`
              : ""
          }`;
          return (
            <li key={`${source.ref}:${source.messageID ?? source.createdAt ?? source.title}`}>
              <a
                className="assistant-source"
                href={href}
                onClick={(event) => {
                  if (!props.onOpenMessage) return;
                  event.preventDefault();
                  props.onOpenMessage(source.ref, source.messageID);
                }}
              >
                <span className="assistant-source-head">
                  <span className="assistant-source-title">{source.title}</span>
                  {source.createdAt ? (
                    <span className="assistant-source-time">
                      {timeLabel(source.createdAt)}
                    </span>
                  ) : null}
                </span>
                <span className="assistant-source-meta">
                  {source.role === "user" ? "You" : "Agent"} · {source.ref}
                </span>
                {source.snippet ? (
                  <span className="assistant-source-snippet">
                    {source.snippet}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ActionCard({
  turn,
  client,
  canWrite,
  onDecide,
}: {
  turn: AssistantTurn;
  client: HubClient;
  canWrite: boolean;
  onDecide: (
    turn: AssistantTurn,
    decision: "confirm" | "cancel",
    text?: string,
    reason?: string,
    evidence?: string,
  ) => Promise<boolean>;
}) {
  const action = turn.action;
  const cardRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(action?.text ?? "");
  const [reason, setReason] = useState(action?.reason ?? "");
  const [evidence, setEvidence] = useState(action?.evidence ?? "");
  const [saving, setSaving] = useState(false);
  const pending = action?.status === "pending";
  const editable = Boolean(
    action && pending && (action.kind === "send" || action.kind === "handoff"),
  );
  const actionDraft = useDraftSlot({
    client,
    key: editable && action ? `draft:assistant-action:${action.id}` : undefined,
    enabled: editable,
    onLoad: (saved) => {
      if (saved) setText(saved);
    },
  });
  const actionDraftStatus = draftSlotStatusText(actionDraft.status);

  useEffect(() => {
    if (!editable) return;
    cardRef.current?.scrollIntoView({ block: "end" });
  }, [action?.id, actionDraft.loaded, editable]);

  if (!action) return null;

  const working = action.status === "deciding";
  const targetMeta = [
    action.targetProject,
    action.targetProviderID,
    action.targetRef,
  ]
    .filter(Boolean)
    .join(" · ");
  const decide = async (decision: "confirm" | "cancel") => {
    setSaving(true);
    try {
      const saved = await onDecide(
        turn,
        decision,
        decision === "confirm" ? text : undefined,
        decision === "confirm" && action.kind === "handoff" ? reason : undefined,
        decision === "confirm" && action.kind === "handoff"
          ? evidence
          : undefined,
      );
      if (saved) await actionDraft.clear();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      ref={cardRef}
      className={`assistant-action ${action.status}`}
      role="group"
      aria-label={action.kind === "handoff" ? "Proposed handoff" : "Proposed action"}
    >
      <div className="assistant-action-head">
        <span className="assistant-action-label">
          {pending ? "Needs your confirmation" : ACTION_LABEL[action.kind]}
        </span>
        {pending ? null : (
          <span className="assistant-action-state">{actionLabel(action)}</span>
        )}
      </div>
      <p className="assistant-action-summary">{action.summary}</p>
      {action.kind === "send" && action.sessionTitle ? (
        <p className="assistant-action-target">
          To: <strong>{action.sessionTitle}</strong>
        </p>
      ) : null}
      {action.kind === "handoff" ? (
        <>
          {action.sourceTitle ? (
            <p className="assistant-action-target">
              From: <strong>{action.sourceTitle}</strong>
            </p>
          ) : null}
          {action.targetTitle || action.targetRef ? (
            <>
              <p className="assistant-action-target">
                To: <strong>{action.targetTitle ?? action.targetRef}</strong>
              </p>
              {targetMeta ? (
                <p className="assistant-action-target-meta">{targetMeta}</p>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}

      {action.kind === "send" || action.kind === "handoff" ? (
        pending ? (
          <>
            <label className="sr-only" htmlFor={`action-${action.id}`}>
              {action.kind === "handoff"
                ? "Handoff instruction"
                : "Message to send"}
            </label>
            <textarea
              id={`action-${action.id}`}
              className="assistant-action-text"
              value={text}
              rows={3}
              maxLength={4_000}
              onChange={(event) => {
                setText(event.target.value);
                actionDraft.save(event.target.value);
              }}
            />
            {action.kind === "handoff" ? (
              <>
                <label
                  className="assistant-action-field-label"
                  htmlFor={`reason-${action.id}`}
                >
                  Why (optional)
                </label>
                <input
                  id={`reason-${action.id}`}
                  className="assistant-action-reason"
                  value={reason}
                  maxLength={500}
                  placeholder="Why this handoff?"
                  onChange={(event) => setReason(event.target.value)}
                />
                <label
                  className="assistant-action-field-label"
                  htmlFor={`evidence-${action.id}`}
                >
                  Evidence (optional)
                </label>
                <input
                  id={`evidence-${action.id}`}
                  className="assistant-action-evidence"
                  value={evidence}
                  maxLength={500}
                  placeholder="Queue entry, log line, commit…"
                  onChange={(event) => setEvidence(event.target.value)}
                />
              </>
            ) : null}
            {actionDraftStatus ? (
              <p className="assistant-draft-note" role="status">
                {actionDraftStatus}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="assistant-action-value">{action.text}</p>
            {action.kind === "handoff" && action.reason ? (
              <p className="assistant-action-reason-value">
                Why: {action.reason}
              </p>
            ) : null}
            {action.kind === "handoff" && action.evidence ? (
              <p className="assistant-action-reason-value">
                Evidence: {action.evidence}
              </p>
            ) : null}
          </>
        )
      ) : null}

      {action.kind === "answer" && action.questions?.length ? (
        <div className="assistant-action-questions">
          {action.questions.map((question) => {
            const chosen = new Set(
              (action.answers ?? [])
                .filter((answer) => answer.questionId === question.id)
                .map((answer) => answer.choiceId),
            );
            return (
              <div key={question.id} className="assistant-action-question">
                <p className="assistant-action-value">{question.text}</p>
                <div className="assistant-action-choices">
                  {question.choices.map((choice) => (
                    <span
                      key={choice.id}
                      className={`assistant-action-choice ${
                        chosen.has(choice.id) ? "chosen" : ""
                      }`}
                    >
                      {choice.label}
                    </span>
                  ))}
                </div>
                {question.risk !== "normal" ? (
                  <span className="assistant-action-risk">{question.risk}</span>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : action.kind === "answer" ? (
        <p className="assistant-action-value">{action.text}</p>
      ) : null}

      {action.kind === "handoff" &&
      action.status === "done" &&
      action.receiptQueuedAt ? (
        <p className="assistant-action-receipt">
          Session receipt queued for its next turn.
        </p>
      ) : null}

      {action.error ? (
        <p className="assistant-action-error">{action.error}</p>
      ) : null}

      {action.status === "failed" &&
      action.kind === "answer" &&
      action.questions?.some((question) => question.risk !== "normal") ? (
        <a className="assistant-action-link" href="/inbox?filter=question">
          Open the Inbox
        </a>
      ) : null}

      {action.kind === "handoff" &&
      action.sessionRef &&
      (action.status === "done" || action.status === "failed") ? (
        <a
          className="assistant-action-link"
          href={`/sessions/${encodeURIComponent(action.sessionRef)}`}
        >
          Open source session
        </a>
      ) : null}

      {working ? <p className="assistant-action-error">Working…</p> : null}

      {pending ? (
        <div className="assistant-action-buttons">
          {canWrite ? (
            <button
              className="btn small primary"
              type="button"
              disabled={
                saving ||
                ((action.kind === "send" || action.kind === "handoff") &&
                  text.trim().length === 0)
              }
              onClick={() => void decide("confirm")}
            >
              {saving
                ? "Working…"
                : action.kind === "answer" && action.text
                  ? `Answer “${action.text.length > 40 ? `${action.text.slice(0, 40)}…` : action.text}”`
                  : action.kind === "handoff"
                    ? "Send handoff"
                    : action.kind === "send" && action.sessionTitle
                      ? `Send to “${action.sessionTitle.length > 24 ? `${action.sessionTitle.slice(0, 24)}…` : action.sessionTitle}”`
                      : ACTION_LABEL[action.kind]}
            </button>
          ) : (
            <span className="assistant-action-error">
              Writes are disabled. Cancel to unlock the thread.
            </span>
          )}
          <button
            className="btn small"
            type="button"
            disabled={saving}
            onClick={() => void decide("cancel")}
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** SSE replay can resend a turn; keep one row per id. */
function addTurn(current: AssistantTurn[], turn: AssistantTurn): AssistantTurn[] {
  return current.some((entry) => entry.id === turn.id)
    ? current
    : [...current, turn];
}

/** Steps are emitted running then finished under the same id. */
function upsertStep(
  current: AssistantStep[],
  step: AssistantStep,
): AssistantStep[] {
  const index = current.findIndex((entry) => entry.id === step.id);
  if (index === -1) return [...current, step];
  const next = [...current];
  next[index] = step;
  return next;
}

function endpointLabel(baseUrl: string): string {
  if (!baseUrl) return "Default endpoint";
  try {
    const url = new URL(baseUrl);
    const path = url.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
    return `Models from ${url.host}${path}`;
  } catch {
    return `Models from ${baseUrl}`;
  }
}

function modelLabel(id: string): string {
  if (!id) return "Default model";
  const clean = id
    .replace(/-GGUF.*$/i, "")
    .replace(/[-_]+$/, "");
  return clean.length > 26 ? `${clean.slice(0, 26)}…` : clean;
}

function startOfDay(ts: number): number {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function asOfLabel(ts: number): string {
  if (startOfDay(ts) === startOfDay(Date.now())) return timeLabel(ts);
  return `${new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} ${timeLabel(ts)}`;
}

function TurnMeta({ turn }: { turn: AssistantTurn }) {
  const parts = turnMetaParts(turn);
  if (parts.length === 0) return null;
  return <div className="assistant-turn-meta">{parts.join(" · ")}</div>;
}

function actionLabel(action: AssistantAction): string {
  if (action.status === "done") {
    if (action.kind === "send" || action.kind === "handoff") return "Sent";
    if (action.kind === "answer") return "Answered";
    return "Stopped";
  }
  if (action.status === "cancelled") return "Cancelled";
  if (action.status === "expired") return "Expired";
  if (action.status === "failed") return "Failed";
  if (action.status === "deciding") return "Working…";
  return "Pending";
}
