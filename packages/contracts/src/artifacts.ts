import type { Message, MessagePart } from "./messages";

/** Tools whose input path names a concrete file the session touched. */
const ARTIFACT_TOOLS = new Set(["write", "edit", "read"]);

function pathValue(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of ["path", "filePath", "file"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * The exact file a tool operated on, independent of where it lives.
 *
 * Only write/edit/read count. Shell commands, searches, and prose mentions are
 * not artifacts: they may name any path without the agent having touched it.
 */
export function artifactPathFromToolPart(
  part: MessagePart,
): string | undefined {
  if (part.type !== "tool") return undefined;
  if (!ARTIFACT_TOOLS.has(part.name.toLowerCase())) return undefined;
  return pathValue(part.input);
}

function normalizePosix(value: string): string | undefined {
  const parts = value.replace(/\\/g, "/").split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return undefined;
      out.pop();
      continue;
    }
    out.push(part);
  }
  return out.length > 0 ? `/${out.join("/")}` : undefined;
}

/**
 * Resolve a tool path to the absolute provider path.
 *
 * Absolute paths win; a relative path is joined to the session directory. The
 * result is normalized, so `notes/../plan.md` and `//notes//plan.md` collapse
 * predictably. The caller still decides whether the result is in an allowed
 * root or is a recorded artifact.
 */
export function resolveArtifactPath(
  directory: string | undefined,
  raw: string,
): string | undefined {
  const value = raw.trim().replace(/\\/g, "/");
  if (!value) return undefined;
  if (value.startsWith("/")) return normalizePosix(value);
  if (!directory) return undefined;
  return normalizePosix(`${directory.replace(/\/+$/, "")}/${value}`);
}

/** Every distinct absolute path named by a write/edit/read tool part. */
export function artifactPathsFromMessages(
  messages: readonly Message[],
  directory: string | undefined,
): string[] {
  const paths = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      const raw = artifactPathFromToolPart(part);
      if (!raw) continue;
      const absolute = resolveArtifactPath(directory, raw);
      if (absolute) paths.add(absolute);
    }
  }
  return [...paths];
}
