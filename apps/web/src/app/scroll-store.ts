const PREFIX = "oktoso:scroll:";
const readers = new Set<() => void>();

function storageKey(entryKey: string, name: string): string {
  return `${PREFIX}${entryKey}:${name}`;
}

export function readScroll(
  entryKey: string,
  name: string,
): number | undefined {
  try {
    const value = sessionStorage.getItem(storageKey(entryKey, name));
    if (value === null) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function writeScroll(
  entryKey: string,
  name: string,
  value: number,
): void {
  try {
    sessionStorage.setItem(storageKey(entryKey, name), String(Math.max(0, value)));
  } catch {
    // Session storage can be unavailable in private or restricted browsers.
  }
}

export function registerScrollReader(reader: () => void): () => void {
  readers.add(reader);
  return () => {
    readers.delete(reader);
  };
}

/**
 * Persist every mounted scroll region before the history entry changes.
 *
 * Scroll events are throttled, so a fast scroll followed immediately by a
 * navigation can otherwise lose the last few pixels.
 */
export function saveActiveScrolls(): void {
  for (const reader of readers) reader();
}
