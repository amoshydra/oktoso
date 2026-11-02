const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const IMAGE_DATA = /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i;

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
