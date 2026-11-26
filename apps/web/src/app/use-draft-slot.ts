import { useCallback, useEffect, useRef, useState } from "react";
import type { HubClient } from "@amoshydra/oktoso-client";

export type DraftSlotStatus = "idle" | "saving" | "saved" | "error";

export interface UseDraftSlotOptions {
  client: HubClient;
  /** Opaque draft key; disabled when empty. */
  key?: string;
  enabled?: boolean;
  debounceMs?: number;
  /** Called once after the slot loads. An empty string means no saved draft. */
  onLoad?: (text: string) => void;
}

/**
 * Persist an arbitrary text slot through the existing session-draft endpoint.
 *
 * The endpoint accepts an opaque key, so form drafts use namespaced keys such
 * as `draft:question:<id>` instead of a real session ref. This keeps one draft
 * per slot without a new storage schema.
 */
export function useDraftSlot(options: UseDraftSlotOptions) {
  const { client, key, enabled = true, debounceMs = 600 } = options;
  const [status, setStatus] = useState<DraftSlotStatus>("idle");
  const [loaded, setLoaded] = useState(false);
  const valueRef = useRef("");
  const lastSavedRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());
  const keyRef = useRef(key);
  keyRef.current = key;
  const onLoadRef = useRef(options.onLoad);
  onLoadRef.current = options.onLoad;

  const enqueue = useCallback(
    (slot: string, value: string): Promise<void> => {
      const request = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (value === "") {
            await client.deleteDraft(slot);
          } else {
            await client.saveDraft(slot, value);
          }
        });
      queueRef.current = request;
      return request;
    },
    [client],
  );

  const showSaved = useCallback(() => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatus("saved");
    statusTimerRef.current = setTimeout(() => {
      statusTimerRef.current = undefined;
      setStatus("idle");
    }, 2_000);
  }, []);

  const persist = useCallback(
    (slot: string, value: string) => {
      if (value === lastSavedRef.current) return;
      setStatus("saving");
      void enqueue(slot, value)
        .then(() => {
          if (keyRef.current !== slot) return;
          lastSavedRef.current = value === "" ? null : value;
          showSaved();
        })
        .catch(() => {
          if (keyRef.current === slot) setStatus("error");
        });
    },
    [enqueue, showSaved],
  );

  const save = useCallback(
    (value: string) => {
      if (!enabled || !key) return;
      revisionRef.current += 1;
      dirtyRef.current = true;
      valueRef.current = value;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = undefined;
      }
      setStatus("idle");
      if (value === lastSavedRef.current) return;
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        persist(key, value);
      }, debounceMs);
    },
    [debounceMs, enabled, key, persist],
  );

  const flush = useCallback(async () => {
    if (timerRef.current && key) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
      persist(key, valueRef.current);
    }
    await queueRef.current.catch(() => undefined);
  }, [key, persist]);

  const clear = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = undefined;
    }
    revisionRef.current += 1;
    dirtyRef.current = false;
    valueRef.current = "";
    lastSavedRef.current = null;
    if (!key) {
      setStatus("idle");
      return;
    }
    setStatus("saving");
    try {
      await enqueue(key, "");
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, [enqueue, key]);

  useEffect(() => {
    if (!enabled || !key) {
      setLoaded(false);
      setStatus("idle");
      return;
    }
    let cancelled = false;
    revisionRef.current = 0;
    dirtyRef.current = false;
    valueRef.current = "";
    lastSavedRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = undefined;
    }
    setStatus("idle");
    setLoaded(false);

    void client
      .draft(key)
      .then((saved) => {
        if (cancelled) return;
        setLoaded(true);
        if (dirtyRef.current || revisionRef.current > 0) return;
        lastSavedRef.current = saved ? saved.text : null;
        onLoadRef.current?.(saved?.text ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setLoaded(true);
        setStatus("error");
      });

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
        statusTimerRef.current = undefined;
      }
      if (valueRef.current !== lastSavedRef.current) {
        void enqueue(key, valueRef.current).catch(() => undefined);
      }
    };
  }, [client, enqueue, enabled, key]);

  return { status, loaded, save, clear, flush };
}

export function draftSlotStatusText(status: DraftSlotStatus): string {
  switch (status) {
    case "saving":
      return "Saving draft…";
    case "saved":
      return "Draft saved";
    case "error":
      return "Draft not saved";
    default:
      return "";
  }
}
