import { PREVIEW_EXTENSIONS } from "./file-preview";
import { resolveArtifactPath } from "@amoshydra/oktoso-contracts";

const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;
const FILE_EXTENSION =
  /\.(?:md|markdown|txt|json|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|c|cc|cpp|h|hpp|css|scss|sass|html|htm|xml|sh|bash|zsh|fish|sql|png|jpe?g|gif|webp|avif|svg|pdf|zip|tar|gz|mp3|wav|mp4|webm|mov)(?:[?#]|$)/i;

export interface ResourceContext {
  baseUrl?: string;
  providerID?: string;
  providerType?: string;
  directory?: string;
  /** Session the transcript belongs to; used for session-scoped file reads. */
  sessionRef?: string;
  /** True when the provider exposes files in the session directory. */
  fileRead?: boolean;
  /** Provider roots the session may preview (project/worktrees/config). */
  previewRoots?: string[];
  /** Exact absolute paths from write/edit/read tool parts. */
  artifactPaths?: string[];
}

/**
 * Recognize a file mention that the session preview can open.
 *
 * Files inside the session directory qualify, as do absolute paths under a
 * provider root or exactly matching a recorded tool artifact. URL-like values,
 * whitespace, escaping relative paths, and unknown extensions stay plain code
 * so a command or a domain name never turns into a broken preview.
 */
export function previewableFilePath(
  value: string | undefined,
  directory?: string,
  previewRoots: readonly string[] = [],
  artifactPaths: readonly string[] = [],
): string | undefined {
  const raw = value?.trim();
  if (!raw || /\s/.test(raw)) return undefined;
  if (raw.startsWith("#") || raw.startsWith("//")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined;

  const root = directory?.trim().replace(/\/+$/, "");
  let path = (raw.split(/[?#]/, 1)[0] ?? raw).replace(/^\.\//, "");
  if (path.startsWith("/")) {
    const resolved = resolveArtifactPath(undefined, path);
    if (!resolved) return undefined;
    const inSession =
      Boolean(root) && (resolved === root || resolved.startsWith(`${root}/`));
    if (!inSession) {
      const inRoot = previewRoots.some((candidate) => {
        const clean = candidate.replace(/\/+$/, "");
        return resolved === clean || resolved.startsWith(`${clean}/`);
      });
      if (!inRoot && !artifactPaths.includes(resolved)) return undefined;
      path = resolved;
    } else {
      path = resolved.slice((root as string).length + 1);
    }
  } else if (path.split(/[\\/]/).includes("..")) {
    return undefined;
  }

  const name = path.split(/[\\/]/).at(-1) ?? path;
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return undefined;

  const extension = name.slice(dot + 1).toLowerCase();
  return PREVIEW_EXTENSIONS.has(extension) ? path : undefined;
}

export interface ResolvedResource {
  url?: string;
  sessionPath?: string;
  attachment: boolean;
}

/**
 * A session file path for Markdown media and links.
 *
 * Relative paths stay anchored to the session. Absolute paths are accepted
 * only under a provider root or when they exactly match a recorded artifact;
 * the hub revalidates the same rule before reading. This is intentionally
 * separate from `previewableFilePath`, which also filters preview extensions.
 */
export function sessionPathForResource(
  value: string | undefined,
  context: ResourceContext,
): string | undefined {
  const raw = value?.trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("//")) return undefined;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return undefined;

  const path = (raw.split(/[?#]/, 1)[0] ?? raw).replace(/^\.\//, "");
  if (path.startsWith("/")) {
    const absolute = resolveArtifactPath(undefined, path);
    if (!absolute) return undefined;
    const root = context.directory?.trim().replace(/\/+$/, "");
    const inSession =
      Boolean(root) && (absolute === root || absolute.startsWith(`${root}/`));
    if (inSession) return absolute;
    const inRoot = context.previewRoots?.some((candidate) => {
      const clean = candidate.replace(/\/+$/, "");
      return absolute === clean || absolute.startsWith(`${clean}/`);
    });
    if (inRoot || context.artifactPaths?.includes(absolute)) return absolute;
    return undefined;
  }
  if (path.split(/[\\/]/).includes("..")) return undefined;
  return path;
}

export interface SessionFileTarget {
  ref: string;
  path: string;
}

/**
 * A message resource that maps back to a file in the session directory.
 *
 * Markdown media carries the session path, so the browser can play it through
 * a preview ticket instead of a token-authenticated blob. A provider URL or a
 * data URL has no path here and stays on the blob path.
 */
export function sessionFileTarget(
  value: string | undefined,
  context: ResourceContext,
): SessionFileTarget | undefined {
  if (!context.sessionRef || !context.fileRead) return undefined;
  const path = previewableFilePath(
    value,
    context.directory,
    context.previewRoots,
    context.artifactPaths,
  );
  return path ? { ref: context.sessionRef, path } : undefined;
}

export function attachmentProxyPath(
  providerID: string,
  url: string,
): string {
  return `/api/v1/attachments?provider=${encodeURIComponent(providerID)}&url=${encodeURIComponent(url)}`;
}

/**
 * Resolve a provider message resource.
 *
 * OpenCode writes relative file references (`docs/spec.md`, images, etc.)
 * against the session directory. Those are served by `/api/fs/read/...`, not
 * by the provider origin root.
 */
export function resolveSessionResource(
  value: string | undefined,
  context: ResourceContext,
  kind: "link" | "image",
): ResolvedResource {
  const raw = value?.trim();
  if (!raw) return { attachment: false };

  if (
    context.providerType === "opencode" &&
    context.directory &&
    context.fileRead &&
    isOpenCodeFileReference(raw, kind)
  ) {
    const sessionPath = sessionPathForResource(raw, context);
    return sessionPath
      ? { sessionPath, attachment: true }
      : { attachment: false };
  }

  const url = resolveProviderUrl(raw, context.baseUrl, kind);
  if (!url) return { attachment: false };

  const providerHosted = isProviderResource(url, context.baseUrl);
  return {
    url,
    attachment:
      providerHosted &&
      (kind === "image" || FILE_EXTENSION.test(raw.split(/[?#]/, 1)[0] ?? raw)),
  };
}

function isOpenCodeFileReference(raw: string, kind: "link" | "image"): boolean {
  if (
    raw.startsWith("#") ||
    raw.startsWith("/api/") ||
    raw.startsWith("/session/") ||
    raw.startsWith("//")
  ) {
    return false;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return false;
  if (kind === "image") return true;
  const path = raw.split(/[?#]/, 1)[0] ?? raw;
  return FILE_EXTENSION.test(path) || raw.startsWith("./") || raw.startsWith("../");
}

/**
 * Resolve a provider-relative link against the provider base URL.
 *
 * Markdown written by an agent often uses paths such as `/session/abc` or
 * `./file.ts`. The browser would otherwise resolve those against the hub
 * origin, which is never where the provider serves them.
 */
export function isProviderResource(
  value: string | undefined,
  baseUrl: string | undefined,
): boolean {
  if (!value || !baseUrl) return false;
  try {
    const target = new URL(value);
    const base = new URL(baseUrl);
    return (
      (target.protocol === "http:" || target.protocol === "https:") &&
      target.origin === base.origin
    );
  } catch {
    return false;
  }
}

export function resolveProviderUrl(
  value: string | undefined,
  baseUrl: string | undefined,
  kind: "link" | "image" = "link",
): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;

  if (raw.startsWith("#")) {
    return kind === "link" ? raw : undefined;
  }

  let absolute: URL | undefined;
  try {
    absolute = new URL(raw);
  } catch {
    absolute = undefined;
  }

  if (absolute) {
    if (absolute.protocol === "http:" || absolute.protocol === "https:") {
      return absolute.toString();
    }
    if (kind === "link" && LINK_PROTOCOLS.has(absolute.protocol)) {
      return absolute.toString();
    }
    if (kind === "image" && absolute.protocol === "data:" && IMAGE_DATA.test(raw)) {
      return raw;
    }
    return undefined;
  }

  const base = baseUrl?.trim();
  if (!base) return undefined;

  try {
    const resolved = new URL(raw, base);
    return resolved.protocol === "http:" || resolved.protocol === "https:"
      ? resolved.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
