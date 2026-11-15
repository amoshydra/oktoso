import DOMPurify from "dompurify";

type MermaidApi = typeof import("mermaid")["default"];

let loader: Promise<MermaidApi> | undefined;
let configuredTheme = "";
let sequence = 0;

const themeListeners = new Set<() => void>();
let themeObserver: MutationObserver | undefined;

function readToken(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  return value || fallback;
}

function themeName(): "dark" | "light" {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

async function loadMermaid(): Promise<MermaidApi> {
  loader ??= import("mermaid").then((module) => module.default);
  const mermaid = await loader;
  const theme = themeName();
  if (configuredTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "base",
      look: "classic",
      htmlLabels: false,
      fontFamily: readToken("--font-ui", "Inter, sans-serif"),
      fontSize: 14,
      themeVariables: {
        background: readToken("--surface", "#16191f"),
        primaryColor: readToken("--surface-3", "#272c36"),
        primaryTextColor: readToken("--text", "#f4f6f9"),
        primaryBorderColor: readToken("--border-strong", "#5f6878"),
        lineColor: readToken("--muted", "#b5bcc8"),
        secondaryColor: readToken("--surface-2", "#1d2129"),
        tertiaryColor: readToken("--surface-2", "#1d2129"),
        textColor: readToken("--text", "#f4f6f9"),
        mainBkg: readToken("--surface-3", "#272c36"),
        nodeBorder: readToken("--border-strong", "#5f6878"),
        clusterBkg: readToken("--surface", "#16191f"),
        clusterBorder: readToken("--border", "#3f4652"),
        edgeLabelBackground: readToken("--surface-2", "#1d2129"),
        titleColor: readToken("--text", "#f4f6f9"),
        nodeTextColor: readToken("--text", "#f4f6f9"),
        actorBkg: readToken("--surface-2", "#1d2129"),
        actorBorder: readToken("--border-strong", "#5f6878"),
        actorTextColor: readToken("--text", "#f4f6f9"),
        signalColor: readToken("--muted", "#b5bcc8"),
        signalTextColor: readToken("--muted", "#b5bcc8"),
        labelBoxBkgColor: readToken("--surface-2", "#1d2129"),
        labelBoxBorderColor: readToken("--border", "#3f4652"),
        labelTextColor: readToken("--text", "#f4f6f9"),
        loopTextColor: readToken("--text", "#f4f6f9"),
        noteBkgColor: readToken("--surface-3", "#272c36"),
        noteBorderColor: readToken("--border-strong", "#5f6878"),
        noteTextColor: readToken("--text", "#f4f6f9"),
      },
      flowchart: { useMaxWidth: false, curve: "basis", wrappingWidth: 220 },
    });
    configuredTheme = theme;
  }
  return mermaid;
}

export function getMermaidTheme(): "dark" | "light" {
  return themeName();
}

export function subscribeMermaidTheme(listener: () => void): () => void {
  if (!themeObserver) {
    themeObserver = new MutationObserver(() => {
      for (const item of themeListeners) item();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
  }
  themeListeners.add(listener);
  return () => {
    themeListeners.delete(listener);
    if (themeListeners.size === 0) {
      themeObserver?.disconnect();
      themeObserver = undefined;
    }
  };
}

export async function renderMermaidIn(
  container: HTMLElement,
  options: { cancelled?: () => boolean } = {},
): Promise<void> {
  const blocks = Array.from(
    container.querySelectorAll<HTMLElement>(".mermaid-block"),
  );
  if (blocks.length === 0) return;

  const mermaid = await loadMermaid();
  const theme = themeName();

  for (const block of blocks) {
    if (options.cancelled?.()) return;
    const source = block
      .querySelector<HTMLElement>(".mermaid-source code")
      ?.textContent?.trim();
    if (!source) continue;
    if (
      block.dataset.rendered === "true" &&
      block.dataset.mermaidTheme === theme
    ) {
      continue;
    }

    const target = block.querySelector<HTMLElement>(".mermaid-diagram");
    if (!target) continue;

    try {
      const id = `mermaid-${++sequence}`;
      const { svg } = await mermaid.render(id, source);
      if (options.cancelled?.()) return;
      block.dataset.rendered = "true";
      block.dataset.mermaidTheme = theme;
      target.innerHTML = DOMPurify.sanitize(svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });
      if (target.scrollWidth > target.clientWidth + 4) {
        block.dataset.overflow = "true";
      } else {
        delete block.dataset.overflow;
      }
      delete block.dataset.error;
    } catch {
      delete block.dataset.rendered;
      delete block.dataset.overflow;
      block.dataset.error = "true";
      target.replaceChildren();
    }
  }
}
