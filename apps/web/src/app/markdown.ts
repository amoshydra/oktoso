import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  attachmentProxyPath,
  resolveSessionResource,
  type ResourceContext,
} from "./urls";

const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(text: string, context?: ResourceContext): string {
  const html = marked.parse(text, { async: false }) as string;
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button"],
  });

  if (typeof document === "undefined") return sanitized;

  const template = document.createElement("template");
  template.innerHTML = sanitized;

  for (const anchor of template.content.querySelectorAll("a")) {
    const resolved = resolveSessionResource(
      anchor.getAttribute("href") ?? undefined,
      context ?? {},
      "link",
    );
    if (!resolved.url) {
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
      continue;
    }

    if (resolved.attachment && context?.providerID) {
      anchor.setAttribute("href", attachmentProxyPath(context.providerID, resolved.url));
      anchor.setAttribute("data-attachment-url", resolved.url);
      anchor.setAttribute(
        "data-attachment-name",
        anchor.textContent?.trim() || "attachment",
      );
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
      continue;
    }

    anchor.setAttribute("href", resolved.url);
    if (resolved.url.startsWith("http:") || resolved.url.startsWith("https:")) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    } else {
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  }

  for (const image of template.content.querySelectorAll("img")) {
    const resolved = resolveSessionResource(
      image.getAttribute("src") ?? undefined,
      context ?? {},
      "image",
    );
    if (!resolved.url) {
      const fallback = document.createElement("span");
      fallback.className = "message-image-missing";
      fallback.textContent = image.getAttribute("alt")?.trim() || "Image unavailable";
      image.replaceWith(fallback);
      continue;
    }
    if (resolved.attachment) {
      image.setAttribute("data-attachment-url", resolved.url);
      image.setAttribute("src", TRANSPARENT_PIXEL);
    } else {
      image.setAttribute("src", resolved.url);
    }
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
  }

  return template.innerHTML;
}
