import { useEffect, useRef, useState } from "react";
import { HubError, type HubClient } from "@amoshydra/oktoso-client";
import { Markdown } from "./Markdown";
import { TicketMedia } from "./TicketMedia";
import { Icon } from "./Icon";
import {
  isTextPreview,
  previewKind,
  previewMaxBytes,
  previewMimeType,
  type PreviewKind,
} from "./file-preview";
import { trapTabKey } from "./focus";
import type { ResourceContext } from "./urls";

/**
 * Preview a file the transcript mentions, without leaving the chat.
 *
 * The body is the live file from the session directory, so a mention opens what
 * is on disk now rather than the snapshot a tool call reported. Text renders as
 * a document, images and media as themselves, HTML and PDF in a sandboxed frame.
 */
export function FilePreview(props: {
  path: string;
  client: HubClient;
  resource: ResourceContext;
  onClose: () => void;
  onPreviewFile?: (path: string) => void;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "text"; text: string; kind: PreviewKind }
    | { status: "media"; url: string; kind: PreviewKind }
    | { status: "error"; message: string }
  >({ status: "loading" });
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const previewRef = useRef<HTMLElement | null>(null);
  const onClose = useRef(props.onClose);
  onClose.current = props.onClose;

  const sessionRef = props.resource.sessionRef;
  const name = props.path.split(/[\\/]/).filter(Boolean).at(-1) ?? props.path;
  const kind =
    state.status === "text" || state.status === "media"
      ? state.kind
      : previewKind(props.path);

  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        // Keep the sheet's Escape from also closing the details panel behind it.
        event.stopPropagation();
        onClose.current();
        return;
      }
      trapTabKey(event, previewRef.current);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (!sessionRef) return;
    let cancelled = false;
    let objectURL: string | undefined;
    setState({ status: "loading" });

    // HTML needs a URL rooted in the session directory so its relative assets
    // (maps, styles, scripts) resolve. A ticket does that without the token.
    const loadFrame = async () => {
      const ticket = await props.client.previewTicket(sessionRef, props.path);
      if (!cancelled) {
        setState({ status: "media", url: ticket.url, kind: "html" });
      }
    };

    const load = async () => {
      const guessed = previewKind(props.path);
      if (guessed === "html") {
        await loadFrame();
        return;
      }
      // Video and audio stream through a short-lived, path-scoped ticket: a
      // media element cannot carry the bearer token, and a 100 MB blob is
      // worse than a ranged URL.
      if (guessed === "video" || guessed === "audio") {
        const ticket = await props.client.previewTicket(sessionRef, props.path);
        if (!cancelled) {
          setState({ status: "media", url: ticket.url, kind: guessed });
        }
        return;
      }

      const blob = await props.client.sessionFile(sessionRef, props.path);
      if (cancelled) return;
      const resolved = previewKind(props.path, blob.type);
      if (resolved === "html") {
        await loadFrame();
        return;
      }
      if (blob.size > previewMaxBytes(resolved)) {
        setState({ status: "error", message: "This file is too large to preview." });
        return;
      }

      if (isTextPreview(resolved)) {
        const text = await blob.text();
        if (!cancelled) setState({ status: "text", text, kind: resolved });
        return;
      }

      const typed =
        blob.type && blob.type !== "application/octet-stream"
          ? blob
          : new Blob([blob], { type: previewMimeType(props.path) });
      objectURL = URL.createObjectURL(typed);
      setState({ status: "media", url: objectURL, kind: resolved });
    };

    void load().catch((reason: unknown) => {
      if (cancelled) return;
      setState({ status: "error", message: previewErrorMessage(reason) });
    });

    return () => {
      cancelled = true;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [props.client, props.path, sessionRef]);

  return (
    <>
      <div className="file-preview-scrim" aria-hidden="true" onClick={props.onClose} />
      <section
        className={`file-preview ${kind === "text" || kind === "markdown" ? "" : "file-preview-media"}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-preview-title"
        ref={previewRef}
      >
        <header className="file-preview-head">
          <div className="file-preview-titles">
            <h2 className="file-preview-title" id="file-preview-title">
              {name}
            </h2>
            <span className="file-preview-path">{props.path}</span>
          </div>
          <button
            className="icon-btn"
            type="button"
            aria-label="Close preview"
            ref={closeRef}
            onClick={props.onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="file-preview-body">
          {state.status === "loading" ? (
            <div className="empty">Loading…</div>
          ) : state.status === "error" ? (
            <div className="alert" role="alert">
              {state.message}
            </div>
          ) : state.status === "text" ? (
            kind === "markdown" ? (
              <Markdown
                text={state.text}
                client={props.client}
                resource={props.resource}
                headingOffset={1}
                onPreviewFile={props.onPreviewFile}
              />
            ) : (
              <pre>{state.text}</pre>
            )
          ) : kind === "image" ? (
            <img className="file-preview-image" src={state.url} alt={name} />
          ) : kind === "video" ? (
            sessionRef ? (
              <TicketMedia
                client={props.client}
                sessionRef={sessionRef}
                path={props.path}
                kind="video"
                className="file-preview-video"
                initialSrc={state.url}
              />
            ) : (
              <video
                className="file-preview-video"
                src={state.url}
                controls
                playsInline
                preload="metadata"
              />
            )
          ) : kind === "audio" ? (
            sessionRef ? (
              <TicketMedia
                client={props.client}
                sessionRef={sessionRef}
                path={props.path}
                kind="audio"
                className="file-preview-audio"
                initialSrc={state.url}
              />
            ) : (
              <audio className="file-preview-audio" src={state.url} controls />
            )
          ) : (
            <iframe
              className="file-preview-frame"
              src={state.url}
              title={name}
              sandbox={kind === "html" ? "allow-scripts" : undefined}
            />
          )}
        </div>
      </section>
    </>
  );
}

function previewErrorMessage(reason: unknown): string {
  if (reason instanceof HubError) {
    if (reason.status === 404) {
      return "This file is not in the session directory.";
    }
    if (reason.status === 501) {
      return "This provider cannot preview files.";
    }
    if (reason.status === 400) {
      return "This path is outside the session directory.";
    }
  }
  return reason instanceof Error ? reason.message : "Unable to open this file.";
}
