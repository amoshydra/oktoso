import type { Session } from "@amoshydra/oktoso-contracts";

const STORAGE_KEY = "oktoso-sessions-cache-v1";
const SESSION_KEY = "oktoso-session-cache-v1";
const MAX_SESSIONS = 10;

export interface CachedSessionList {
  savedAt: number;
  sessions: Session[];
  cursor: string | null;
}

/** The last successfully loaded first page, so a cold offline load has data. */
export function readSessionsCache(): CachedSessionList | undefined {
  const storage = getStorage();
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const value = parsed as Record<string, unknown>;
    if (
      typeof value.savedAt !== "number" ||
      !Array.isArray(value.sessions) ||
      !value.sessions.every(isSession)
    ) {
      return undefined;
    }
    return {
      savedAt: value.savedAt,
      sessions: value.sessions,
      cursor: typeof value.cursor === "string" ? value.cursor : null,
    };
  } catch {
    return undefined;
  }
}

export function writeSessionsCache(value: {
  sessions: Session[];
  cursor: string | null;
}): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        sessions: value.sessions.slice(0, 50),
        cursor: value.cursor,
      }),
    );
  } catch {
    // Storage may be full or blocked; the live list still works.
  }
}

/** The last session header, so an offline reload can still render the chat. */
export function readSessionCache(ref: string): Session | undefined {
  const entries = readSessionEntries();
  const cached = entries[ref];
  return cached && isSession(cached.session) ? cached.session : undefined;
}

export function writeSessionCache(session: Session): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const entries = readSessionEntries();
    entries[session.ref] = { session, savedAt: Date.now() };
    const kept = Object.entries(entries)
      .sort(([, left], [, right]) => right.savedAt - left.savedAt)
      .slice(0, MAX_SESSIONS);
    storage.setItem(
      SESSION_KEY,
      JSON.stringify({ version: 1, entries: Object.fromEntries(kept) }),
    );
  } catch {
    // Ignore storage failures.
  }
}

/** Drop a deleted or not-found session so a stale header cannot keep rendering. */
export function removeSessionCache(ref: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const entries = readSessionEntries();
    if (ref in entries) {
      delete entries[ref];
      storage.setItem(
        SESSION_KEY,
        JSON.stringify({ version: 1, entries }),
      );
    }
    const list = readSessionsCache();
    if (list?.sessions.some((session) => session.ref === ref)) {
      writeSessionsCache({
        sessions: list.sessions.filter((session) => session.ref !== ref),
        cursor: list.cursor,
      });
    }
  } catch {
    // Ignore storage failures.
  }
}

function readSessionEntries(): Record<
  string,
  { session: Session; savedAt: number }
> {
  const storage = getStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed as { version?: unknown; entries?: unknown };
    if (value.version !== 1 || !value.entries || typeof value.entries !== "object") {
      return {};
    }
    return value.entries as Record<string, { session: Session; savedAt: number }>;
  } catch {
    return {};
  }
}

function getStorage(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.ref === "string" &&
    typeof item.providerID === "string" &&
    typeof item.title === "string" &&
    typeof item.status === "string" &&
    typeof item.updatedAt === "number"
  );
}
