const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;
const FILE_EXTENSION =
  /\.(?:md|markdown|txt|json|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|c|cc|cpp|h|hpp|css|scss|sass|html|htm|xml|sh|bash|zsh|fish|sql|png|jpe?g|gif|webp|avif|svg|pdf|zip|tar|gz|mp3|wav|mp4|webm|mov)(?:[?#]|$)/i;

export interface ResourceContext {
  baseUrl?: string;
  providerID?: string;
  providerType?: string;
  directory?: string;
}

export interface ResolvedResource {
  url?: string;
  attachment: boolean;
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
    context.baseUrl &&
    context.directory &&
    isOpenCodeFileReference(raw, kind)
  ) {
    const url = openCodeFileURL(raw, context.baseUrl, context.directory);
    if (url) return { url, attachment: true };
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

function openCodeFileURL(
  raw: string,
  baseUrl: string,
  directory: string,
): string | undefined {
  const path = (raw.split(/[?#]/, 1)[0] ?? raw).replace(/^\/+/, "");
  if (!path) return undefined;

  try {
    const encodedPath = path
      .split("/")
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const url = new URL(`/api/fs/read/${encodedPath}`, baseUrl);
    url.searchParams.set("location[directory]", directory);
    return url.toString();
  } catch {
    return undefined;
  }
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
