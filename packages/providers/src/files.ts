import { ProviderError } from "./errors";

const MAX_PATH_LENGTH = 1024;

/**
 * Normalize a session file path before it reaches a provider.
 *
 * The hub only reads files inside the session's working directory. Anything
 * absolute, escaping (`..`), Windows-separated, NUL-bearing, or overlong is
 * rejected instead of being resolved, so a client cannot turn the session file
 * endpoint into a host filesystem reader.
 */
export function normalizeSessionPath(value: string): string {
  const raw = value.trim();
  if (!raw) {
    throw new ProviderError("invalid_request", "A file path is required");
  }
  if (raw.length > MAX_PATH_LENGTH) {
    throw new ProviderError("invalid_request", "The file path is too long");
  }
  if (raw.includes("\0")) {
    throw new ProviderError("invalid_request", "The file path is invalid");
  }

  const slashed = raw.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[a-zA-Z]:\//.test(slashed)) {
    throw new ProviderError("invalid_request", "Absolute file paths are not allowed");
  }

  const segments = slashed.split("/").filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0) {
    throw new ProviderError("invalid_request", "A file path is required");
  }
  if (segments.some((segment) => segment === "..")) {
    throw new ProviderError(
      "invalid_request",
      "File paths cannot leave the session directory",
    );
  }

  return segments.join("/");
}

/**
 * Turn the path a provider reported into one relative to the session directory.
 *
 * Agents often write absolute paths (`/home/me/project/notes/plan.md`). Those
 * are accepted only when they sit inside the session directory; anything else is
 * still rejected, so the jail holds for both forms.
 */
export function isAbsoluteSessionPath(value: string): boolean {
  const slashed = value.trim().replace(/\\/g, "/");
  return slashed.startsWith("/") || /^[a-zA-Z]:\//.test(slashed);
}

export function relativeSessionPath(
  value: string,
  directory: string | undefined,
): string {
  const raw = value.trim();
  const slashed = raw.replace(/\\/g, "/");
  if (!isAbsoluteSessionPath(slashed)) return normalizeSessionPath(raw);

  const root = directory?.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root || !root.startsWith("/")) {
    throw new ProviderError(
      "invalid_request",
      "This session has no working directory for an absolute path",
    );
  }
  if (slashed === root || !slashed.startsWith(`${root}/`)) {
    throw new ProviderError(
      "invalid_request",
      "The file is outside the session directory",
    );
  }

  return normalizeSessionPath(slashed.slice(root.length + 1));
}
