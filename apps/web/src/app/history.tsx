import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { AssistantScope } from "@amoshydra/oktoso-contracts";
import { createID } from "./ids";
import { DEFAULT_ROUTE, parseRoute, routeHref, type Route } from "./router";
import { routeDataKey } from "./route-cache";
import { saveActiveScrolls } from "./scroll-store";

export type NavigationType = "initial" | "push" | "replace" | "pop";

export interface AssistantHistoryState {
  scope: AssistantScope;
  title: string;
  project?: string;
}

export interface NavigateOptions {
  replace?: boolean;
  /** Open or close the session assistant on this history entry. */
  assistant?: AssistantHistoryState | null;
}

export interface HistoryLocation {
  route: Route;
  key: string;
  index: number;
  href: string;
  assistant?: AssistantHistoryState;
}

interface HistoryEntryState {
  key?: string;
  index?: number;
  assistant?: AssistantHistoryState;
}

interface HistoryContextValue {
  location: HistoryLocation;
  navigationType: NavigationType;
  navigate: (route: Route, options?: NavigateOptions) => void;
}

const HistoryContext = createContext<HistoryContextValue | null>(null);

function entryState(): HistoryEntryState {
  const state = window.history.state as HistoryEntryState | null;
  return state && typeof state === "object" ? state : {};
}

function currentEntry(): { key: string; index: number } {
  const state = entryState();
  return {
    key: typeof state.key === "string" ? state.key : createID(),
    index: typeof state.index === "number" ? state.index : 0,
  };
}

function readLocation(includeAssistant = true): HistoryLocation {
  const route = parseRoute(window.location.pathname, window.location.search);
  const entry = currentEntry();
  const state = entryState();
  return {
    route: route ?? DEFAULT_ROUTE,
    key: entry.key,
    index: entry.index,
    href: `${window.location.pathname}${window.location.search}`,
    ...(includeAssistant &&
    state.assistant &&
    typeof state.assistant === "object" &&
    "scope" in state.assistant
      ? { assistant: state.assistant }
      : {}),
  };
}

/**
 * A reload does not reopen an assistant that was open before it. Back and
 * forward still restore it from the adjacent history entry's state.
 */
function initialLocation(): HistoryLocation {
  const initial = readLocation();
  if (!initial.assistant) return initial;
  window.history.replaceState(
    { key: initial.key, index: initial.index },
    "",
    initial.href,
  );
  return { ...initial, assistant: undefined };
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
  const key = typeof state.key === "string" ? state.key : createID();
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
  const [location, setLocation] = useState<HistoryLocation>(initialLocation);
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
      const hasAssistantOption = Boolean(
        options && Object.prototype.hasOwnProperty.call(options, "assistant"),
      );
      const assistant =
        hasAssistantOption && options?.assistant
          ? options.assistant
          : undefined;
      const currentState = entryState();

      if (href === currentHref) {
        if (!hasAssistantOption) return;
        saveActiveScrolls();
        if (!assistant) {
          if (!currentState.assistant) return;
          // Closing uses replace so the assistant entry does not linger.
          const entry = currentEntry();
          const next = { key: entry.key, index: entry.index };
          window.history.replaceState(next, "", href);
          setLocation({ route, ...next, href });
          setNavigationType("replace");
          return;
        }
        if (options?.replace) {
          const entry = currentEntry();
          const next = { key: entry.key, index: entry.index, assistant };
          window.history.replaceState(next, "", href);
          setLocation({ route, ...next, href, assistant });
          setNavigationType("replace");
          return;
        }
        const entry = currentEntry();
        const next = {
          key: createID(),
          index: entry.index + 1,
          assistant,
        };
        window.history.pushState(next, "", href);
        setLocation({ route, ...next, href, assistant });
        setNavigationType("push");
        return;
      }

      saveActiveScrolls();
      const entry = currentEntry();
      const next = {
        key: options?.replace ? entry.key : createID(),
        index: options?.replace ? entry.index : entry.index + 1,
        ...(assistant ? { assistant } : {}),
      };
      if (options?.replace) {
        window.history.replaceState(next, "", href);
        setLocation({
          route,
          ...next,
          href,
          ...(assistant ? { assistant } : {}),
        });
        setNavigationType("replace");
        return;
      }
      window.history.pushState(next, "", href);
      setLocation({
        route,
        ...next,
        href,
        ...(assistant ? { assistant } : {}),
      });
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

/** Stable route identity for data caches, unlike the per-entry history key. */
export function useRouteDataKey(): string {
  return routeDataKey(useHistory().location.route);
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
