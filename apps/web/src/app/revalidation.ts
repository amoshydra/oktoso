import { useEffect, useSyncExternalStore } from "react";

let activeCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function beginRevalidation(): void {
  activeCount += 1;
  emit();
}

export function endRevalidation(): void {
  activeCount = Math.max(0, activeCount - 1);
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Read the global revalidation state without re-rendering every route view. */
export function useRevalidationActive(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => activeCount > 0,
    () => false,
  );
}

/**
 * Mark a view's background refresh as active while `active` is true.
 *
 * Views call this with their cached-data refresh state; silent polls do not.
 * The topbar progress line subscribes to the same count.
 */
export function useRevalidationIndicator(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    beginRevalidation();
    return endRevalidation;
  }, [active]);
}
