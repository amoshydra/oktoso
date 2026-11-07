import type { SendInput } from "@amoshydra/oktoso-contracts";

export interface PendingSend {
  idempotencyKey: string;
  sessionRef: string;
  sessionTitle: string;
  payload: SendInput;
  createdAt: number;
}

export interface PendingStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STORAGE_KEY = "oktoso-g2-pending-sends";
const MAX_PENDING = 10;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

function browserStorage(): PendingStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function isPendingSend(value: unknown): value is PendingSend {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const payload = record.payload;
  return (
    typeof record.idempotencyKey === "string" &&
    typeof record.sessionRef === "string" &&
    typeof record.sessionTitle === "string" &&
    typeof record.createdAt === "number" &&
    typeof payload === "object" &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).text === "string"
  );
}

export function loadPendingSends(
  storage: PendingStorage | undefined = browserStorage(),
): PendingSend[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter(isPendingSend)
      .filter((item) => now - item.createdAt < MAX_AGE_MS)
      .slice(-MAX_PENDING);
  } catch {
    return [];
  }
}

export function savePendingSends(
  items: readonly PendingSend[],
  storage: PendingStorage | undefined = browserStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-MAX_PENDING)));
  } catch {
    // Storage can be unavailable or full; sending must still work.
  }
}

export function rememberPendingSend(
  item: PendingSend,
  storage: PendingStorage | undefined = browserStorage(),
): PendingSend[] {
  const next = loadPendingSends(storage).filter(
    (existing) => existing.idempotencyKey !== item.idempotencyKey,
  );
  next.push(item);
  const capped = next.slice(-MAX_PENDING);
  savePendingSends(capped, storage);
  return capped;
}

export function forgetPendingSend(
  idempotencyKey: string,
  storage: PendingStorage | undefined = browserStorage(),
): PendingSend[] {
  const next = loadPendingSends(storage).filter(
    (item) => item.idempotencyKey !== idempotencyKey,
  );
  savePendingSends(next, storage);
  return next;
}
