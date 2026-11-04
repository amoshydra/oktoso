const MAX_ENTRIES = 30;
const entries = new Map<string, Map<string, unknown>>();

function entry(key: string): Map<string, unknown> {
  const existing = entries.get(key);
  if (existing) {
    entries.delete(key);
    entries.set(key, existing);
    return existing;
  }
  const created = new Map<string, unknown>();
  entries.set(key, created);
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return created;
}

export function readRouteCache<T>(key: string, name: string): T | undefined {
  return entries.get(key)?.get(name) as T | undefined;
}

export function writeRouteCache<T>(
  key: string,
  name: string,
  value: T,
): void {
  entry(key).set(name, value);
}
