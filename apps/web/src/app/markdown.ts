import DOMPurify from "dompurify";
import { marked } from "marked";
import { isProviderResource, resolveProviderUrl } from "./urls";

const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(text: string, baseUrl?: string): string {
  const html = marked.parse(text, { async: false }) as string;
  const sanitized = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "script", "iframe", "object", "embed", "form", "input", "button"],
  });

  if (typeof document === "undefined") return sanitized;

  const template = document.createElement("template");
  template.innerHTML = sanitized;

  for (const anchor of template.content.querySelectorAll("a")) {
    const href = resolveProviderUrl(anchor.getAttribute("href") ?? undefined, baseUrl);
    if (!href) {
      anchor.removeAttribute("href");
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
      continue;
    }
    anchor.setAttribute("href", href);
    if (href.startsWith("http:") || href.startsWith("https:")) {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noopener noreferrer");
    } else {
      anchor.removeAttribute("target");
      anchor.removeAttribute("rel");
    }
  }

  for (const image of template.content.querySelectorAll("img")) {
    const src = resolveProviderUrl(
      image.getAttribute("src") ?? undefined,
      baseUrl,
      "image",
    );
    if (!src) {
      const fallback = document.createElement("span");
      fallback.className = "message-image-missing";
      fallback.textContent = image.getAttribute("alt")?.trim() || "Image unavailable";
      image.replaceWith(fallback);
      continue;
    }
    if (isProviderResource(src, baseUrl)) {
      image.setAttribute("data-attachment-url", src);
      image.setAttribute("src", TRANSPARENT_PIXEL);
    } else {
      image.setAttribute("src", src);
    }
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");
  }

  return template.innerHTML;
}
