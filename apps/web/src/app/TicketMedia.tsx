import { useCallback, useEffect, useRef, useState } from "react";
import type { HubClient } from "@amoshydra/oktoso-client";

/**
 * Video or audio served through a preview ticket.
 *
 * The element cannot send the hub token, so it plays a ticket URL and the
 * browser streams it with `Range` requests. A ticket lives for ten minutes,
 * which a paused video can outlast; when the element errors it mints a fresh
 * ticket and resumes at the same position.
 */
export function TicketMedia(props: {
  client: HubClient;
  sessionRef: string;
  path: string;
  kind: "video" | "audio";
  className: string;
  initialSrc?: string;
}) {
  const [src, setSrc] = useState<string | undefined>(props.initialSrc);
  const [failed, setFailed] = useState(false);
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const renewals = useRef(0);
  const resume = useRef<{ at: number; playing: boolean } | undefined>(undefined);

  useEffect(() => {
    if (props.initialSrc) {
      setSrc(props.initialSrc);
      setFailed(false);
      renewals.current = 0;
      return;
    }
    let cancelled = false;
    renewals.current = 0;
    setSrc(undefined);
    setFailed(false);
    void props.client
      .previewTicket(props.sessionRef, props.path)
      .then((ticket) => {
        if (!cancelled) setSrc(ticket.url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.initialSrc, props.path, props.sessionRef]);

  const attach = useCallback((element: HTMLMediaElement | null) => {
    mediaRef.current = element;
  }, []);

  /** The ticket expired or the stream dropped: renew at the same position. */
  const renewTicket = () => {
    if (renewals.current >= 2) {
      setFailed(true);
      return;
    }
    renewals.current += 1;
    const media = mediaRef.current;
    resume.current = media
      ? { at: media.currentTime, playing: !media.paused }
      : undefined;
    void props.client
      .previewTicket(props.sessionRef, props.path)
      .then((ticket) => setSrc(ticket.url))
      .catch(() => setFailed(true));
  };

  const resumePlayback = () => {
    const media = mediaRef.current;
    const pending = resume.current;
    resume.current = undefined;
    if (!media || !pending) return;
    // The reload succeeded, so a later expiry may renew again.
    renewals.current = 0;
    if (pending.at > 0) media.currentTime = pending.at;
    if (pending.playing) void media.play().catch(() => undefined);
  };

  if (failed) {
    return (
      <div className="message-file-meta" role="alert">
        This media could not be loaded.
      </div>
    );
  }
  if (!src) {
    return <div className="message-file-meta">Loading media…</div>;
  }

  return props.kind === "video" ? (
    <video
      className={props.className}
      ref={attach}
      src={src}
      controls
      playsInline
      preload="metadata"
      onError={renewTicket}
      onLoadedMetadata={resumePlayback}
    />
  ) : (
    <audio
      className={props.className}
      ref={attach}
      src={src}
      controls
      preload="metadata"
      onError={renewTicket}
      onLoadedMetadata={resumePlayback}
    />
  );
}

