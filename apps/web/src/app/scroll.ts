import { useEffect, useRef, type RefObject } from "react";
import { useHistoryLocation, useNavigationType } from "./history";
import {
  readScroll,
  registerScrollReader,
  writeScroll,
} from "./scroll-store";

export function hasSavedScroll(name: string): boolean {
  const state = window.history.state as { key?: string } | null;
  if (!state || typeof state.key !== "string") return false;
  return readScroll(state.key, name) !== undefined;
}

/**
 * Restore an inner scroll region on back/forward and keep the current entry's
 * offset in session storage.
 *
 * Pass `ready = false` while the region is still loading. The hook waits for
 * the content to mount before restoring so the saved offset is still valid.
 */
export function useScrollRestoration(
  ref: RefObject<HTMLElement | null>,
  name: string,
  ready = true,
): void {
  const { key } = useHistoryLocation();
  const navigationType = useNavigationType();
  const activeKey = useRef<string | undefined>(undefined);
  const lastValue = useRef(0);

  useEffect(() => {
    if (!ready) {
      activeKey.current = undefined;
      return;
    }
    const element = ref.current;
    if (!element) return;

    const saved = readScroll(key, name);
    if (
      (navigationType === "pop" || navigationType === "initial") &&
      saved !== undefined
    ) {
      element.scrollTop = saved;
      lastValue.current = saved;
    } else {
      lastValue.current = element.scrollTop;
    }
    activeKey.current = key;
  }, [ready, key, name, navigationType, ref]);

  useEffect(() => {
    const save = () => {
      const element = ref.current;
      if (!element || !activeKey.current) return;
      lastValue.current = element.scrollTop;
      writeScroll(activeKey.current, name, lastValue.current);
    };

    const element = ref.current;
    const unregister = registerScrollReader(save);
    let frame = 0;
    const onScroll = () => {
      const region = ref.current;
      if (!region) return;
      lastValue.current = region.scrollTop;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!activeKey.current) return;
        writeScroll(activeKey.current, name, lastValue.current);
      });
    };

    element?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      unregister();
      element?.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [name, ref]);
}
