import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_ROUTE, parseRoute, routeHref, type Route } from "./router";
import { saveActiveScrolls } from "./scroll-store";

export type NavigationType = "initial" | "push" | "replace" | "pop";

export interface NavigateOptions {
  replace?: boolean;
}

export interface HistoryLocation {
  route: Route;
  key: string;
  index: number;
  href: string;
}

interface HistoryEntryState {
  key?: string;
  index?: number;
}

interface HistoryContextValue {
  location: HistoryLocation;
  navigationType: NavigationType;
  navigate: (route: Route, options?: NavigateOptions) => void;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

function createKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function entryState(): HistoryEntryState {
  const state = window.history.state as HistoryEntryState | null;
  return state && typeof state === "object" ? state : {};
}

function currentEntry(): { key: string; index: number } {
  const state = entryState();
  return {
    key: typeof state.key === "string" ? state.key : createKey(),
    index: typeof state.index === "number" ? state.index : 0,
  };
}

function readLocation(): HistoryLocation {
  const route = parseRoute(window.location.pathname, window.location.search);
  const entry = currentEntry();
  return {
    route: route ?? DEFAULT_ROUTE,
    key: entry.key,
    index: entry.index,
    href: `${window.location.pathname}${window.location.search}`,
  };
}

/**
 * Prepare the current history entry before React mounts.
 *
 * Every entry gets a stable key for scroll restoration and an index so the
 * in-app back action can tell whether `history.back()` has a same-document
 * destination or must fall back to an explicit route.
 */
export function bootstrapBrowserHistory(): void {
  const parsed = parseRoute(window.location.pathname, window.location.search);
  const state = entryState();
  const key = typeof state.key === "string" ? state.key : createKey();
  const index = typeof state.index === "number" ? state.index : 0;

  if (!parsed) {
    window.history.replaceState({ key, index }, "", routeHref(DEFAULT_ROUTE));
  } else if (typeof state.key !== "string" || typeof state.index !== "number") {
    window.history.replaceState({ key, index }, "", window.location.href);
  }

  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
}

export function HistoryProvider(props: { children: ReactNode }) {
  const [location, setLocation] = useState<HistoryLocation>(readLocation);
  const [navigationType, setNavigationType] =
    useState<NavigationType>("initial");

  useEffect(() => {
    const onPopState = () => {
      // Capture the old entry before React swaps the rendered route.
      saveActiveScrolls();
      setLocation(readLocation());
      setNavigationType("pop");
    };
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setLocation(readLocation());
      setNavigationType("pop");
    };

    window.addEventListener("popstate", onPopState);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("popstate", onPopState);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  const navigate = useCallback(
    (route: Route, options?: NavigateOptions) => {
      const href = routeHref(route);
      const currentHref = `${window.location.pathname}${window.location.search}`;
      if (href === currentHref) return;

      saveActiveScrolls();

      if (options?.replace) {
        const entry = currentEntry();
        window.history.replaceState(entry, "", href);
        setLocation({ route, ...entry, href });
        setNavigationType("replace");
        return;
      }

      const entry = currentEntry();
      const next = { key: createKey(), index: entry.index + 1 };
      window.history.pushState(next, "", href);
      setLocation({ route, ...next, href });
      setNavigationType("push");
    },
    [],
  );

  const value = useMemo(
    () => ({ location, navigationType, navigate }),
    [location, navigationType, navigate],
  );

  return (
    <HistoryContext.Provider value={value}>
      {props.children}
    </HistoryContext.Provider>
  );
}

function useHistory(): HistoryContextValue {
  const value = useContext(HistoryContext);
  if (!value) {
    throw new Error("History hooks require a HistoryProvider");
  }
  return value;
}

export function useHistoryLocation(): HistoryLocation {
  return useHistory().location;
}

export function useNavigationType(): NavigationType {
  return useHistory().navigationType;
}

export function useNavigate(): HistoryContextValue["navigate"] {
  return useHistory().navigate;
}

export function useBackTo(): (fallback: Route) => void {
  const navigate = useNavigate();
  return useCallback(
    (fallback: Route) => {
      saveActiveScrolls();
      const state = entryState();
      if (typeof state.index === "number" && state.index > 0) {
        window.history.back();
        return;
      }
      navigate(fallback, { replace: true });
    },
    [navigate],
  );
}
