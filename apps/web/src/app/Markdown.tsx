import {
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import type { HubClient } from "@amoshydra/oktoso-client";
import { downloadAttachment } from "./download";
import { renderMarkdown } from "./markdown";
import {
  getMermaidTheme,
  renderMermaidIn,
  subscribeMermaidTheme,
} from "./mermaid";
import type { ResourceContext } from "./urls";

export function Markdown(props: {
  text: string;
  client: HubClient;
  resource: ResourceContext;
  headingOffset?: number;
  onPreviewFile?: (path: string) => void;
}) {
  const html = useMemo(
    () =>
      renderMarkdown(props.text, props.resource, {
        headingOffset: props.headingOffset,
      }),
    [
      props.text,
      props.headingOffset,
      props.resource.baseUrl,
      props.resource.providerID,
      props.resource.providerType,
      props.resource.directory,
      props.resource.sessionRef,
      props.resource.fileRead,
    ],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const providerID = props.resource.providerID;
  const theme = useSyncExternalStore(
    subscribeMermaidTheme,
    getMermaidTheme,
    () => "dark" as const,
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;
    // Wait for a pause in streaming before parsing diagrams; an incomplete
    // fence fails and would otherwise re-render on every delta.
    const timer = window.setTimeout(() => {
      void renderMermaidIn(container, { cancelled: () => cancelled });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [html, theme]);

  useEffect(() => {
    const container = containerRef.current;
    const sessionRef = props.resource.sessionRef;
    if (!container || !sessionRef) return;
    let cancelled = false;
    // Media elements cannot send the hub token: swap the session path for a
    // short-lived ticket URL that the preview route serves with ranges.
    const elements = Array.from(
      container.querySelectorAll<HTMLElement>("[data-preview-path]"),
    );
    for (const element of elements) {
      const path = element.getAttribute("data-preview-path");
      if (!path || element.getAttribute("src")) continue;
      void props.client
        .previewTicket(sessionRef, path)
        .then((ticket) => {
          if (!cancelled && element.isConnected) {
            element.setAttribute("src", ticket.url);
          }
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [html, props.client, props.resource.sessionRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !providerID) return;
    let cancelled = false;
    const created: string[] = [];
    const images = Array.from(
      container.querySelectorAll<HTMLImageElement>("img[data-attachment-url]"),
    );

    for (const image of images) {
      const target = image.dataset.attachmentUrl;
      if (!target) continue;
      void props.client
        .attachment(providerID, target)
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          image.addEventListener(
            "error",
            () => {
              if (cancelled) return;
              const fallback = document.createElement("span");
              fallback.className = "message-image-missing";
              fallback.textContent = image.alt?.trim() || "Image unavailable";
              image.replaceWith(fallback);
            },
            { once: true },
          );
          image.src = url;
          image.removeAttribute("data-attachment-url");
        })
        .catch(() => {
          if (cancelled) return;
          const fallback = document.createElement("span");
          fallback.className = "message-image-missing";
          fallback.textContent = image.alt?.trim() || "Image unavailable";
          image.replaceWith(fallback);
        });
    }

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [html, props.client, providerID]);

  return (
    <div
      className="message-markdown"
      ref={containerRef}
      onClick={(event) => {
        const mention = (event.target as HTMLElement).closest(
          "button[data-file-path]",
        );
        if (mention instanceof HTMLButtonElement) {
          event.preventDefault();
          const path = mention.dataset.filePath;
          if (path) props.onPreviewFile?.(path);
          return;
        }

        const anchor = (event.target as HTMLElement).closest(
          "a[data-attachment-url]",
        );
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const target = anchor.dataset.attachmentUrl;
        if (!target || !providerID) return;
        event.preventDefault();
        void downloadAttachment(
          props.client,
          providerID,
          target,
          anchor.dataset.attachmentName ?? "attachment",
        ).catch(() => {
          const href = anchor.getAttribute("href");
          if (href) window.open(href, "_blank", "noopener,noreferrer");
        });
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
