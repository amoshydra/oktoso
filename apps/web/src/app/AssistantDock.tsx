import { useCallback, useEffect, useRef, useState } from "react";
import type { HubClient } from "@amoshydra/oktoso-client";
import type {
  AssistantAction,
  AssistantEvent,
  AssistantThreadDetail,
  AssistantTurn,
} from "@amoshydra/oktoso-contracts";
import { Icon } from "./Icon";

export interface AssistantDockProps {
  client: HubClient;
  sessionRef: string;
  sessionTitle: string;
  onClose: () => void;
}

const SUGGESTIONS = [
  "Why is this stuck?",
  "What changed most recently?",
  "Draft a reply for me",
];

const ACTION_LABEL: Record<AssistantAction["kind"], string> = {
  send: "Send",
  answer: "Answer",
  interrupt: "Stop turn",
};

/**
 * Session-scope hub assistant (M1 read-only, M2 confirmed writes).
 *
 * The model can propose one action; the card below the answer is the only way
 * it happens. Nothing is sent until the user confirms here.
 */
export function AssistantDock({
  client,
  sessionRef,
  sessionTitle,
  onClose,
}: AssistantDockProps) {
  const [thread, setThread] = useState<AssistantThreadDetail | null>(null);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [input, setInput] = useState("");
  const [streamText, setStreamText] = useState("");
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

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
    setInput("");
    Promise.all([
      client.createAssistantThread({ scope: { kind: "session", sessionRef } }),
      client.assistantStatus().catch(() => undefined),
    ])
      .then(async ([created, status]) => {
        const detail = await client.assistantThread(created.id);
        if (cancelled) return;
        setThread(detail);
        setTurns(detail.turns);
        setCanWrite(Boolean(status?.canWrite));
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
  }, [client, sessionRef]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [turns, streamText]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
      setInput("");
      setStreamText("");
      try {
        const accepted = await client.sendAssistantMessage(thread.thread.id, {
          text: question,
        });
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
            if (event.type === "done" || event.type === "action") {
              setTurns((current) => addTurn(current, event.turn));
              setStreamText("");
              setRunId(undefined);
              return;
            }
            setError(event.message);
            setStreamText("");
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
    [busy, client, pending, resync, runId, thread],
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
    void resync();
  }, [client, resync, runId]);

  const decide = useCallback(
    async (turn: AssistantTurn, decision: "confirm" | "cancel", text?: string) => {
      if (!thread) return;
      try {
        const updated = await client.decideAssistantAction(
          thread.thread.id,
          turn.id,
          { decision, ...(text ? { text } : {}) },
        );
        setTurns((current) =>
          current.map((entry) => (entry.id === updated.id ? updated : entry)),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "The action failed");
        void resync();
      }
    },
    [client, resync, thread],
  );

  const disabled = turns.length === 0 && !streamText && !runId;

  return (
    <aside
      className="assistant-dock"
      id="session-assistant"
      aria-label={`Assistant for ${sessionTitle}`}
    >
      <header className="assistant-head">
        <div className="assistant-head-title">
          <span className="assistant-mark" aria-hidden="true">
            <Icon name="bot" size={16} />
          </span>
          <div>
            <h2>Assistant</h2>
            <p>{sessionTitle}</p>
          </div>
        </div>
        <div className="assistant-head-actions">
          <span className="assistant-scope">This session</span>
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

        {turns.map((turn) => (
          <article
            key={turn.id}
            className={`assistant-turn ${turn.role}`}
            aria-label={turn.role === "user" ? "Your question" : "Assistant answer"}
          >
            <div className="assistant-turn-role">
              {turn.role === "user" ? "You" : "Assistant"}
              {turn.error ? <span className="assistant-turn-error"> · {turn.error}</span> : null}
            </div>
            {turn.text || turn.error ? (
              <div className="assistant-turn-text">{turn.text}</div>
            ) : turn.action ? null : (
              <div className="assistant-turn-text">…</div>
            )}
            <TurnMeta turn={turn} />
            {turn.action ? (
              <ActionCard turn={turn} canWrite={canWrite} onDecide={decide} />
            ) : null}
          </article>
        ))}

        {runId ? (
          <article className="assistant-turn assistant" aria-label="Assistant is answering">
            <div className="assistant-turn-role">Assistant</div>
            <div className="assistant-turn-text">
              {streamText || <span className="assistant-waiting">Reading…</span>}
              <span className="assistant-caret" aria-hidden="true" />
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
        <span className="assistant-readonly">
          {canWrite ? "Writes need your confirmation" : "Read-only · no writes"}
        </span>
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
            onChange={(event) => setInput(event.target.value)}
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
      </footer>
    </aside>
  );
}

/** SSE replay can resend a turn; keep one row per id. */
function addTurn(current: AssistantTurn[], turn: AssistantTurn): AssistantTurn[] {
  return current.some((entry) => entry.id === turn.id)
    ? current
    : [...current, turn];
}

function TurnMeta({ turn }: { turn: AssistantTurn }) {
  const parts: string[] = [];
  if (turn.context) {
    const { messages, omitted, attention } = turn.context;
    parts.push(`Read ${messages} ${messages === 1 ? "turn" : "turns"}`);
    if (omitted > 0) parts.push(`${omitted} older omitted`);
    if (attention > 0) {
      parts.push(`${attention} attention ${attention === 1 ? "item" : "items"}`);
    }
  }
  if (turn.usage) {
    parts.push(
      `${turn.usage.promptTokens} in · ${turn.usage.completionTokens} out`,
    );
  }
  if (parts.length === 0) return null;
  return <div className="assistant-turn-meta">{parts.join(" · ")}</div>;
}

function ActionCard({
  turn,
  canWrite,
  onDecide,
}: {
  turn: AssistantTurn;
  canWrite: boolean;
  onDecide: (
    turn: AssistantTurn,
    decision: "confirm" | "cancel",
    text?: string,
  ) => Promise<void>;
}) {
  const action = turn.action;
  const [text, setText] = useState(action?.text ?? "");
  const [saving, setSaving] = useState(false);
  if (!action) return null;

  const pending = action.status === "pending";
  const working = action.status === "deciding";
  const decide = async (decision: "confirm" | "cancel") => {
    setSaving(true);
    try {
      await onDecide(turn, decision, decision === "confirm" ? text : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`assistant-action ${action.status}`}
      role="group"
      aria-label="Proposed action"
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

      {action.kind === "send" ? (
        pending ? (
          <>
            <label className="sr-only" htmlFor={`action-${action.id}`}>
              Message to send
            </label>
            <textarea
              id={`action-${action.id}`}
              className="assistant-action-text"
              value={text}
              rows={3}
              maxLength={4_000}
              onChange={(event) => setText(event.target.value)}
            />
          </>
        ) : (
          <p className="assistant-action-value">{action.text}</p>
        )
      ) : null}

      {action.kind === "answer" ? (
        <p className="assistant-action-value">{action.text}</p>
      ) : null}

      {action.error ? (
        <p className="assistant-action-error">{action.error}</p>
      ) : null}

      {working ? (
        <p className="assistant-action-error">Working…</p>
      ) : null}

      {pending ? (
        <div className="assistant-action-buttons">
          {canWrite ? (
            <button
              className="btn small primary"
              type="button"
              disabled={saving || (action.kind === "send" && text.trim().length === 0)}
              onClick={() => void decide("confirm")}
            >
              {saving ? "Working…" : ACTION_LABEL[action.kind]}
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

function actionLabel(action: AssistantAction): string {
  if (action.status === "done") {
    if (action.kind === "send") return "Sent";
    if (action.kind === "answer") return "Answered";
    return "Stopped";
  }
  if (action.status === "cancelled") return "Cancelled";
  if (action.status === "failed") return "Failed";
  if (action.status === "deciding") return "Working…";
  return "Pending";
}
