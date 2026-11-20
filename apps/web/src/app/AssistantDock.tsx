import { useCallback, useEffect, useRef, useState } from "react";
import type { HubClient } from "@amoshydra/oktoso-client";
import type {
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
  "Draft a reply to this session",
];

/**
 * Session-scope hub assistant (M1).
 *
 * Read-only and context-injected: the hub assembles the session context and
 * makes one completion. The dock never sends, approves, or interrupts.
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const streamAbort = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    client
      .createAssistantThread({ scope: { kind: "session", sessionRef } })
      .then((created) => client.assistantThread(created.id))
      .then((detail) => {
        if (cancelled) return;
        setThread(detail);
        setTurns(detail.turns);
        textareaRef.current?.focus();
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

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || !thread || runId || busy) return;
      setError(undefined);
      setInput("");
      setStreamText("");
      try {
        const accepted = await client.sendAssistantMessage(thread.thread.id, {
          text: question,
        });
        setTurns((current) => [...current, accepted.turn]);
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
            if (event.type === "done") {
              setTurns((current) => [...current, event.turn]);
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
      }
    },
    [busy, client, resync, runId, thread],
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

  const disabled = turns.length === 0;

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
            <div className="assistant-turn-text">{turn.text || (turn.error ? "" : "…")}</div>
            {turn.usage ? (
              <div className="assistant-turn-meta">
                {turn.usage.promptTokens} in · {turn.usage.completionTokens} out
              </div>
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
        <span className="assistant-readonly">Read-only · no writes</span>
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
            disabled={busy}
            placeholder={busy ? "Reading this session…" : "Ask about this session…"}
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
              disabled={input.trim().length === 0 || busy}
            >
              Ask
            </button>
          )}
        </form>
      </footer>
    </aside>
  );
}
