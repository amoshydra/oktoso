import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import {
  artifactPathsFromMessages,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
} from "@amoshydra/oktoso-contracts";
import type {
  AssistantView,
  Attachment,
  Attention,
  AttentionType,
  AuthCheck,
  AutomationApproval,
  BranchPoint,
  Diagnostics,
  Health,
  Handoff,
  HubEvent,
  InboxItem,
  Message,
  MessagePart,
  SearchResult,
  SessionLineage,
  ModelOption,
  Provider,
  ProviderAuthKind,
  ProviderInput,
  ProviderOptions,
  ProviderUpdateInput,
  ReplyOption,
  SendDelivery,
  Session,
  SessionHistory,
  SessionSelectionInput,
  SessionStatus,
  SessionWarning,
} from "@amoshydra/oktoso-contracts";
import {
  HubClient,
  HubError,
  canScanPairingQr,
  messageFromHubEvent,
  scanPairingQr,
  type ConnectionStatus,
} from "@amoshydra/oktoso-client";
import { ActivityTiles as ActivityGrid } from "./ActivityTiles";
import { itemsFromChatSteps } from "./activity-model";
import { AssistantDock } from "./AssistantDock";
import { BrandMark } from "./BrandMark";
import { copyTextToClipboard, pastedFiles } from "./clipboard";
import { downloadAttachment, saveBlob } from "./download";
import { FilePreview } from "./FilePreview";
import { trapTabKey } from "./focus";
import { Icon, type IconName } from "./Icon";
import { Markdown } from "./Markdown";
import { TicketMedia } from "./TicketMedia";
import {
  appendTranscript,
  formatDictationDuration,
  messageCopyText,
  pickAudioMimeType,
} from "./chat-actions";
import { createID } from "./ids";
import { groupModelOptions } from "./model-options";
import { mergeLatestPage, mergeMessageUpdates } from "./message-order";
import {
  useBackTo,
  useHistoryLocation,
  useNavigate,
  useNavigationType,
  useRouteDataKey,
  type AssistantHistoryState,
  type NavigateOptions,
} from "./history";
import {
  currentHref,
  DEFAULT_ROUTE,
  isInternalNext,
  parseRouteHref,
  type Route,
  type SearchScope,
} from "./router";
import {
  clearRouteCache,
  readRouteCache,
  readRouteCacheEntry,
  searchDataKey,
  writeRouteCache,
} from "./route-cache";
import {
  useRevalidationActive,
  useRevalidationIndicator,
} from "./revalidation";
import { hasSavedScroll, useScrollRestoration } from "./scroll";
import { NotificationSettingsPanel } from "./settings-notifications";
import { AutomationSettingsPanel } from "./settings-automation";
import { automationReasonLabel } from "./automation-copy";
import { highlightParts } from "./search-highlight";
import { transcriptPhase } from "./transcript-state";
import { OverviewUsage } from "./overview-usage";
import { LocalDataSettingsPanel } from "./settings-local-data";
import {
  readSessionCache,
  readSessionsCache,
  removeSessionCache,
  writeSessionCache,
  writeSessionsCache,
} from "./offline-cache";
import {
  clearTranscriptCache,
  readTranscriptCache,
  removeTranscriptCache,
  writeTranscriptCache,
} from "./transcript-cache";
import {
  enqueueSend,
  isOnline,
  queuedMessages,
  removeQueued as removeQueuedSend,
  shouldQueue,
  subscribeQueueResults,
} from "./send-queue";
import { useSendQueue } from "./use-send-queue";
import {
  draftSlotStatusText,
  useDraftSlot,
} from "./use-draft-slot";
import {
  createOptimisticMessage,
  isOptimisticMessage,
  optimisticSend,
  updateOptimisticStatus,
} from "./optimistic";
import {
  resolveSessionResource,
  sessionFileTarget,
  type ResourceContext,
  type SessionFileTarget,
} from "./urls";
import {
  collectToolImages,
  sanitizeToolOutput,
  toolOutputText,
} from "./tool-images";
import { formatBytes, formatChars, formatDuration } from "./metrics";
import {
  isTextPreview,
  previewKind,
  previewMaxBytes,
  previewMimeType,
  type PreviewKind,
} from "./file-preview";
import { SessionRow } from "./SessionRow";
import { SessionTree, type SessionTreeLabels } from "./SessionTree";
import {
  buildSessionTree,
  countTreeSessions,
  filterSessionTree,
} from "./session-tree";
import {
  compactionPart,
  shellPart,
  messageSegments,
  stepsFromMessages,
  stepsFromParts,
  subagentRef,
  toolKind,
  type ActivityStep,
  type StepKind,
  type StepStatus,
} from "./activity";
import {
  answeredQuestions,
  type AnsweredQuestionPart,
} from "./question-answer";

const TOKEN_KEY = "oktoso-token";
const THEME_KEY = "oktoso-theme";
const SESSION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type AuthState = "checking" | "signed-out" | "signed-in";
type View = "foundation" | "inbox" | "sessions" | "search" | "providers" | "settings";
type SearchState = Omit<Extract<Route, { name: "search" }>, "name">;

const VIEW_META: Record<
  View,
  { label: string; icon: IconName; sub: string; phase: string; description: string }
> = {
  foundation: {
    label: "Overview",
    icon: "activity",
    sub: "Usage and hub runtime",
    phase: "0",
    description: "Usage, runtime status, and the event stream.",
  },
  inbox: {
    label: "Inbox",
    icon: "inbox",
    sub: "Attention",
    phase: "3",
    description: "The unified approval, question, unread, and error inbox.",
  },
  sessions: {
    label: "Sessions",
    icon: "message",
    sub: "All providers",
    phase: "2",
    description: "The provider-backed session index, transcript, and composer.",
  },
  search: {
    label: "Search",
    icon: "search",
    sub: "Sessions and projects",
    phase: "6",
    description: "Session, project, and message search across providers.",
  },
  providers: {
    label: "Providers",
    icon: "server",
    sub: "Provider health",
    phase: "0",
    description: "Configured endpoints, health, and capability discovery.",
  },
  settings: {
    label: "Settings",
    icon: "sliders",
    sub: "Runtime and preferences",
    phase: "0",
    description: "Theme, client preferences, diagnostics, and hub information.",
  },
};

const RAIL_VIEWS: View[] = [
  "foundation",
  "inbox",
  "sessions",
  "search",
  "providers",
  "settings",
];
const BOTTOM_VIEWS: View[] = ["foundation", "inbox", "sessions", "search", "settings"];

function viewForRoute(route: Route): View {
  switch (route.name) {
    case "foundation":
      return "foundation";
    case "inbox":
      return "inbox";
    case "sessions":
    case "chat":
      return "sessions";
    case "search":
      return "search";
    case "providers":
      return "providers";
    case "settings":
      return "settings";
    case "login":
      return "foundation";
  }
}

function credentialLabel(identity: AuthCheck["auth"]): string {
  if (identity?.kind === "owner") return "Owner";
  if (identity?.profile === "g2") return "G2";
  if (identity?.profile === "phone") return "Phone";
  if (identity?.kind === "session") return "Paired session";
  return "Unavailable";
}

function credentialScopes(identity: AuthCheck["auth"]): string {
  if (identity?.kind === "owner") return "All";
  if (identity?.profile === "g2") {
    return "Sessions · Inbox · Search · Providers (read) · Settings (read) · Approvals · Voice · Events";
  }
  if (identity?.profile === "phone" || identity?.kind === "session") {
    return "Sessions · Inbox · Handoffs · Search · Providers · Settings · Assistant · Automation · Notifications · Local data · Voice · Events";
  }
  return "Unknown";
}

function routeForView(view: View): Route {
  switch (view) {
    case "foundation":
      return DEFAULT_ROUTE;
    case "inbox":
      return { name: "inbox", filter: "all" };
    case "sessions":
      return { name: "sessions", newSession: false };
    case "search":
      return {
        name: "search",
        query: "",
        provider: "all",
        status: "all",
        scope: "sessions",
      };
    case "providers":
      return { name: "providers" };
    case "settings":
      return { name: "settings" };
  }
}

/** A 2px indeterminate line on the topbar: cached content stays in place. */
function TopbarProgress() {
  const active = useRevalidationActive();
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {active ? "Refreshing data" : ""}
      </span>
      <div className="topbar-progress" data-active={active} aria-hidden="true" />
    </>
  );
}

export function App() {
  const {
    route,
    key: routeKey,
    assistant: historyAssistant,
  } = useHistoryLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const backTo = useBackTo();

  const view = viewForRoute(route);
  const selectedSessionRef = route.name === "chat" ? route.ref : undefined;
  const chatOpen = route.name === "chat";
  const detailsOpen = route.name === "chat" ? route.details : false;
  const previewPath = route.name === "chat" ? route.preview : undefined;

  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [auth, setAuth] = useState<AuthState>("checking");
  const [authIdentity, setAuthIdentity] = useState<AuthCheck["auth"]>();
  const [client, setClient] = useState<HubClient | null>(null);
  const [health, setHealth] = useState<Health>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [attentionCount, setAttentionCount] = useState(0);
  const [approvalCount, setApprovalCount] = useState(0);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const queuedCount = useSendQueue(client, connection);
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const [error, setError] = useState<string>();
  const [loginError, setLoginError] = useState<string>();
  const [loginBusy, setLoginBusy] = useState(false);
  const signingOut = useRef(false);
  const didRefresh = useRef(false);
  const [activeSession, setActiveSession] = useState<Session>();
  const [sidebarVisible, setSidebarVisible] = useState(() =>
    window.matchMedia("(min-width: 761px)").matches,
  );
  const [assistant, setAssistant] = useState<AssistantHistoryState | null>(
    historyAssistant ?? null,
  );
  const [assistantAvailable, setAssistantAvailable] = useState(false);
  const lastSeq = useRef(0);
  const attentionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const autoDetailsKey = useRef<string | undefined>(undefined);
  const detailsPushed = useRef(false);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client
      .assistantStatus()
      .then((status) => {
        if (!cancelled) setAssistantAvailable(status.enabled);
      })
      .catch(() => {
        if (!cancelled) setAssistantAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    setAssistant(historyAssistant ?? null);
  }, [historyAssistant, routeKey]);

  const providerEditorRoute =
    route.name === "providers" ? route.editor : undefined;
  const providerEditor: { mode: "add" | "edit"; provider?: Provider } | undefined =
    providerEditorRoute?.mode === "add"
      ? { mode: "add" }
      : providerEditorRoute?.mode === "edit"
        ? (() => {
            const provider = providers.find(
              (item) => item.id === providerEditorRoute.id,
            );
            return provider ? { mode: "edit", provider } : undefined;
          })()
        : undefined;

  useScrollRestoration(contentRef, "content");

  useEffect(() => {
    setActiveSession(undefined);
  }, [selectedSessionRef]);

  useEffect(() => {
    if (route.name !== "chat") {
      autoDetailsKey.current = undefined;
      detailsPushed.current = false;
      return;
    }
    if (route.details) {
      autoDetailsKey.current = routeKey;
      return;
    }
    if (autoDetailsKey.current === routeKey) return;
    autoDetailsKey.current = routeKey;
    detailsPushed.current = false;
    if (navigationType === "pop") return;
    if (!window.matchMedia("(min-width: 1320px)").matches) return;
    navigate({ ...route, details: true }, { replace: true });
  }, [route, routeKey, navigationType, navigate]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1319px)");
    const onChange = () => {
      if (!query.matches) return;
      const current = routeRef.current;
      if (current.name !== "chat" || !current.details) return;
      detailsPushed.current = false;
      navigate({ ...current, details: false }, { replace: true });
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [navigate]);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 761px)");
    const onChange = () => setSidebarVisible(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useLayoutEffect(() => {
    if (navigationType === "push") {
      contentRef.current?.scrollTo({ top: 0 });
    }
  }, [routeKey, navigationType]);

  useEffect(() => {
    const label = chatOpen
      ? activeSession?.title ?? "Session"
      : VIEW_META[view].label;
    document.title = `${label} · Oktoso`;
  }, [chatOpen, activeSession?.title, view]);

  useEffect(() => {
    if (navigationType !== "push") return;
    const current = routeRef.current;
    if (current.name === "search") return;
    if (
      current.name === "chat" &&
      current.details &&
      window.matchMedia("(max-width: 1319px)").matches
    ) {
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [routeKey, navigationType]);

  useEffect(() => {
    if (auth !== "signed-in") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (routeRef.current.name === "search") return;
        navigate({
          name: "search",
          query: "",
          provider: "all",
          status: "all",
          scope: "sessions",
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [auth, navigate]);

  useEffect(() => {
    if (auth === "signed-out" && route.name !== "login") {
      const next = currentHref();
      navigate(
        {
          name: "login",
          ...(isInternalNext(next) ? { next } : {}),
        },
        { replace: true },
      );
      return;
    }
    if (auth === "signed-in" && route.name === "login") {
      const target =
        route.next && isInternalNext(route.next)
          ? parseRouteHref(route.next)
          : undefined;
      navigate(target ?? DEFAULT_ROUTE, { replace: true });
    }
  }, [auth, route, navigate]);

  useEffect(() => {
    const editor = route.name === "providers" ? route.editor : undefined;
    if (editor?.mode !== "edit") return;
    if (providers.length === 0) return;
    if (providers.some((provider) => provider.id === editor.id)) return;
    navigate({ name: "providers" }, { replace: true });
  }, [navigate, providers, route]);

  const selectView = useCallback(
    (next: View) => {
      if (route.name === next) return;
      navigate(routeForView(next));
    },
    [navigate, route.name],
  );

  const openSession = useCallback(
    (
      ref: string,
      options?: NavigateOptions & { message?: string },
    ) => {
      navigate(
        {
          name: "chat",
          ref,
          details: false,
          ...(options?.message ? { message: options.message } : {}),
        },
        options,
      );
    },
    [navigate],
  );

  const navigateSearch = useCallback(
    (next: SearchState, options?: NavigateOptions) => {
      navigate({ name: "search", ...next }, options);
    },
    [navigate],
  );

  const openAssistant = useCallback(
    (next: AssistantHistoryState) => {
      const current = routeRef.current;
      const details =
        current.name === "chat" && current.details ? current : undefined;
      navigate(details ? { ...details, details: false } : current, {
        assistant: next,
        ...(details ? { replace: true } : {}),
      });
    },
    [navigate],
  );

  const closeAssistant = useCallback(() => {
    navigate(routeRef.current, { replace: true, assistant: null });
  }, [navigate]);

  const handleChatBack = useCallback(() => {
    if (assistant) {
      closeAssistant();
      return;
    }
    backTo({ name: "sessions" });
  }, [assistant, backTo, closeAssistant]);

  const setDetailsOpen = useCallback(
    (open: boolean) => {
      const current = routeRef.current;
      if (current.name !== "chat") return;
      const wide = window.matchMedia("(min-width: 1320px)").matches;
      const next = { ...current, details: open };
      if (open) {
        detailsPushed.current = !wide;
        navigate(next, { replace: wide });
        return;
      }
      if (detailsPushed.current) {
        detailsPushed.current = false;
        backTo({ name: "chat", ref: current.ref, details: false });
        return;
      }
      navigate(next, { replace: true });
    },
    [backTo, navigate],
  );

  const signOut = useCallback(() => {
    signingOut.current = true;
    didRefresh.current = false;
    sessionStorage.removeItem(TOKEN_KEY);
    clearRouteCache();
    clearTranscriptCache();
    void new HubClient({}).signOut().catch(() => undefined);
    setToken("");
    setClient(null);
    setAuth("signed-out");
    setAuthIdentity(undefined);
    setHealth(undefined);
    setDiagnostics(undefined);
    setProviders([]);
    setAttentionCount(0);
    setApprovalCount(0);
    setEvents([]);
    setError(undefined);
  }, []);

  const loadSnapshot = useCallback(async (hub: HubClient) => {
    const [
      nextHealth,
      nextProviders,
      nextDiagnostics,
      nextAttention,
      nextApprovals,
    ] = await Promise.all([
      hub.health(),
      hub.providers(),
      hub.diagnostics(),
      hub.attention().catch(() => undefined),
      hub.automationApprovals().catch(() => []),
    ]);
    setHealth(nextHealth);
    setProviders(nextProviders);
    setDiagnostics(nextDiagnostics);
    if (nextAttention) setAttentionCount(nextAttention.data.length);
    setApprovalCount(nextApprovals.length);
    return {
      health: nextHealth,
      providers: nextProviders,
      diagnostics: nextDiagnostics,
    };
  }, []);

  const checkProviders = useCallback(
    async (hub: HubClient, list: Provider[] = providers) => {
      if (list.length === 0) return;
      setCheckingProviders(true);
      try {
        const results = await Promise.all(
          list.map(async (provider) => {
            try {
              const result = await hub.checkProvider(provider.id);
              return {
                ...provider,
                status: result.status,
                ...(result.version ? { version: result.version } : {}),
                lastCheckedAt: Date.now(),
              };
            } catch {
              return provider;
            }
          }),
        );
        setProviders(results);
      } finally {
        setCheckingProviders(false);
      }
    },
    [providers],
  );

  useEffect(() => {
    // Do not let the cookie bootstrap race an in-flight signout and sign the
    // user back in before the server clears the cookie.
    if (signingOut.current) return;

    let cancelled = false;
    // A paired browser has an HttpOnly session cookie and no local token.
    // A token, when present, is the explicit owner/dev fallback.
    const hub = new HubClient(token ? { token } : {});
    setClient(hub);
    setAuth("checking");

    hub
      .authCheck()
      .then(async (check) => {
        if (cancelled) return;
        if (check.auth) setAuthIdentity(check.auth);

        // A pasted session token is not refreshed by the cookie middleware.
        // Rotate it here when it is close to expiry; owner tokens do not expire.
        if (
          !didRefresh.current &&
          token &&
          check.auth?.kind === "session" &&
          check.auth.expiresAt !== undefined &&
          check.auth.expiresAt - Date.now() <= SESSION_REFRESH_WINDOW_MS
        ) {
          try {
            const refreshed = await hub.refresh();
            didRefresh.current = true;
            hub.setToken(refreshed.token);
            sessionStorage.setItem(TOKEN_KEY, refreshed.token);
            setToken(refreshed.token);
            return;
          } catch {
            // Keep using the old token until it expires.
          }
        }

        setAuth("signed-in");
        const snapshot = await loadSnapshot(hub);
        if (!cancelled) {
          await checkProviders(hub, snapshot.providers);
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        if (reason instanceof HubError && reason.status === 401) {
          signOut();
          return;
        }
        // Offline: keep the cached shell usable and let the next successful
        // check or SSE connection confirm the session. A real auth failure
        // still signs out above.
        if (
          reason instanceof HubError &&
          (reason.code === "network_error" || reason.code === "timeout")
        ) {
          setAuth("signed-in");
          void loadSnapshot(hub).catch(() => undefined);
          return;
        }
        setAuth("signed-out");
        setLoginError(
          reason instanceof Error ? reason.message : "Unable to reach the hub",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [token, loadSnapshot, signOut]);

  useEffect(() => {
    if (auth !== "signed-in" || !client) return;
    const controller = new AbortController();
    setConnection("connecting");

    void client
      .startEvents({
        after: lastSeq.current,
        signal: controller.signal,
        onStatus: setConnection,
        onEvent: (event) => {
          lastSeq.current = Math.max(lastSeq.current, event.seq);
          setHealth((current) =>
            current ? { ...current, eventSeq: Math.max(current.eventSeq, event.seq) } : current,
          );
          setEvents((current) => [event, ...current].slice(0, 100));
          if (event.type === "resync") {
            void loadSnapshot(client).catch(() => undefined);
          }
          if (
            event.type.startsWith("attention.") ||
            event.type === "automation.approval"
          ) {
            if (attentionTimer.current) clearTimeout(attentionTimer.current);
            attentionTimer.current = setTimeout(() => {
              void Promise.all([
                client.attention(),
                client.automationApprovals().catch(() => []),
              ])
                .then(([page, approvals]) => {
                  setAttentionCount(page.data.length);
                  setApprovalCount(approvals.length);
                })
                .catch(() => undefined);
            }, 250);
          }
          if (event.type === "provider.status") {
            const provider = (event.data as { provider?: Provider }).provider;
            if (provider) {
              setProviders((current) =>
                current.map((item) =>
                  item.id === provider.id ? provider : item,
                ),
              );
            }
          }
        },
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setConnection("closed");
        if (reason instanceof HubError && reason.status === 401) signOut();
        else setError(reason instanceof Error ? reason.message : "Event stream failed");
      });

    return () => {
      controller.abort();
      if (attentionTimer.current) clearTimeout(attentionTimer.current);
    };
  }, [auth, client, loadSnapshot, signOut]);

  const handleConnect = async (nextToken: string) => {
    setLoginBusy(true);
    setLoginError(undefined);
    signingOut.current = false;
    didRefresh.current = false;
    const hub = new HubClient({ token: nextToken });
    try {
      const check = await hub.authCheck();
      if (check.auth) setAuthIdentity(check.auth);
      sessionStorage.setItem(TOKEN_KEY, nextToken);
      setClient(hub);
      setToken(nextToken);
      setAuth("checking");
    } catch (reason) {
      setLoginError(
        reason instanceof HubError
          ? reason.message
          : "Unable to connect to the hub",
      );
    } finally {
      setLoginBusy(false);
    }
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem(THEME_KEY, next);
  };

  const current = VIEW_META[view];
  const pageTitle = chatOpen ? activeSession?.title ?? "Session" : current.label;
  const pageSub = chatOpen
    ? activeSession
      ? `${providerLabel(activeSession.providerID)} · ${statusLabel(activeSession.status)}`
      : "Loading session…"
    : current.sub;
  const totalAttention = attentionCount + approvalCount;
  const badge = totalAttention > 99 ? "99+" : String(totalAttention);
  const attentionAria =
    totalAttention === 1 ? "1 item needs attention" : `${totalAttention} items need attention`;

  if (auth === "signed-out") {
    return (
      <Login
        busy={loginBusy}
        error={loginError}
        onSubmit={handleConnect}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
    );
  }

  if (auth === "checking") {
    return (
      <div className="login-page">
        <div className="login-card boot-card">
          <div className="brand-mark">
            <BrandMark size={40} />
          </div>
          <h1>Oktoso</h1>
          <p>Checking the hub connection…</p>
          <div className="loading-line" />
        </div>
      </div>
    );
  }

  if (route.name === "login") {
    return (
      <div className="login-page">
        <div className="login-card boot-card">
          <div className="brand-mark">
            <BrandMark size={40} />
          </div>
          <h1>Oktoso</h1>
          <p>Opening Oktoso…</p>
          <div className="loading-line" />
        </div>
      </div>
    );
  }

  const providerPanel = (
    <article className="panel providers-panel">
      <div className="panel-head">
        <div>
          <h2>Providers</h2>
          <p>
            Configured endpoints, health, versions, and normalized capabilities.
            Credentials are written to the hub config and never returned.
          </p>
        </div>
        <div className="panel-actions">
          <button
            className="btn small"
            type="button"
            onClick={() =>
              navigate({ name: "providers", editor: { mode: "add" } })
            }
          >
            + Add
          </button>
          <button
            className="btn small"
            type="button"
            disabled={checkingProviders}
            onClick={() => client && void checkProviders(client)}
          >
            {checkingProviders ? "Checking…" : "Recheck"}
          </button>
        </div>
      </div>
      <div className="provider-list">
        {providers.length === 0 ? (
          <div className="empty">
            No providers configured. Use <strong>+ Add</strong> to connect
            OpenCode or Open WebUI.
          </div>
        ) : (
          providers.map((provider) => (
            <div className="provider-row" key={provider.id}>
              <div className={`provider-mark provider-mark-${provider.type}`}>
                {providerMark(provider.type)}
              </div>
              <div className="provider-main">
                <strong>{provider.name}</strong>
                <span className="mono">{provider.baseUrl}</span>
              </div>
              {import.meta.env.DEV && isFakeProvider(provider.baseUrl) ? (
                <span className="dev-badge">fake</span>
              ) : null}
              <span className={`status-chip ${provider.status}`}>
                <i />
                {provider.status}
              </span>
              <button
                className="btn ghost small"
                type="button"
                onClick={() =>
                  navigate({
                    name: "providers",
                    editor: { mode: "edit", id: provider.id },
                  })
                }
              >
                Edit
              </button>
            </div>
          ))
        )}
      </div>
      {providerEditor && client ? (
        <ProviderForm
          key={`${providerEditor.mode}:${providerEditor.provider?.id ?? "new"}`}
          client={client}
          provider={providerEditor.provider}
          onClose={() => backTo({ name: "providers" })}
          onSaved={(saved) => {
            setProviders((current) => {
              const index = current.findIndex((item) => item.id === saved.id);
              if (index < 0) return [...current, saved];
              return current.map((item) => (item.id === saved.id ? saved : item));
            });
            backTo({ name: "providers" });
          }}
        />
      ) : null}
    </article>
  );

  const diagnosticsPanel = (
    <section className="panel diagnostics">
      <div className="panel-head">
        <div>
          <h2>Diagnostics</h2>
          <p>Safe operational state. No provider credentials or message bodies.</p>
        </div>
      </div>
      <div className="details-grid">
        <Detail label="Version" value={health?.version ?? "—"} />
        <Detail label="Event sequence" value={String(health?.eventSeq ?? 0)} />
        <Detail label="Subscribers" value={String(diagnostics?.events.subscribers ?? 0)} />
        <Detail label="Replay buffer" value={String(diagnostics?.events.bufferSize ?? 0)} />
        <Detail label="Storage" value={diagnostics?.storage.kind ?? "—"} />
        <Detail label="Node" value={diagnostics?.node ?? "—"} />
      </div>
    </section>
  );

  return (
    <div className={`app-shell ${chatOpen ? "chat-open" : ""}`}>
      <aside className="rail" aria-label="Primary navigation">
        <div className="rail-logo" role="img" aria-label="Oktoso" title="Oktoso">
          <BrandMark size={36} />
        </div>
        <nav className="rail-nav">
          {RAIL_VIEWS.map((id) => {
            const item = VIEW_META[id];
            return (
              <button
                className={`rail-item ${view === id ? "active" : ""}`}
                type="button"
                key={id}
                aria-current={view === id ? "page" : undefined}
                onClick={() => selectView(id)}
                title={item.label}
                aria-label={
                  id === "inbox" && totalAttention > 0
                    ? `${item.label}, ${attentionAria}`
                    : item.label
                }
              >
                <span className="rail-mark" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                  {id === "inbox" && totalAttention > 0 ? (
                    <span className="nav-badge">{badge}</span>
                  ) : null}
                </span>
                <span className="rail-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="rail-footer">
          <span className={`status-dot ${connection === "open" ? "online" : "offline"}`} />
          <span>{connection === "open" ? "Live" : "Offline"}</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          {chatOpen ? (
            <button
              className="icon-btn topbar-back"
              type="button"
              onClick={handleChatBack}
              aria-label="Back"
            >
              <Icon name="arrow-left" size={18} />
            </button>
          ) : null}
          <div className="topbar-title-block">
            <h1 className="topbar-title" ref={headingRef} tabIndex={-1}>
              {pageTitle}
            </h1>
            <span className="topbar-sub">{pageSub}</span>
          </div>
          {chatOpen && activeSession && assistantAvailable ? (
            <button
              className="btn small topbar-ask"
              type="button"
              aria-expanded={assistant?.scope.kind === "session"}
              aria-controls={
                assistant?.scope.kind === "session" ? "session-assistant" : undefined
              }
              onClick={() => {
                if (assistant) {
                  closeAssistant();
                  return;
                }
                openAssistant({
                  scope: {
                    kind: "session",
                    sessionRef: selectedSessionRef!,
                  },
                  title: activeSession.title,
                  project: activeSession.project,
                });
              }}
            >
              Ask
            </button>
          ) : null}
          {view === "foundation" && assistantAvailable ? (
            <button
              className="btn small topbar-ask"
              type="button"
              aria-expanded={assistant?.scope.kind === "global"}
              aria-controls={
                assistant?.scope.kind === "global" ? "session-assistant" : undefined
              }
              onClick={() =>
                assistant?.scope.kind === "global"
                  ? closeAssistant()
                  : openAssistant({
                      scope: { kind: "global" },
                      title: "All sessions",
                    })
              }
            >
              Ask
            </button>
          ) : null}
          {chatOpen && activeSession ? (
            <button
              className="btn small topbar-details"
              type="button"
              aria-expanded={detailsOpen}
              aria-controls={detailsOpen ? "session-details" : undefined}
              onClick={() => {
                if (!detailsOpen && assistant) closeAssistant();
                setDetailsOpen(!detailsOpen);
              }}
            >
              Details
            </button>
          ) : null}
          <span className={`status-chip topbar-live ${connectionClass(connection)}`}>
            <i />
            {connectionLabel(connection)}
          </span>
          {queuedCount > 0 ? (
            <span
              className="status-chip topbar-queued"
              title={`${queuedCount} message${queuedCount === 1 ? "" : "s"} waiting to send`}
            >
              {queuedCount} queued
            </span>
          ) : null}
          <button
            className="icon-btn topbar-theme"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
          <button className="btn small topbar-disconnect" type="button" onClick={signOut}>
            Disconnect
          </button>
          <TopbarProgress />
        </header>

        <main className={`content ${chatOpen ? "chat-content" : ""}`} ref={contentRef}>
          <div className={`page ${chatOpen ? "page-chat" : ""}`}>
            {view === "foundation" ? (
              <>
                <OverviewUsage client={client as HubClient} />

                {error ? (
                  <div className="alert" role="alert">
                    {error}
                    <button className="text-button" type="button" onClick={() => setError(undefined)}>
                      Dismiss
                    </button>
                  </div>
                ) : null}

                <section className="status-grid" aria-label="Runtime status">
                  <article className="card">
                    <div className="card-label">Hub</div>
                    <strong className="card-value">{health ? "Connected" : "Waiting"}</strong>
                    <span className="card-meta">
                      Uptime {formatUptime(health?.uptimeMs ?? 0)} · seq {health?.eventSeq ?? 0}
                    </span>
                  </article>
                  <article className="card">
                    <div className="card-label">Event stream</div>
                    <strong className="card-value">{connectionLabel(connection)}</strong>
                    <span className="card-meta">
                      {events.length} received · cursor {lastSeq.current}
                    </span>
                  </article>
                  <article className="card">
                    <div className="card-label">Providers</div>
                    <strong className="card-value">
                      {providers.filter((provider) => provider.status === "online").length} /{" "}
                      {providers.length} online
                    </strong>
                    <span className="card-meta">
                      {checkingProviders ? "Checking health…" : "Health checks"}
                    </span>
                  </article>
                  <article className="card">
                    <div className="card-label">State</div>
                    <strong className="card-value">{diagnostics?.storage.kind ?? "—"}</strong>
                    <span className="card-meta">Node {diagnostics?.node ?? "—"}</span>
                  </article>
                </section>

                <section className="grid-two">
                  {providerPanel}
                  <article className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>Event stream</h2>
                        <p>Authenticated SSE with replay and heartbeat.</p>
                      </div>
                      <span className="mono">after={lastSeq.current}</span>
                    </div>
                    {events.length === 0 ? (
                      <div className="empty">
                        Connected. New hub events will appear here as the provider slices land.
                      </div>
                    ) : (
                      <div className="event-list">
                        {events.slice(0, 12).map((event) => (
                          <div className="event-row" key={`${event.seq}-${event.type}`}>
                            <span className="event-seq">#{event.seq}</span>
                            <span className="event-type">{event.type}</span>
                            <span className="event-time">{formatTime(event.at)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </article>
                </section>

                {diagnosticsPanel}
              </>
            ) : view === "inbox" ? (
              <InboxView
                client={client as HubClient}
                events={events}
                filter={route.name === "inbox" ? route.filter : "all"}
                onFilterChange={(filter) =>
                  navigate({ name: "inbox", filter })
                }
                onOpen={openSession}
                onNewSession={() =>
                  navigate({ name: "sessions", newSession: true })
                }
              />
            ) : view === "sessions" ? (
              selectedSessionRef ? (
                <>
                <div className="chat-shell">
                  {sidebarVisible ? (
                    <ChatSidebar
                      client={client as HubClient}
                      events={events}
                      providers={providers}
                      activeRef={selectedSessionRef}
                      activeSession={activeSession}
                      onOpen={openSession}
                      onViewAll={() => navigate({ name: "sessions" })}
                    />
                  ) : null}
                  <SessionDetail
                    key={selectedSessionRef}
                    client={client as HubClient}
                    sessionRef={selectedSessionRef}
                    events={events}
                    providers={providers}
                    detailsOpen={detailsOpen}
                    previewPath={previewPath}
                    onPreviewClose={
                      route.name === "chat"
                        ? () =>
                            navigate(
                              { ...route, preview: undefined },
                              { replace: true },
                            )
                        : undefined
                    }
                    onDetailsOpenChange={setDetailsOpen}
                    onSessionChange={setActiveSession}
                    onOpenSession={openSession}
                    attentionID={route.name === "chat" ? route.attention : undefined}
                    messageID={route.name === "chat" ? route.message : undefined}
                    onBack={handleChatBack}
                  />
                </div>
                </>
              ) : (
                <SessionsView
                  client={client as HubClient}
                  events={events}
                  providers={providers}
                  showNew={route.name === "sessions" && route.newSession === true}
                  onShowNew={() =>
                    navigate({ name: "sessions", newSession: true })
                  }
                  onCloseNew={() => backTo({ name: "sessions" })}
                  onCreated={(ref) => openSession(ref, { replace: true })}
                  onOpen={openSession}
                />
              )
            ) : view === "search" ? (
              <SearchView
                client={client as HubClient}
                providers={providers}
                query={route.name === "search" ? route.query : ""}
                provider={route.name === "search" ? route.provider : "all"}
                status={route.name === "search" ? route.status : "all"}
                scope={route.name === "search" ? route.scope : "sessions"}
                onNavigate={navigateSearch}
                onOpen={(ref, messageID) =>
                  openSession(ref, messageID ? { message: messageID } : undefined)
                }
              />
            ) : view === "providers" ? (
              <div className="providers-layout">
                {providerPanel}
                {diagnosticsPanel}
              </div>
            ) : view === "settings" ? (
              <>
                <section className="grid-two">
                  <article className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>Appearance</h2>
                        <p>Theme is stored locally in this browser.</p>
                      </div>
                    </div>
                    <button className="btn small" type="button" onClick={toggleTheme}>
                      Use {theme === "dark" ? "light" : "dark"} theme
                    </button>
                  </article>
                  <article className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>Providers</h2>
                        <p>Provider connections move under Providers.</p>
                      </div>
                    </div>
                    <button className="btn small" type="button" onClick={() => selectView("providers")}>
                      Open providers
                    </button>
                  </article>
                  <article className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>Access</h2>
                        <p>How this browser is authenticated.</p>
                      </div>
                      <button className="btn small" type="button" onClick={signOut}>
                        Disconnect
                      </button>
                    </div>
                    <div className="details-grid">
                      <Detail
                        label="Credential"
                        value={credentialLabel(authIdentity)}
                        mono={false}
                      />
                      <Detail
                        label="Scopes"
                        value={credentialScopes(authIdentity)}
                        mono={false}
                      />
                      <Detail
                        label="Expires"
                        value={
                          authIdentity?.kind === "owner"
                            ? "Never"
                            : authIdentity?.kind === "session" &&
                                authIdentity.expiresAt
                              ? new Date(authIdentity.expiresAt).toLocaleString()
                              : "Unknown"
                        }
                      />
                      <Detail
                        label="Admin"
                        value={authIdentity?.kind === "owner" ? "Yes" : "No"}
                        mono={false}
                      />
                    </div>
                    <p className="form-note">
                      {authIdentity?.kind === "owner"
                        ? "Owner credential. Pairing links, metrics, and MCP tokens require it. Use a paired session for everyday browsing."
                        : authIdentity?.profile === "g2"
                          ? "G2 profile. Sessions, inbox, approvals, and read-only provider/settings access. No provider edits, pairing, metrics, or MCP-token administration."
                          : authIdentity?.kind === "session"
                            ? "Phone profile. Sessions, inbox, providers, settings, and automation. No pairing, metrics, or MCP-token administration. Refreshes automatically before expiry."
                            : "The hub did not return the credential type. Reconnect to check."}
                    </p>
                  </article>
                  <article className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>About</h2>
                        <p>Frozen reference and runtime build.</p>
                      </div>
                    </div>
                    <span className="mono">design-v1.77 · v{health?.version ?? "0.1.0"}</span>
                  </article>
                </section>
                <AssistantSettingsPanel client={client as HubClient} />
                <LocalDataSettingsPanel client={client as HubClient} />
                <NotificationSettingsPanel client={client as HubClient} />
                <AutomationSettingsPanel
                  client={client as HubClient}
                  onOpenSession={(ref) =>
                    navigate({ name: "chat", ref, details: false })
                  }
                />
                {diagnosticsPanel}
              </>
            ) : (
              <Placeholder view={view} onBack={() => navigate(DEFAULT_ROUTE)} />
            )}

          </div>
        </main>

        {assistant && client ? (
          <AssistantDock
            key={JSON.stringify(assistant.scope)}
            client={client}
            initialScope={assistant.scope}
            title={assistant.title}
            project={assistant.project}
            presentation={
              assistant.scope.kind === "global" ? "dialog" : "dock"
            }
            onOpenSettings={() => {
              navigate({ name: "settings" });
            }}
            onOpenMessage={(ref, messageID) => {
              const current = routeRef.current;
              if (
                !messageID &&
                current.name === "chat" &&
                current.ref === ref
              ) {
                closeAssistant();
                return;
              }
              openSession(
                ref,
                messageID ? { message: messageID } : undefined,
              );
            }}
            onClose={closeAssistant}
          />
        ) : null}

        <nav className="bottom-nav" aria-label="Mobile navigation">
          {BOTTOM_VIEWS.map((id) => {
            const item = VIEW_META[id];
            return (
              <button
                className={`bottom-btn ${view === id ? "active" : ""}`}
                type="button"
                key={id}
                aria-current={view === id ? "page" : undefined}
                onClick={() => selectView(id)}
                aria-label={
                  id === "inbox" && totalAttention > 0
                    ? `${item.label}, ${attentionAria}`
                    : item.label
                }
              >
                <span className="bottom-mark" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                  {id === "inbox" && totalAttention > 0 ? (
                    <span className="nav-badge">{badge}</span>
                  ) : null}
                </span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function Login(props: {
  busy: boolean;
  error?: string;
  theme: string;
  onSubmit: (token: string) => Promise<void>;
  onToggleTheme: () => void;
}) {
  const [value, setValue] = useState(import.meta.env.DEV ? import.meta.env.VITE_DEV_TOKEN ?? "" : "");
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const scanVideo = useRef<HTMLVideoElement | null>(null);
  const scanOverlayRef = useRef<HTMLDivElement | null>(null);
  const scanCloseRef = useRef<HTMLButtonElement | null>(null);
  const canScan = useMemo(() => canScanPairingQr(), []);

  useEffect(() => {
    if (!scanning) return;
    const video = scanVideo.current;
    if (!video) return;

    const controller = new AbortController();
    setScanError(undefined);
    void scanPairingQr(video, controller.signal, { origin: window.location.origin })
      .then((url) => {
        if (url) {
          window.location.assign(url);
          return;
        }
        if (!controller.signal.aborted) {
          setScanError("No pairing QR found. Point the camera at the terminal QR code.");
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setScanError(
          reason instanceof Error ? reason.message : "Unable to open the camera",
        );
      });

    return () => controller.abort();
  }, [scanning]);

  useEffect(() => {
    if (!scanning) return;
    const opener = document.activeElement;
    scanCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setScanning(false);
        return;
      }
      trapTabKey(event, scanOverlayRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [scanning]);

  return (
    <div className="login-page">
      <button
        className="icon-btn login-theme"
        type="button"
        onClick={props.onToggleTheme}
        aria-label={
          props.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        }
        title={
          props.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
        }
      >
        <Icon name={props.theme === "dark" ? "sun" : "moon"} size={16} />
      </button>
      <div className="login-card">
        <div className="brand-mark">
          <BrandMark size={40} />
        </div>
        <p className="eyebrow">Oktoso</p>
        <h1>One workbench for your agents.</h1>
        <p className="login-copy">
          Enter the hub token, or open a pairing link from the hub. On first run, the hub prints a link when it starts. Provider credentials stay on the hub and never reach this client.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) void props.onSubmit(value.trim());
          }}
        >
          <label className="field-label" htmlFor="hub-token">
            Hub token
          </label>
          <input
            id="hub-token"
            className="token-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the owner or session token"
            value={value}
            onChange={(event) => setValue((event.currentTarget as HTMLInputElement).value)}
          />
          {props.error ? (
            <div className="form-error" role="alert">
              {props.error}
            </div>
          ) : null}
          <button className="btn primary login-submit" type="submit" disabled={props.busy || !value.trim()}>
            {props.busy ? "Connecting…" : "Connect to hub"}
          </button>
        </form>
        {canScan ? (
          <button
            className="btn login-scan"
            type="button"
            onClick={() => setScanning(true)}
          >
            Scan pairing QR
          </button>
        ) : null}
        {import.meta.env.DEV && import.meta.env.VITE_DEV_TOKEN ? (
          <p className="dev-hint">
            Development token prefilled from <span className="mono">VITE_DEV_TOKEN</span>.
          </p>
        ) : null}
        <p className="login-footnote">
          Single-owner build. A paired browser uses an HttpOnly cookie; a pasted token stays in this tab. If you run the hub, type <span className="mono">p</span> in its terminal or run its <span className="mono">pair</span> command.
        </p>
      </div>

      {scanning ? (
        <div
          className="qr-scan-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Scan pairing QR code"
          ref={scanOverlayRef}
        >
          <div className="qr-scan-panel">
            <h2>Scan pairing QR</h2>
            <p>Point the camera at the QR code shown in the hub terminal.</p>
            <video
              ref={scanVideo}
              className="qr-scan-video"
              autoPlay
              muted
              playsInline
            />
            {scanError ? (
              <div className="form-error" role="alert">
                {scanError}
              </div>
            ) : null}
            <button
              className="btn login-scan"
              type="button"
              ref={scanCloseRef}
              onClick={() => setScanning(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const ATTENTION_FILTERS: Array<[string, string]> = [
  ["all", "All"],
  ["approval", "Approvals"],
  ["question", "Questions"],
  ["unread", "Unread"],
  ["error", "Errors"],
];

const ATTENTION_LABELS: Record<AttentionType, string> = {
  permission: "Permission",
  approval: "Approval",
  question: "Question",
  unread: "Unread",
  error: "Error",
};

function AssistantSettingsPanel(props: { client: HubClient }) {
  const [view, setView] = useState<AssistantView>();
  const [agentModels, setAgentModels] = useState<string[]>([]);
  const [replyModels, setReplyModels] = useState<string[]>([]);
  const [transcriptionModels, setTranscriptionModels] = useState<string[]>([]);
  const [agent, setAgent] = useState({
    enabled: false,
    baseUrl: "",
    model: "",
    timeoutMs: 90_000,
    maxContextMessages: 40,
    allowWrite: false,
    apiKey: "",
  });
  const [clearAgentKey, setClearAgentKey] = useState(false);
  const [agentTest, setAgentTest] = useState<{ ok: boolean; text: string }>();
  const [testingAgent, setTestingAgent] = useState(false);
  const [reply, setReply] = useState({
    enabled: false,
    baseUrl: "",
    model: "",
    timeoutMs: 8000,
    apiKey: "",
    disableThinking: true,
  });
  const [transcription, setTranscription] = useState({
    enabled: false,
    baseUrl: "",
    model: "",
    timeoutMs: 20000,
    apiKey: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<"agent" | "reply" | "transcription">();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await props.client.assistantSettings();
      setView(next);
      const agentView = next.agent;
      setAgent({
        enabled: agentView?.enabled ?? false,
        baseUrl: agentView?.baseUrl ?? "",
        model: agentView?.model ?? "",
        timeoutMs: agentView?.timeoutMs ?? 90_000,
        maxContextMessages: agentView?.maxContextMessages ?? 20,
        allowWrite: agentView?.allowWrite ?? false,
        apiKey: "",
      });
      setClearAgentKey(false);
      setReply({
        enabled: next.reply.enabled,
        baseUrl: next.reply.baseUrl,
        model: next.reply.model,
        timeoutMs: next.reply.timeoutMs,
        apiKey: "",
        disableThinking: next.reply.disableThinking,
      });
      setTranscription({
        enabled: next.transcription.enabled,
        baseUrl: next.transcription.baseUrl,
        model: next.transcription.model,
        timeoutMs: next.transcription.timeoutMs,
        apiKey: "",
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load assistant settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [props.client]);

  const save = async (target: "agent" | "reply" | "transcription") => {
    setSaving(target);
    setError(undefined);
    setNotice(undefined);
    try {
      const value =
        target === "agent" ? agent : target === "reply" ? reply : transcription;
      const next = await props.client.saveAssistantSettings({
        [target]: {
          enabled: value.enabled,
          baseUrl: value.baseUrl.trim(),
          model: value.model.trim(),
          timeoutMs: value.timeoutMs,
          ...(target === "agent"
            ? {
                maxContextMessages: agent.maxContextMessages,
                allowWrite: agent.allowWrite,
                ...(clearAgentKey
                  ? { apiKey: null }
                  : agent.apiKey.trim()
                    ? { apiKey: agent.apiKey.trim() }
                    : {}),
              }
            : {}),
          ...(target === "reply"
            ? { disableThinking: reply.disableThinking }
            : {}),
          ...(target !== "agent" && value.apiKey.trim()
            ? { apiKey: value.apiKey.trim() }
            : {}),
        },
      });
      setView(next);
      setNotice(
        `${
          target === "agent"
            ? "Assistant endpoint"
            : target === "reply"
              ? "Reply assistance"
              : "Voice transcription"
        } saved.`,
      );
      if (target === "agent") {
        setAgent((current) => ({ ...current, apiKey: "" }));
        setClearAgentKey(false);
      } else if (target === "reply") {
        setReply((current) => ({ ...current, apiKey: "" }));
      } else {
        setTranscription((current) => ({ ...current, apiKey: "" }));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save settings");
    } finally {
      setSaving(undefined);
    }
  };

  const loadModels = async (target: "agent" | "reply" | "transcription") => {
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await props.client.assistantModels(target);
      if (target === "agent") {
        setAgentModels(result.data);
        setNotice(
          `Loaded ${result.data.length} assistant model${result.data.length === 1 ? "" : "s"} from ${result.baseUrl}.`,
        );
      } else if (target === "reply") {
        setReplyModels(result.data);
        setNotice(`Loaded ${result.data.length} reply model${result.data.length === 1 ? "" : "s"}.`);
      } else {
        setTranscriptionModels(result.data);
        setNotice(`Loaded ${result.data.length} transcription model${result.data.length === 1 ? "" : "s"}.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to reach the endpoint");
    }
  };

  const testAgent = async () => {
    setError(undefined);
    setAgentTest(undefined);
    setTestingAgent(true);
    try {
      const result = await props.client.testAssistantAgent({
        baseUrl: agent.baseUrl.trim(),
        model: agent.model.trim(),
        ...(agent.apiKey.trim() ? { apiKey: agent.apiKey.trim() } : {}),
      });
      setAgentTest({
        ok: result.ok,
        text: result.ok
          ? `Answered in ${result.latencyMs} ms · ${result.model ?? "model"}`
          : `${result.error ?? "The endpoint failed"}${result.status ? ` (HTTP ${result.status})` : ""}`,
      });
    } catch (reason) {
      setAgentTest({
        ok: false,
        text: reason instanceof Error ? reason.message : "Unable to test the endpoint",
      });
    } finally {
      setTestingAgent(false);
    }
  };

  return (
    <section className="grid-two settings-assistant">
      <article className="panel settings-agent">
        <div className="panel-head">
          <div>
            <h2>Assistant agent</h2>
            <p>
              The model that answers Ask threads. Separate from reply
              suggestions and voice transcription.
            </p>
          </div>
          <span className="mode-badge">
            {view?.agent?.hasApiKey ? "key saved" : "server-side"}
          </span>
        </div>
        <div className="form-grid">
          <label className="check-field span-2">
            <input
              type="checkbox"
              checked={agent.enabled}
              onChange={(event) => {
                const enabled = (event.currentTarget as HTMLInputElement).checked;
                setAgent((current) => ({ ...current, enabled }));
              }}
            />
            <span>Enable the assistant</span>
          </label>
          <label className="check-field span-2">
            <input
              type="checkbox"
              checked={agent.allowWrite}
              onChange={(event) => {
                const allowWrite = (event.currentTarget as HTMLInputElement).checked;
                setAgent((current) => ({ ...current, allowWrite }));
              }}
            />
            <span>
              Allow confirmed writes
              <span className="form-note">
                Actions always require confirmation in the thread. This only
                lets the assistant propose them.
              </span>
            </span>
          </label>
          <label className="form-field span-2">
            <span>OpenAI-compatible base URL</span>
            <input
              value={agent.baseUrl}
              placeholder="https://host/v1"
              onChange={(event) => {
                const baseUrl = (event.currentTarget as HTMLInputElement).value;
                setAgent((current) => ({ ...current, baseUrl }));
              }}
            />
          </label>
          <label className="form-field">
            <span>Model</span>
            <input
              value={agent.model}
              list="agent-model-options"
              placeholder="Model id"
              onChange={(event) => {
                const model = (event.currentTarget as HTMLInputElement).value;
                setAgent((current) => ({ ...current, model }));
              }}
            />
            <datalist id="agent-model-options">
              {agentModels.map((model) => (
                <option value={model} key={model} />
              ))}
            </datalist>
          </label>
          <label className="form-field">
            <span>Context messages</span>
            <input
              type="number"
              min={4}
              max={200}
              value={agent.maxContextMessages}
              onChange={(event) => {
                const maxContextMessages = Number(
                  (event.currentTarget as HTMLInputElement).value,
                );
                setAgent((current) => ({ ...current, maxContextMessages }));
              }}
            />
          </label>
          <label className="form-field">
            <span>Timeout (ms)</span>
            <input
              type="number"
              min={5000}
              max={600000}
              value={agent.timeoutMs}
              onChange={(event) => {
                const timeoutMs = Number(
                  (event.currentTarget as HTMLInputElement).value,
                );
                setAgent((current) => ({ ...current, timeoutMs }));
              }}
            />
          </label>
          <label className="form-field">
            <span>
              API key{" "}
              {view?.agent?.hasApiKey
                ? "(saved; leave blank to keep)"
                : "(optional)"}
            </span>
            <input
              type="password"
              value={agent.apiKey}
              autoComplete="off"
              placeholder={view?.agent?.hasApiKey ? "••••••••" : "No key required"}
              onChange={(event) => {
                const apiKey = (event.currentTarget as HTMLInputElement).value;
                setAgent((current) => ({ ...current, apiKey }));
                setClearAgentKey(false);
              }}
            />
          </label>
          {view?.agent?.hasApiKey ? (
            <div className="form-field span-2">
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setClearAgentKey(true);
                  setAgent((current) => ({ ...current, apiKey: "" }));
                }}
              >
                {clearAgentKey ? "The saved key will be cleared on save" : "Clear saved key"}
              </button>
            </div>
          ) : null}
        </div>
        <div className="form-actions">
          <button
            className="btn small"
            type="button"
            aria-label="Load assistant models"
            onClick={() => void loadModels("agent")}
          >
            Load models
          </button>
          <button
            className="btn small"
            type="button"
            aria-label="Test the assistant endpoint"
            disabled={testingAgent || !agent.baseUrl.trim() || !agent.model.trim()}
            onClick={() => void testAgent()}
          >
            {testingAgent ? "Testing…" : "Test connection"}
          </button>
          <button
            className="btn primary small"
            type="button"
            aria-label="Save assistant agent"
            disabled={saving === "agent"}
            onClick={() => void save("agent")}
          >
            {saving === "agent" ? "Saving…" : "Save"}
          </button>
        </div>
        {agentTest ? (
          <p
            className={`form-note ${agentTest.ok ? "" : "form-error"}`}
            role={agentTest.ok ? "status" : "alert"}
          >
            {agentTest.text}
          </p>
        ) : null}
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Reply assistance</h2>
            <p>Short next-reply suggestions for wearable clients. Generated on the hub.</p>
          </div>
          <span className="mode-badge">{view?.reply.hasApiKey ? "key saved" : "server-side"}</span>
        </div>
        <div className="form-grid">
          <label className="check-field span-2">
            <input
              type="checkbox"
              checked={reply.enabled}
              onChange={(event) => {
                const enabled = (event.currentTarget as HTMLInputElement).checked;
                setReply((current) => ({ ...current, enabled }));
              }}
            />
            <span>Enable contextual reply suggestions</span>
          </label>
          <label className="check-field span-2">
            <input
              type="checkbox"
              checked={reply.disableThinking}
              onChange={(event) => {
                const disableThinking = (event.currentTarget as HTMLInputElement).checked;
                setReply((current) => ({ ...current, disableThinking }));
              }}
            />
            <span>Disable model thinking (recommended for short suggestions)</span>
          </label>
          <label className="form-field span-2">
            <span>OpenAI-compatible base URL</span>
            <input
              value={reply.baseUrl}
              placeholder="https://host/v1"
              onChange={(event) => {
                const baseUrl = (event.currentTarget as HTMLInputElement).value;
                setReply((current) => ({ ...current, baseUrl }));
              }}
            />
          </label>
          <label className="form-field">
            <span>Model</span>
            <input
              value={reply.model}
              list="reply-model-options"
              placeholder="4B model"
              onChange={(event) => {
                const model = (event.currentTarget as HTMLInputElement).value;
                setReply((current) => ({ ...current, model }));
              }}
            />
            <datalist id="reply-model-options">
              {replyModels.map((model) => <option value={model} key={model} />)}
            </datalist>
          </label>
          <label className="form-field">
            <span>Timeout (ms)</span>
            <input
              type="number"
              min={1000}
              max={60000}
              value={reply.timeoutMs}
              onChange={(event) => {
                const timeoutMs = Number((event.currentTarget as HTMLInputElement).value);
                setReply((current) => ({ ...current, timeoutMs }));
              }}
            />
          </label>
          <label className="form-field span-2">
            <span>API key {view?.reply.hasApiKey ? "(saved; leave blank to keep)" : "(optional)"}</span>
            <input
              type="password"
              value={reply.apiKey}
              autoComplete="off"
              placeholder={view?.reply.hasApiKey ? "••••••••" : "No key required"}
              onChange={(event) => {
                const apiKey = (event.currentTarget as HTMLInputElement).value;
                setReply((current) => ({ ...current, apiKey }));
              }}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn small" type="button" aria-label="Load reply models" onClick={() => void loadModels("reply")}>
            Load models
          </button>
          <button className="btn primary small" type="button" aria-label="Save reply assistance" disabled={saving === "reply"} onClick={() => void save("reply")}>
            {saving === "reply" ? "Saving…" : "Save"}
          </button>
        </div>
      </article>

      <article className="panel">
        <div className="panel-head">
          <div>
            <h2>Voice transcription</h2>
            <p>
              Optional speech-to-text path for the web composer and future
              wearable microphone input. Audio goes through the hub to the
              configured OpenAI-compatible endpoint.
            </p>
          </div>
          <span className="mode-badge">{view?.transcription.hasApiKey ? "key saved" : "optional"}</span>
        </div>
        <div className="form-grid">
          <label className="check-field span-2">
            <input
              type="checkbox"
              checked={transcription.enabled}
              onChange={(event) => {
                const enabled = (event.currentTarget as HTMLInputElement).checked;
                setTranscription((current) => ({ ...current, enabled }));
              }}
            />
            <span>Enable voice transcription</span>
          </label>
          <label className="form-field span-2">
            <span>OpenAI-compatible STT base URL</span>
            <input
              value={transcription.baseUrl}
              placeholder="https://host/v1"
              onChange={(event) => {
                const baseUrl = (event.currentTarget as HTMLInputElement).value;
                setTranscription((current) => ({ ...current, baseUrl }));
              }}
            />
          </label>
          <label className="form-field">
            <span>Model</span>
            <input
              value={transcription.model}
              list="transcription-model-options"
              placeholder="whisper-large-v3"
              onChange={(event) => {
                const model = (event.currentTarget as HTMLInputElement).value;
                setTranscription((current) => ({ ...current, model }));
              }}
            />
            <datalist id="transcription-model-options">
              {transcriptionModels.map((model) => <option value={model} key={model} />)}
            </datalist>
          </label>
          <label className="form-field">
            <span>Timeout (ms)</span>
            <input
              type="number"
              min={1000}
              max={120000}
              value={transcription.timeoutMs}
              onChange={(event) => {
                const timeoutMs = Number((event.currentTarget as HTMLInputElement).value);
                setTranscription((current) => ({ ...current, timeoutMs }));
              }}
            />
          </label>
          <label className="form-field span-2">
            <span>API key {view?.transcription.hasApiKey ? "(saved; leave blank to keep)" : "(optional)"}</span>
            <input
              type="password"
              value={transcription.apiKey}
              autoComplete="off"
              placeholder={view?.transcription.hasApiKey ? "••••••••" : "No key required"}
              onChange={(event) => {
                const apiKey = (event.currentTarget as HTMLInputElement).value;
                setTranscription((current) => ({ ...current, apiKey }));
              }}
            />
          </label>
        </div>
        <p className="form-note">
          Browser dictation requires HTTPS or localhost and microphone
          permission. The hub does not store the audio; the endpoint key stays
          on the hub.
        </p>
        <div className="form-actions">
          <button className="btn small" type="button" aria-label="Load voice transcription models" onClick={() => void loadModels("transcription")}>
            Load models
          </button>
          <button className="btn primary small" type="button" aria-label="Save voice transcription" disabled={saving === "transcription"} onClick={() => void save("transcription")}>
            {saving === "transcription" ? "Saving…" : "Save"}
          </button>
        </div>
      </article>

      {loading ? <div className="form-note">Loading assistant settings…</div> : null}
      {notice ? <div className="form-note">{notice}</div> : null}
      {error ? <div className="form-error span-2" role="alert">{error}</div> : null}
    </section>
  );
}

function InboxView(props: {
  client: HubClient;
  events: HubEvent[];
  filter: string;
  onFilterChange: (filter: string) => void;
  onOpen: (ref: string) => void;
  onNewSession: () => void;
}) {
  const key = useRouteDataKey();
  const cachedItems = useRef(
    readRouteCache<Attention[]>(key, "inbox-items"),
  );
  const cachedApprovals = useRef(
    readRouteCache<AutomationApproval[]>(key, "inbox-approvals"),
  );
  const hydrated = cachedItems.current !== undefined;
  const [items, setItems] = useState<Attention[]>(cachedItems.current ?? []);
  const [approvals, setApprovals] = useState<AutomationApproval[]>(
    cachedApprovals.current ?? [],
  );
  const filter = ATTENTION_FILTERS.some(([value]) => value === props.filter)
    ? props.filter
    : "all";
  const [loading, setLoading] = useState(!hydrated);
  const [checking, setChecking] = useState(hydrated);
  const [busyID, setBusyID] = useState<string>();
  const [error, setError] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const seenBlocking = useRef<Set<string> | null>(null);
  useRevalidationIndicator(checking);

  /**
   * Announce only blocking work that arrives after the first successful load.
   * The baseline is captured from the first page, so the initial render and
   * every ordinary refresh stay silent.
   */
  const announceNewBlocking = (
    nextItems: Attention[],
    nextApprovals: AutomationApproval[],
  ) => {
    const blocking = [
      ...nextItems
        .filter((item) => item.priority === "blocking")
        .map((item) => ({ key: `attention:${item.id}`, title: item.title })),
      ...nextApprovals.map((approval) => ({
        key: `approval:${approval.id}`,
        title: approval.title,
      })),
    ];
    const previous = seenBlocking.current;
    seenBlocking.current = new Set(blocking.map((item) => item.key));
    if (!previous) return;
    const fresh = blocking.filter((item) => !previous.has(item.key));
    if (fresh.length === 0) return;
    setAnnouncement(
      fresh.length === 1
        ? `New blocking request: ${fresh[0]!.title}`
        : `${fresh.length} new blocking requests: ${fresh
            .map((item) => item.title)
            .join("; ")}`,
    );
  };

  const load = async (mode: "initial" | "revalidate" | "silent" = "initial") => {
    if (mode === "initial") setLoading(true);
    if (mode === "revalidate") setChecking(true);
    if (mode !== "silent") setError(undefined);
    try {
      const [page, nextApprovals] = await Promise.all([
        props.client.attention(),
        props.client.automationApprovals().catch(() => []),
      ]);
      setItems(page.data);
      setApprovals(nextApprovals);
      setError(undefined);
      announceNewBlocking(page.data, nextApprovals);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load attention");
    } finally {
      if (mode === "initial") setLoading(false);
      if (mode === "revalidate") setChecking(false);
    }
  };

  useEffect(() => {
    if (loading || checking || error) return;
    writeRouteCache(key, "inbox-items", items);
    writeRouteCache(key, "inbox-approvals", approvals);
  }, [approvals, checking, error, items, key, loading]);

  useEffect(() => {
    void load(hydrated ? "revalidate" : "initial");
    const timer = setInterval(() => void load("silent"), 15_000);
    return () => clearInterval(timer);
  }, [props.client]);

  const liveSeq =
    props.events.find(
      (event) =>
        event.type.startsWith("session.") ||
        event.type.startsWith("attention.") ||
        event.type === "automation.approval" ||
        event.type === "resync",
    )?.seq ?? 0;
  useEffect(() => {
    if (!liveSeq) return;
    const timer = setTimeout(() => void load("silent"), 600);
    return () => clearTimeout(timer);
  }, [liveSeq]);

  const count = (value: string) => {
    if (value === "all") return items.length + approvals.length;
    if (value === "approval") {
      return (
        items.filter(
          (item) => item.type === "permission" || item.type === "approval",
        ).length + approvals.length
      );
    }
    return items.filter((item) => item.type === value).length;
  };

  const visibleApprovals =
    filter === "all" || filter === "approval" ? approvals : [];

  const visible = items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "approval") return item.type === "permission" || item.type === "approval";
    return item.type === filter;
  });

  const groups = [
    ["Blocking", visible.filter((item) => item.priority === "blocking")],
    ["Unread", visible.filter((item) => item.type === "unread")],
    ["Errors", visible.filter((item) => item.type === "error")],
    [
      "Other",
      visible.filter(
        (item) => item.priority !== "blocking" && item.type !== "unread" && item.type !== "error",
      ),
    ],
  ] as const;

  const act = async (item: Attention, action: string, input = {}) => {
    setBusyID(item.id);
    setError(undefined);
    try {
      await props.client.actOnAttention(item.id, action, input);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to complete the action");
    } finally {
      setBusyID(undefined);
    }
  };

  const actOnApproval = async (
    approval: AutomationApproval,
    action: string,
  ) => {
    setBusyID(approval.id);
    setError(undefined);
    try {
      await props.client.actOnApproval(
        approval.id,
        action === "deny" ? "deny" : "approve",
      );
      setApprovals((current) =>
        current.filter((candidate) => candidate.id !== approval.id),
      );
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to decide the approval",
      );
    } finally {
      setBusyID(undefined);
    }
  };

  return (
    <>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
      {error ? (
        <div className="alert" role="alert">
          {error}
          <button className="text-button" type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="page-toolbar inbox-toolbar">
        <div className="inbox-tabs">
          {ATTENTION_FILTERS.map(([value, label]) => {
            const total = count(value);
            return (
              <button
                className={`chip ${filter === value ? "active" : ""}`}
                type="button"
                key={value}
                aria-pressed={filter === value}
                aria-label={`${label}, ${total} ${total === 1 ? "item" : "items"}`}
                onClick={() => props.onFilterChange(value)}
              >
                {label} {total}
              </button>
            );
          })}
        </div>
        <div className="inbox-toolbar-actions">
          <button
            className="btn small"
            type="button"
            disabled={loading || checking}
            onClick={() =>
              void load(
                hydrated || items.length > 0 || approvals.length > 0
                  ? "revalidate"
                  : "initial",
              )
            }
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            className="btn small"
            type="button"
            onClick={props.onNewSession}
          >
            New session
          </button>
        </div>
      </div>

      {loading && items.length === 0 && approvals.length === 0 ? (
        <div className="empty">Loading attention…</div>
      ) : checking && items.length === 0 && approvals.length === 0 ? (
        <div className="empty">Checking for requests…</div>
      ) : visible.length === 0 && visibleApprovals.length === 0 ? (
        <div className="empty">Nothing needs you right now.</div>
      ) : (
        <>
        {visibleApprovals.length > 0 ? (
          <section className="inbox-group">
            <div className="inbox-group-head">
              <span>Automation</span>
              <span className="line" />
              <span>{visibleApprovals.length}</span>
            </div>
            {visibleApprovals.map((approval) => (
              <AttentionCard
                client={props.client}
                item={approvalAttention(approval)}
                key={approval.id}
                busy={busyID === approval.id}
                detail={`${approval.watcherID} · ${automationReasonLabel(
                  approval.reason,
                )}${approval.proposed ? ` · ${approval.proposed.text}` : ""}`}
                onAction={(action) => void actOnApproval(approval, action)}
                onOpen={() => props.onOpen(approval.sessionRef)}
              />
            ))}
          </section>
        ) : null}
        {groups
          .filter(([, groupItems]) => groupItems.length > 0)
          .map(([label, groupItems]) => (
            <section className="inbox-group" key={label}>
              <div className="inbox-group-head">
                <span>{label}</span>
                <span className="line" />
                <span>{groupItems.length}</span>
              </div>
              {groupItems.map((item) => (
                <AttentionCard
                  client={props.client}
                  item={item}
                  key={item.id}
                  busy={busyID === item.id}
                  detail={attentionDetailText(item)}
                  onAction={(action, input) => void act(item, action, input)}
                  onOpen={() => props.onOpen(item.sessionRef)}
                />
              ))}
            </section>
          ))}
        </>
      )}
    </>
  );
}

function approvalAttention(approval: AutomationApproval): Attention {
  return {
    id: approval.id,
    sessionRef: approval.sessionRef,
    type: "approval",
    priority: "blocking",
    title: approval.title,
    summary: approval.summary,
    createdAt: approval.createdAt,
    actions: [
      { id: "approve_once", label: "Approve", style: "primary" },
      { id: "deny", label: "Deny", style: "danger" },
    ],
    payload: { watcherID: approval.watcherID, reason: approval.reason },
  };
}

function attentionDetailText(item: Attention): string | undefined {
  if (item.type !== "question") return undefined;
  const payload = item.payload;
  if (!payload || typeof payload !== "object") return undefined;
  for (const key of ["description", "message", "question", "text"]) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      const detail = value.trim();
      if (
        detail !== item.summary.trim() &&
        detail !== item.title.trim() &&
        !item.summary.includes(detail)
      ) {
        return detail;
      }
    }
  }
  return undefined;
}

function latestQuestionText(messages: Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (!text) continue;
    const paragraphs = text
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    for (let paragraph = paragraphs.length - 1; paragraph >= 0; paragraph -= 1) {
      const lines = (paragraphs[paragraph] ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      for (let line = lines.length - 1; line >= 0; line -= 1) {
        const candidate = (lines[line] ?? "")
          .replace(/^[-*]\s+/, "")
          .replace(/^\d+[.)]\s+/, "")
          .trim();
        if (candidate.includes("?") && candidate.length <= 500) {
          return candidate;
        }
      }
    }
  }
  return undefined;
}

type AttentionDraftPayload = {
  v: 1;
  values: Record<string, unknown>;
};

function attentionInitialValues(
  fields: NonNullable<Attention["fields"]>,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.map((field) => [
      field.id,
      field.defaultValue ??
        (field.type === "boolean"
          ? false
          : field.type === "multiselect"
            ? []
            : ""),
    ]),
  );
}

function encodeAttentionDraft(values: Record<string, unknown>): string {
  return JSON.stringify({ v: 1, values } satisfies AttentionDraftPayload);
}

function decodeAttentionDraft(
  text: string,
  fields: NonNullable<Attention["fields"]>,
): Record<string, unknown> | undefined {
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object") return undefined;
    const payload = parsed as Partial<AttentionDraftPayload>;
    if (payload.v !== 1 || !payload.values || typeof payload.values !== "object") {
      return undefined;
    }
    const allowed = new Set(fields.map((field) => field.id));
    return Object.fromEntries(
      Object.entries(payload.values).filter(([id]) => allowed.has(id)),
    );
  } catch {
    return undefined;
  }
}

function AttentionCard(props: {
  client: HubClient;
  item: Attention;
  busy: boolean;
  inline?: boolean;
  detail?: string;
  onAction: (action: string, input?: Record<string, unknown>) => void;
  onOpen?: () => void;
  onRetry?: () => void;
  retryBusy?: boolean;
  onContinue?: () => void;
  continueBusy?: boolean;
}) {
  const item = props.item;
  const fields = item.fields ?? [];
  const hasFields = fields.length > 0;
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    attentionInitialValues(fields),
  );
  const touched = useRef(false);
  const submitted = useRef(false);
  const draft = useDraftSlot({
    client: props.client,
    key: hasFields ? `draft:attention:${item.id}` : undefined,
    enabled: hasFields,
    onLoad: (text) => {
      const saved = decodeAttentionDraft(text, fields);
      if (!saved) return;
      setValues((current) => ({
        ...attentionInitialValues(fields),
        ...current,
        ...saved,
      }));
    },
  });
  const draftStatus = draftSlotStatusText(draft.status);
  useEffect(() => {
    if (!draft.loaded || !hasFields || !touched.current) return;
    draft.save(encodeAttentionDraft(values));
  }, [draft.loaded, draft.save, hasFields, values]);
  useEffect(() => {
    return () => {
      if (submitted.current) void draft.clear();
    };
  }, [draft.clear]);
  const answerAction = item.actions.find((action) => action.id === "answer");
  const missingRequired = fields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.id];
    return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  });
  const actionInput = () => (hasFields ? { fields: values } : {});
  const setFieldValue = (id: string, value: unknown) => {
    touched.current = true;
    setValues((current) => ({ ...current, [id]: value }));
  };

  return (
    <article className={`attention-card ${item.priority === "blocking" ? "blocking" : ""}`}>
      <div className="attention-top">
        <span className={`type-badge ${item.type}`}>{ATTENTION_LABELS[item.type]}</span>
        <span className="attention-provider">{providerLabel(item.sessionRef.split(":")[0] ?? "")}</span>
        <time
          className="attention-age"
          dateTime={new Date(item.createdAt).toISOString()}
          title={formatDateTime(item.createdAt)}
        >
          {relativeTime(item.createdAt)}
        </time>
      </div>
      <div className="attention-title">{item.title}</div>
      <div className="attention-summary">{item.summary}</div>
      {props.detail ? <div className="attention-detail">{props.detail}</div> : null}

      {hasFields ? (
        <div className="attention-fields">
          {fields.map((field) => (
            <AttentionFieldInput
              field={field}
              key={field.id}
              attentionID={item.id}
              value={values[field.id]}
              onValue={(value) => setFieldValue(field.id, value)}
            />
          ))}
          {draftStatus ? (
            <span className="attention-help" role="status">
              {draftStatus}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="attention-actions">
        {item.actions
          .filter((action) => action.id !== "answer")
          .map((action) => (
            <button
              className={`btn small ${action.style === "primary" ? "primary" : action.style === "danger" ? "danger" : ""}`}
              type="button"
              key={action.id}
              disabled={props.busy}
              onClick={() => props.onAction(action.id)}
            >
              {action.label}
            </button>
          ))}
        {props.onRetry ? (
          <button
            className="btn small"
            type="button"
            disabled={props.busy || props.retryBusy}
            onClick={props.onRetry}
          >
            {props.retryBusy ? "Retrying…" : "Retry turn"}
          </button>
        ) : null}
        {props.onContinue ? (
          <button
            className="btn small secondary"
            type="button"
            disabled={props.busy || props.continueBusy}
            onClick={props.onContinue}
          >
            {props.continueBusy ? "Sending…" : "Continue"}
          </button>
        ) : null}
        {answerAction ? (
          <button
            className="btn primary small"
            type="button"
            disabled={props.busy || missingRequired.length > 0}
            aria-describedby={
              missingRequired.length > 0
                ? `attention-required-${item.id}`
                : undefined
            }
            onClick={() => {
              submitted.current = true;
              props.onAction("answer", actionInput());
            }}
          >
            {answerAction.label}
          </button>
        ) : null}
        {answerAction && missingRequired.length > 0 ? (
          <span
            className="attention-required"
            id={`attention-required-${item.id}`}
            aria-live="polite"
          >
            Complete {missingRequired.map((field) => field.label).join(", ")}
          </span>
        ) : null}
        {!props.inline && props.onOpen ? (
          <button className="attention-open" type="button" onClick={props.onOpen}>
            Open session
          </button>
        ) : null}
      </div>
    </article>
  );
}

function QuestionAnswerCard(props: { answered: AnsweredQuestionPart }) {
  const { answered } = props;
  const multiple = answered.questions.length > 1;
  return (
    <section
      className="question-answer"
      aria-label={multiple ? "Answered questions" : "Answered question"}
    >
      <div className="question-answer-top">
        <span className="type-badge question">Question</span>
        <span className="question-answer-state">Answered</span>
        {answered.completedAt !== undefined ? (
          <time
            dateTime={new Date(answered.completedAt).toISOString()}
            title={formatDateTime(answered.completedAt)}
          >
            {formatTime(answered.completedAt)}
          </time>
        ) : null}
      </div>
      <div className="question-answer-items">
        {answered.questions.map((question, index) => (
          <div className="question-answer-item" key={`${question.question}:${index}`}>
            {question.header && question.header !== question.question ? (
              <div className="question-answer-header">{question.header}</div>
            ) : null}
            <p className="question-answer-prompt">{question.question}</p>
            <div className="question-answer-response">
              <span className="question-answer-label">
                {question.answers.length > 1 ? "Selected" : "Answer"}
              </span>
              {question.answers.length === 0 ? (
                <p className="question-answer-value empty">No answer recorded</p>
              ) : question.answers.length === 1 ? (
                <p className="question-answer-value">{question.answers[0]}</p>
              ) : (
                <ul className="question-answer-values">
                  {question.answers.map((answer, answerIndex) => (
                    <li key={`${answer}:${answerIndex}`}>{answer}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function AttentionFieldInput(props: {
  field: NonNullable<Attention["fields"]>[number];
  attentionID: string;
  value: unknown;
  onValue: (value: unknown) => void;
}) {
  const { field } = props;
  if (field.type === "boolean") {
    return (
      <label className="attention-check">
        <input
          type="checkbox"
          checked={Boolean(props.value)}
          aria-required={field.required || undefined}
          onChange={(event) => props.onValue((event.currentTarget as HTMLInputElement).checked)}
        />
        <span>{field.label}</span>
        {field.description ? <small className="attention-help">{field.description}</small> : null}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <AttentionChoiceField
        field={field}
        attentionID={props.attentionID}
        value={props.value}
        onValue={props.onValue}
      />
    );
  }
  if (field.type === "multiselect") {
    const selected = Array.isArray(props.value) ? (props.value as string[]) : [];
    return (
      <fieldset className="attention-field attention-multi">
        <legend>{field.label}</legend>
        {(field.options ?? []).map((option) => (
          <label className="attention-check" key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) => {
                const checked = (event.currentTarget as HTMLInputElement).checked;
                props.onValue(
                  checked
                    ? [...selected, option.value]
                    : selected.filter((value) => value !== option.value),
                );
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {field.description ? <small className="attention-help">{field.description}</small> : null}
      </fieldset>
    );
  }
  if (field.type === "textarea") {
    return (
      <label className="attention-field attention-field-wide">
        <span>{field.label}</span>
        <textarea
          rows={3}
          value={typeof props.value === "string" ? props.value : ""}
          placeholder={field.placeholder}
          aria-required={field.required || undefined}
          onChange={(event) => props.onValue((event.currentTarget as HTMLTextAreaElement).value)}
        />
        {field.description ? <small className="attention-help">{field.description}</small> : null}
      </label>
    );
  }
  return (
    <label className={`attention-field ${field.type === "number" ? "" : "attention-field-wide"}`}>
      <span>{field.label}</span>
      <input
        type={field.type === "number" ? "number" : "text"}
        value={typeof props.value === "string" || typeof props.value === "number" ? props.value : ""}
        placeholder={field.placeholder}
        aria-required={field.required || undefined}
        onChange={(event) => {
          const value = (event.currentTarget as HTMLInputElement).value;
          props.onValue(
            field.type === "number" ? (value === "" ? "" : Number(value)) : value,
          );
        }}
      />
      {field.description ? <small className="attention-help">{field.description}</small> : null}
    </label>
  );
}

function AttentionChoiceField(props: {
  field: NonNullable<Attention["fields"]>[number];
  attentionID: string;
  value: unknown;
  onValue: (value: unknown) => void;
}) {
  const { field } = props;
  const options = field.options ?? [];
  const selected = typeof props.value === "string" ? props.value : "";
  const customValue =
    selected !== "" && !options.some((option) => option.value === selected);
  const [customMode, setCustomMode] = useState(customValue);

  useEffect(() => {
    if (customValue) setCustomMode(true);
  }, [customValue]);

  const name = `attention-${props.attentionID}-${field.id}`;
  return (
    <fieldset className="attention-field attention-field-wide attention-choice-field">
      <legend className="attention-field-title">{field.label}</legend>
      {field.description ? (
        <p className="attention-question">{field.description}</p>
      ) : null}
      <span className="attention-help">Select one answer</span>
      <div className="attention-choices">
        {options.map((option, index) => {
          const checked = !customMode && selected === option.value;
          return (
            <label
              className={`attention-choice ${checked ? "selected" : ""}`}
              key={option.value}
            >
              <input
                type="radio"
                name={name}
                checked={checked}
                aria-required={field.required || undefined}
                onChange={() => {
                  setCustomMode(false);
                  props.onValue(option.value);
                }}
              />
              <span className="attention-choice-copy">
                <span className="attention-choice-label">{option.label}</span>
                {option.description ? (
                  <span className="attention-choice-desc">
                    {option.description}
                  </span>
                ) : null}
              </span>
              <span className="attention-choice-index" aria-hidden="true">
                {index + 1}
              </span>
            </label>
          );
        })}
        {field.custom ? (
          <label
            className={`attention-choice ${customMode ? "selected" : ""}`}
          >
            <input
              type="radio"
              name={name}
              checked={customMode}
              aria-required={field.required || undefined}
              onChange={() => {
                setCustomMode(true);
                if (options.some((option) => option.value === selected)) {
                  props.onValue("");
                }
              }}
            />
            <span className="attention-choice-copy">
              <span className="attention-choice-label">
                Type your own answer…
              </span>
              {customMode ? (
                <input
                  className="attention-choice-input"
                  type="text"
                  value={selected}
                  placeholder="Type your answer"
                  aria-label={`Your answer for ${field.label}`}
                  onChange={(event) => props.onValue(event.currentTarget.value)}
                />
              ) : null}
            </span>
            <span className="attention-choice-index" aria-hidden="true">
              {options.length + 1}
            </span>
          </label>
        ) : null}
      </div>
    </fieldset>
  );
}

interface SearchSnapshot {
  sessions: Session[];
  hits: SearchResult[];
  warnings: SessionWarning[];
  indexed: { enabled: boolean; ready: boolean };
}

function SearchView(props: {
  client: HubClient;
  providers: Provider[];
  query: string;
  provider: string;
  status: SessionStatus | "all";
  scope: SearchScope;
  onNavigate: (next: SearchState, options?: NavigateOptions) => void;
  onOpen: (ref: string, messageID?: string) => void;
}) {
  const key = useRouteDataKey();
  const [cached] = useState<SearchSnapshot | undefined>(() =>
    readRouteCache<SearchSnapshot>(key, "search"),
  );
  const [draft, setDraft] = useState(props.query);
  const [sessions, setSessions] = useState<Session[]>(
    () => cached?.sessions ?? [],
  );
  const [hits, setHits] = useState<SearchResult[]>(() => cached?.hits ?? []);
  const [indexed, setIndexed] = useState(
    () => cached?.indexed ?? { enabled: true, ready: true },
  );
  const initialQuery = props.query.trim();
  const initialHasRequest = props.scope === "messages"
    ? initialQuery.length > 0
    : initialQuery.length > 0 ||
      props.provider !== "all" ||
      props.status !== "all";
  const [loading, setLoading] = useState(!cached && initialHasRequest);
  const [checking, setChecking] = useState(Boolean(cached));
  const [warnings, setWarnings] = useState<SessionWarning[]>(
    () => cached?.warnings ?? [],
  );
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const sentQuery = useRef(props.query);
  const { provider, status, scope } = props;
  useRevalidationIndicator(checking);

  const trimmed = draft.trim();
  const hasFilters = provider !== "all" || status !== "all";
  const messages = scope === "messages";

  useEffect(() => {
    const request = ++requestRef.current;
    setError(undefined);

    if (messages ? !trimmed : !trimmed && !hasFilters) {
      setSessions([]);
      setHits([]);
      setWarnings([]);
      setLoading(false);
      setChecking(false);
      return;
    }

    const requestKey = searchDataKey({
      query: trimmed,
      provider,
      status,
      scope,
    });
    const cachedPage = readRouteCache<SearchSnapshot>(requestKey, "search");
    if (cachedPage) {
      setSessions(cachedPage.sessions);
      setHits(cachedPage.hits);
      setWarnings(cachedPage.warnings);
      setIndexed(cachedPage.indexed);
      setLoading(false);
      setChecking(true);
    } else {
      setLoading(true);
      setChecking(false);
    }

    const timer = setTimeout(() => {
      const done = (run: () => void) => {
        if (request !== requestRef.current) return;
        run();
        setLoading(false);
        setChecking(false);
      };

      if (messages) {
        props.client
          .search({
            q: trimmed,
            scope: "messages",
            ...(provider !== "all" ? { provider } : {}),
            ...(status !== "all" ? { status } : {}),
            limit: 50,
          })
          .then((page) => {
            const nextIndexed = { enabled: page.enabled, ready: page.ready };
            done(() => {
              setSessions([]);
              setHits(page.data);
              setWarnings([]);
              setIndexed(nextIndexed);
              writeRouteCache<SearchSnapshot>(requestKey, "search", {
                sessions: [],
                hits: page.data,
                warnings: [],
                indexed: nextIndexed,
              });
            });
          })
          .catch((reason: unknown) =>
            done(() => {
              if (!cachedPage) setHits([]);
              setError(
                reason instanceof Error
                  ? reason.message
                  : "Unable to search messages",
              );
            }),
          );
        return;
      }

      props.client
        .sessions({
          ...(trimmed ? { q: trimmed } : {}),
          ...(provider !== "all" ? { provider } : {}),
          ...(status !== "all" ? { status } : {}),
          limit: 100,
        })
        .then((page) => {
          const nextWarnings = page.warnings ?? [];
          done(() => {
            setSessions(page.data);
            setHits([]);
            setWarnings(nextWarnings);
            writeRouteCache<SearchSnapshot>(requestKey, "search", {
              sessions: page.data,
              hits: [],
              warnings: nextWarnings,
              indexed,
            });
          });
        })
        .catch((reason: unknown) =>
          done(() => {
            if (!cachedPage) setSessions([]);
            setError(
              reason instanceof Error
                ? reason.message
                : "Unable to search sessions",
            );
          }),
        );
    }, 300);

    return () => clearTimeout(timer);
  }, [
    props.client,
    messages,
    trimmed,
    provider,
    status,
    scope,
    hasFilters,
    attempt,
  ]);

  useEffect(() => {
    if (props.query === sentQuery.current) return;
    sentQuery.current = props.query;
    setDraft(props.query);
  }, [props.query]);

  useEffect(() => {
    if (draft === sentQuery.current) return;
    const timer = window.setTimeout(() => {
      sentQuery.current = draft;
      props.onNavigate(
        { query: draft, provider, status, scope },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, provider, status, scope, props.onNavigate]);

  const selectProvider = (value: string) => {
    sentQuery.current = draft;
    props.onNavigate({ query: draft, provider: value, status, scope });
  };

  const selectStatus = (value: SessionStatus | "all") => {
    sentQuery.current = draft;
    props.onNavigate({ query: draft, provider, status: value, scope });
  };

  const selectScope = (value: SearchScope) => {
    sentQuery.current = draft;
    props.onNavigate({ query: draft, provider, status, scope: value });
  };

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const sessionCount = sessions.length;
  const messageCount = hits.length;
  const resultSummary = loading
    ? messages
      ? "Searching messages…"
      : "Searching sessions…"
    : messages
      ? `${messageCount} message${messageCount === 1 ? "" : "s"} matched${
          indexed.ready ? "" : " · index catching up"
        }`
      : `${sessionCount} session${sessionCount === 1 ? "" : "s"} matched`;

  const emptyPrompt = messages
    ? indexed.enabled
      ? "Type a query to search message text in cached transcripts."
      : "Message search needs the transcript cache. Turn it on in Settings → Local data."
    : "Type a query or choose a provider or status filter to search sessions across providers.";

  return (
    <>
      <section className="panel search-panel">
        <label className="sr-only" htmlFor="session-search">
          {messages ? "Search messages" : "Search sessions"}
        </label>
        <input
          id="session-search"
          ref={inputRef}
          className="search-input"
          type="search"
          value={draft}
          placeholder={messages ? "Search messages…" : "Search sessions…"}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setDraft("");
            }
          }}
        />

        <div className="search-filters" role="group" aria-label="Search scope">
          <span className="search-filter-label">Scope</span>
          <button
            className={`chip ${scope === "sessions" ? "active" : ""}`}
            type="button"
            aria-pressed={scope === "sessions"}
            onClick={() => selectScope("sessions")}
          >
            Sessions
          </button>
          <button
            className={`chip ${scope === "messages" ? "active" : ""}`}
            type="button"
            aria-pressed={scope === "messages"}
            onClick={() => selectScope("messages")}
          >
            Messages
          </button>
        </div>

        <div className="search-filters" role="group" aria-label="Provider filter">
          <span className="search-filter-label">Provider</span>
          <button
            className={`chip ${provider === "all" ? "active" : ""}`}
            type="button"
            aria-pressed={provider === "all"}
            onClick={() => selectProvider("all")}
          >
            All
          </button>
          {props.providers.map((item) => (
            <button
              className={`chip ${provider === item.id ? "active" : ""}`}
              type="button"
              key={item.id}
              aria-pressed={provider === item.id}
              onClick={() => selectProvider(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>

        <div className="search-filters" role="group" aria-label="Status filter">
          <span className="search-filter-label">Status</span>
          <button
            className={`chip ${status === "all" ? "active" : ""}`}
            type="button"
            aria-pressed={status === "all"}
            onClick={() => selectStatus("all")}
          >
            Any
          </button>
          {(["running", "idle", "error", "offline"] as const).map((value) => (
            <button
              className={`chip ${status === value ? "active" : ""}`}
              type="button"
              key={value}
              aria-pressed={status === value}
              onClick={() => selectStatus(value)}
            >
              {statusLabel(value)}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <div className="alert" role="alert">
          {error}
          <button
            className="text-button"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}

      {(messages ? !trimmed : !trimmed && !hasFilters) ? (
        <div className="empty">{emptyPrompt}</div>
      ) : (loading || checking) && (messages ? hits : sessions).length === 0 ? (
        <div className="empty">
          {checking && !loading
            ? messages
              ? "Checking messages…"
              : "Checking for sessions…"
            : messages
              ? "Searching messages…"
              : "Searching sessions…"}
        </div>
      ) : !loading && !checking && (messages ? hits : sessions).length === 0 && !error ? (
        messages && !indexed.enabled ? (
          <div className="empty">{emptyPrompt}</div>
        ) : messages && !indexed.ready ? (
          <div className="empty">
            The message index is still catching up with the transcript cache.
            Try again in a moment.
          </div>
        ) : (
          <div className="empty">
            No {messages ? "messages" : "sessions"} match{" "}
            {trimmed ? `“${trimmed}”` : "these filters"}.
          </div>
        )
      ) : messages && hits.length > 0 ? (
        <section className="panel search-results-panel" aria-busy={loading || checking}>
          <div className="panel-head">
            <div>
              <h2>Results</h2>
              <p role="status">{resultSummary}</p>
            </div>
            <span className="mode-badge">Cached transcripts</span>
          </div>
          <ul className={`search-hits ${loading ? "search-loading" : ""}`}>
            {hits.map((hit) => (
              <li key={`${hit.ref}:${hit.messageID ?? hit.createdAt}`}>
                <button
                  className="search-hit"
                  type="button"
                  data-message-id={hit.messageID ?? ""}
                  onClick={() => props.onOpen(hit.ref, hit.messageID)}
                >
                  <span className="search-hit-head">
                    <span className="search-hit-title">{hit.title}</span>
                    <span className="search-hit-time">
                      {relativeTime(hit.createdAt ?? hit.updatedAt)}
                    </span>
                  </span>
                  <span className="search-hit-meta">
                    {providerLabel(hit.providerID)}
                    {hit.project ? ` · ${hit.project}` : ""}
                    {hit.role ? ` · ${hit.role}` : ""}
                  </span>
                  {hit.snippet ? (
                    <span className="search-hit-snippet">
                      {highlightParts(hit.snippet, trimmed).map((part, index) =>
                        part.match ? (
                          <mark key={index}>{part.text}</mark>
                        ) : (
                          <span key={index}>{part.text}</span>
                        ),
                      )}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : sessions.length > 0 ? (
        <section className="panel search-results-panel" aria-busy={loading || checking}>
          <div className="panel-head">
            <div>
              <h2>Results</h2>
              <p role="status">{resultSummary}</p>
            </div>
            <span className="mode-badge">Session metadata</span>
          </div>
          {warnings.length > 0 ? (
            <p className="search-warning" role="status">
              Could not search{" "}
              {warnings
                .map((warning) => providerLabel(warning.providerID))
                .join(", ")}
              . Results may be incomplete.
            </p>
          ) : null}
          <div className={`session-list ${loading ? "search-loading" : ""}`}>
            {sessions.map((session) => (
              <SessionRow
                key={session.ref}
                session={session}
                provider={providerLabel(session.providerID)}
                time={relativeTime(session.updatedAt)}
                timeAt={session.updatedAt}
                ariaLabel={searchResultLabel(session)}
                attention={
                  session.attention
                    ? {
                        type: session.attention.type,
                        label: ATTENTION_LABELS[session.attention.type],
                      }
                    : undefined
                }
                metaPrefix={
                  session.parentRef ? (
                    <span className="session-subagent-tag">Subagent</span>
                  ) : undefined
                }
                metaSuffix={session.agent}
                onOpen={() => props.onOpen(session.ref)}
              />
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function ChatSidebar(props: {
  client: HubClient;
  events: HubEvent[];
  providers: Provider[];
  activeRef: string;
  activeSession?: Session;
  onOpen: (ref: string) => void;
  onViewAll: () => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState<SessionStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = async () => {
    setError(undefined);
    try {
      const page = await props.client.sessions({ limit: 100 });
      setSessions(page.data);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load sessions",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [props.client]);

  const liveSeq =
    props.events.find(
      (event) => event.type.startsWith("session.") || event.type === "resync",
    )?.seq ?? 0;
  useEffect(() => {
    if (!liveSeq) return;
    const timer = setTimeout(() => void load(), 600);
    return () => clearTimeout(timer);
  }, [liveSeq]);

  const all = [...sessions];
  if (
    props.activeSession &&
    !all.some((session) => session.ref === props.activeSession!.ref)
  ) {
    all.push(props.activeSession);
  }
  all.sort((left, right) => right.updatedAt - left.updatedAt);

  const tree = buildSessionTree(all);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const parentRef = props.activeSession?.parentRef;
    if (!parentRef) return;
    setExpanded((current) =>
      current.has(parentRef) ? current : new Set(current).add(parentRef),
    );
  }, [props.activeSession?.parentRef]);

  const needle = query.trim().toLowerCase();
  const matches = (session: Session) => {
    if (provider !== "all" && session.providerID !== provider) return false;
    if (status !== "all" && session.status !== status) return false;
    if (!needle) return true;
    return searchResultLabel(session).toLowerCase().includes(needle);
  };
  const filteredNodes = filterSessionTree(tree.nodes, matches);
  const filteredOrphans = tree.orphans.filter(matches);
  const filteredCount =
    countTreeSessions(filteredNodes) + filteredOrphans.length;

  const groups: Array<{
    label: string;
    nodes: typeof filteredNodes;
    orphans: Session[];
  }> = [];
  for (const node of filteredNodes) {
    const label = sidebarGroupLabel(node.latestAt);
    const group = groups.find((candidate) => candidate.label === label);
    if (group) group.nodes.push(node);
    else groups.push({ label, nodes: [node], orphans: [] });
  }
  for (const orphan of filteredOrphans) {
    const label = sidebarGroupLabel(orphan.updatedAt);
    const group = groups.find((candidate) => candidate.label === label);
    if (group) group.orphans.push(orphan);
    else groups.push({ label, nodes: [], orphans: [orphan] });
  }

  const toggle = (ref: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };

  const labels: SessionTreeLabels = {
    provider: providerLabel,
    time: relativeTime,
    aria: searchResultLabel,
    attention: (session) =>
      session.attention
        ? {
            type: session.attention.type,
            label: ATTENTION_LABELS[session.attention.type],
          }
        : undefined,
  };

  return (
    <aside className="chat-sidebar" aria-label="Session list">
      <div className="chat-sidebar-head">
        <span className="chat-sidebar-label">Sessions</span>
        <span className="chat-sidebar-count">{filteredCount}</span>
      </div>

      <div className="chat-sidebar-filters">
        <input
          className="chat-sidebar-search"
          type="search"
          value={query}
          placeholder="Search sessions…"
          aria-label="Search sessions"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <div className="chat-sidebar-selects">
          <select
            className="chat-sidebar-select"
            value={provider}
            aria-label="Filter by provider"
            onChange={(event) => setProvider(event.currentTarget.value)}
          >
            <option value="all">All providers</option>
            {props.providers.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <select
            className="chat-sidebar-select"
            value={status}
            aria-label="Filter by status"
            onChange={(event) =>
              setStatus(event.currentTarget.value as SessionStatus | "all")
            }
          >
            <option value="all">Any status</option>
            <option value="running">Running</option>
            <option value="idle">Idle</option>
            <option value="error">Error</option>
            <option value="offline">Offline</option>
          </select>
        </div>
      </div>

      <div className="chat-sidebar-list">
        {error ? (
          <div className="chat-sidebar-error">
            {error}
            <button className="text-button" type="button" onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : null}
        {loading && sessions.length === 0 ? (
          <div className="chat-sidebar-empty">Loading sessions…</div>
        ) : filteredCount === 0 ? (
          <div className="chat-sidebar-empty">No sessions match.</div>
        ) : (
          groups.map((group) => (
            <section className="chat-sidebar-group" key={group.label}>
              <div className="chat-sidebar-group-label">{group.label}</div>
              <div className="session-list">
                {group.nodes.length > 0 ? (
                  <SessionTree
                    nodes={group.nodes}
                    expanded={expanded}
                    onToggle={toggle}
                    onOpen={props.onOpen}
                    labels={labels}
                    activeRef={props.activeRef}
                  />
                ) : null}
                {group.orphans.map((session) => (
                  <SessionRow
                    key={session.ref}
                    session={session}
                    provider={providerLabel(session.providerID)}
                    time={relativeTime(session.updatedAt)}
                    timeAt={session.updatedAt}
                    ariaLabel={searchResultLabel(session)}
                    active={session.ref === props.activeRef}
                    attention={
                      session.attention
                        ? {
                            type: session.attention.type,
                            label: ATTENTION_LABELS[session.attention.type],
                          }
                        : undefined
                    }
                    metaPrefix={
                      <span className="session-subagent-tag">Subagent</span>
                    }
                    onOpen={() => props.onOpen(session.ref)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </div>

      <div className="chat-sidebar-footer">
        <button className="text-button" type="button" onClick={props.onViewAll}>
          All sessions
        </button>
      </div>
    </aside>
  );
}

function sidebarGroupLabel(at: number): string {
  const now = new Date();
  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((start(now) - start(new Date(at))) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return "Earlier";
}

function searchResultLabel(
  session: Session,
  parentTitle?: string,
): string {
  const cues = [
    session.unread ? "unread" : undefined,
    session.attention
      ? `${ATTENTION_LABELS[session.attention.type]} needs attention`
      : undefined,
  ].filter(Boolean);
  return [
    session.title,
    session.parentRef ? "subagent" : undefined,
    parentTitle ? `of ${parentTitle}` : undefined,
    providerLabel(session.providerID),
    session.project ?? session.directory,
    session.status,
    ...cues,
  ]
    .filter(Boolean)
    .join(", ");
}

function SessionsView(props: {
  client: HubClient;
  events: HubEvent[];
  providers: Provider[];
  showNew: boolean;
  onShowNew: () => void;
  onCloseNew: () => void;
  onCreated: (ref: string) => void;
  onOpen: (ref: string) => void;
}) {
  const key = useRouteDataKey();
  const [cached] = useState<
    { sessions: Session[]; cursor: string | null; savedAt?: number } | undefined
  >(() => {
    const routeEntry = readRouteCacheEntry<{
      sessions: Session[];
      cursor: string | null;
    }>(key, "sessions-list");
    if (routeEntry) {
      return { ...routeEntry.value, savedAt: routeEntry.savedAt };
    }
    return readSessionsCache();
  });
  const [sessions, setSessions] = useState<Session[]>(
    () => cached?.sessions ?? [],
  );
  const [cursor, setCursor] = useState<string | null>(
    () => cached?.cursor ?? null,
  );
  const [syncedAt, setSyncedAt] = useState<number | undefined>(
    cached?.savedAt,
  );
  const [loading, setLoading] = useState(!cached);
  const [checking, setChecking] = useState(Boolean(cached));
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();
  const [scope, setScope] = useState<"all" | "root" | "subagent">("all");
  useRevalidationIndicator(checking);
  const tree = useMemo(() => buildSessionTree(sessions), [sessions]);
  const subagentSessions = useMemo(
    () =>
      sessions
        .filter((session) => Boolean(session.parentRef))
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [sessions],
  );
  const parentTitles = useMemo(
    () =>
      new Map(
        sessions
          .filter((session) => !session.parentRef)
          .map((session) => [session.ref, session.title] as const),
      ),
    [sessions],
  );
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (ref: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  };
  const labels: SessionTreeLabels = {
    provider: providerLabel,
    time: relativeTime,
    aria: searchResultLabel,
    attention: (session) =>
      session.attention
        ? {
            type: session.attention.type,
            label: ATTENTION_LABELS[session.attention.type],
          }
        : undefined,
  };
  const sessionRow = (session: Session) => (
    <SessionRow
      key={session.ref}
      session={session}
      provider={providerLabel(session.providerID)}
      time={relativeTime(session.updatedAt)}
      timeAt={session.updatedAt}
      ariaLabel={searchResultLabel(session, session.parentRef ? parentTitles.get(session.parentRef) : undefined)}
      attention={
        session.attention
          ? {
              type: session.attention.type,
              label: ATTENTION_LABELS[session.attention.type],
            }
          : undefined
      }
      metaPrefix={
        session.parentRef ? (
          <span className="session-subagent-tag">Subagent</span>
        ) : undefined
      }
      onOpen={() => props.onOpen(session.ref)}
    />
  );

  const load = async (
    next?: string,
    mode: "initial" | "revalidate" | "silent" = "initial",
  ) => {
    if (next) setLoadingMore(true);
    else if (mode === "initial") setLoading(true);
    else if (mode === "revalidate") setChecking(true);
    if (mode !== "silent") setError(undefined);
    try {
      const page = await props.client.sessions({ limit: 50, cursor: next });
      setSessions((current) => {
        if (!next) return page.data;
        const seen = new Set(current.map((session) => session.ref));
        return [...current, ...page.data.filter((session) => !seen.has(session.ref))];
      });
      setCursor(page.cursor.next);
      setError(undefined);
      if (!next) {
        writeSessionsCache({ sessions: page.data, cursor: page.cursor.next });
        setSyncedAt(Date.now());
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load sessions");
    } finally {
      if (!next) setLoading(false);
      setLoadingMore(false);
      if (mode === "revalidate") setChecking(false);
    }
  };

  useEffect(() => {
    void load(undefined, cached ? "revalidate" : "initial");
  }, [props.client, key]);

  const liveSeq =
    props.events.find(
      (event) =>
        event.type.startsWith("session.") || event.type === "resync",
    )?.seq ?? 0;
  const seenLiveSeq = useRef(liveSeq);
  useEffect(() => {
    if (liveSeq <= seenLiveSeq.current) return;
    seenLiveSeq.current = liveSeq;
    const timer = setTimeout(() => void load(undefined, "silent"), 500);
    return () => clearTimeout(timer);
  }, [liveSeq]);

  useEffect(() => {
    if (loading || loadingMore || checking || error) return;
    writeRouteCache(key, "sessions-list", { sessions, cursor });
  }, [checking, cursor, error, key, loading, loadingMore, sessions]);

  return (
    <>
      <div className="page-toolbar">
        <p className="page-lead">
          Sessions from every connected provider. Open one to read the transcript
          or reply; the separate inbox handles unread work and failures.
        </p>
        <div className="page-toolbar-actions">
          <button
            className="btn small"
            type="button"
            disabled={loading || checking}
            onClick={() =>
              void load(
                undefined,
                cached || sessions.length > 0 ? "revalidate" : "initial",
              )
            }
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            className="btn primary small"
            type="button"
            disabled={props.providers.every((provider) => !provider.capabilities.create)}
            onClick={props.onShowNew}
          >
            New session
          </button>
        </div>
      </div>

      {props.showNew ? (
        <NewSessionForm
          client={props.client}
          providers={props.providers}
          onClose={props.onCloseNew}
          onCreated={props.onCreated}
        />
      ) : null}

      {error ? (
        sessions.length > 0 ? (
          <p className="page-offline-note" role="status">
            Offline · showing the last synced list
            {syncedAt ? ` from ${new Date(syncedAt).toLocaleString()}` : ""}.
            <button className="text-button" type="button" onClick={() => void load()}>
              Retry
            </button>
          </p>
        ) : (
          <div className="alert" role="alert">
            {error}
            <button className="text-button" type="button" onClick={() => void load()}>
              Retry
            </button>
          </div>
        )
      ) : null}

      <section className="panel sessions-panel">
        <div className="panel-head">
          <div>
            <h2>All sessions</h2>
            <p>
              {scope === "all"
                ? `${sessions.length} sessions · ${tree.childCount} subagents`
                : scope === "root"
                  ? `${tree.nodes.length} root sessions`
                  : `${subagentSessions.length} subagents`}{" "}
              · newest first
            </p>
          </div>
          <div className="session-scope" role="group" aria-label="Session scope">
            {(["all", "root", "subagent"] as const).map((value) => (
              <button
                key={value}
                className={`chip ${scope === value ? "active" : ""}`}
                type="button"
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
              >
                {value === "all" ? "All" : value === "root" ? "Root" : "Subagents"}
              </button>
            ))}
          </div>
        </div>
        {loading && sessions.length === 0 ? (
          <div className="empty">Loading sessions…</div>
        ) : checking && sessions.length === 0 ? (
          <div className="empty">Checking for sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="empty">No sessions returned by the provider.</div>
        ) : scope === "all" ? (
          <div className="session-list">
            <SessionTree
              nodes={tree.nodes}
              expanded={expanded}
              onToggle={toggle}
              onOpen={props.onOpen}
              labels={labels}
            />
            {tree.orphans.length > 0 ? (
              <div className="session-tree-orphans">
                <div className="session-tree-section-label">
                  Subagents without a loaded parent
                </div>
                {tree.orphans.map(sessionRow)}
              </div>
            ) : null}
          </div>
        ) : scope === "root" ? (
          <div className="session-list">
            {tree.nodes.length === 0 ? (
              <div className="empty">No root sessions in the loaded page.</div>
            ) : (
              tree.nodes.map((node) => (
                <SessionRow
                  key={node.session.ref}
                  session={node.session}
                  provider={providerLabel(node.session.providerID)}
                  time={relativeTime(node.latestAt)}
                  timeAt={node.latestAt}
                  ariaLabel={searchResultLabel(node.session)}
                  attention={
                    node.session.attention
                      ? {
                          type: node.session.attention.type,
                          label: ATTENTION_LABELS[node.session.attention.type],
                        }
                      : undefined
                  }
                  metaPrefix={
                    node.children.length > 0 ? (
                      <span className="session-child-count">
                        {node.children.length} subagent
                        {node.children.length === 1 ? "" : "s"}
                      </span>
                    ) : undefined
                  }
                  onOpen={() => props.onOpen(node.session.ref)}
                />
              ))
            )}
          </div>
        ) : (
          <div className="session-list">
            {subagentSessions.length === 0 ? (
              <div className="empty">No subagents in the loaded page.</div>
            ) : (
              subagentSessions.map(sessionRow)
            )}
          </div>
        )}
        {cursor ? (
          <button
            className="btn small load-more"
            type="button"
            disabled={loadingMore}
            onClick={() => void load(cursor)}
          >
            {loadingMore ? "Loading…" : "Load more"}
          </button>
        ) : null}
      </section>
    </>
  );
}

function ProviderForm(props: {
  client: HubClient;
  provider?: Provider;
  onClose: () => void;
  onSaved: (provider: Provider) => void;
}) {
  const editing = props.provider;
  const initialType = editing?.type === "openwebui" ? "openwebui" : "opencode";
  const initialAuth: ProviderAuthKind =
    editing?.authKind ??
    (initialType === "openwebui" ? "bearer" : "basic");
  const [id, setId] = useState(editing?.id ?? "");
  const [type, setType] = useState<"opencode" | "openwebui">(initialType);
  const [name, setName] = useState(editing?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(editing?.baseUrl ?? "");
  const [authKind, setAuthKind] = useState<ProviderAuthKind>(initialAuth);
  const [username, setUsername] = useState(
    editing?.authUsername ?? "opencode",
  );
  const [secret, setSecret] = useState("");
  const [enabled, setEnabled] = useState(editing?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const formRef = useRef<HTMLFormElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useInlinePanelFocus(formRef, headingRef);

  const authChanged = Boolean(editing) && editing?.authKind !== authKind;
  const secretRequired =
    authKind !== "none" && (!editing || authChanged);

  const chooseType = (next: "opencode" | "openwebui") => {
    setType(next);
    setAuthKind(next === "openwebui" ? "bearer" : "basic");
    if (next === "opencode" && !username.trim()) setUsername("opencode");
  };

  const submit = async () => {
    if (submitting) return;
    const providerID = id.trim();
    if (!/^[a-zA-Z0-9._-]+$/.test(providerID)) {
      setError("Use letters, numbers, dot, underscore, or dash for the ID.");
      return;
    }
    try {
      new URL(baseUrl.trim());
    } catch {
      setError("Enter a valid base URL including the scheme.");
      return;
    }
    if (secretRequired && !secret.trim()) {
      setError(
        authKind === "basic"
          ? "Enter the password for this provider."
          : "Enter the token for this provider.",
      );
      return;
    }

    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    setSubmitting(true);
    setError(undefined);
    try {
      if (!editing) {
        const auth: ProviderInput["auth"] =
          authKind === "none"
            ? { kind: "none" }
            : authKind === "basic"
              ? {
                  kind: "basic",
                  username: username.trim() || "opencode",
                  password: secret,
                }
              : { kind: "bearer", token: secret };
        const saved = await props.client.addProvider({
          id: providerID,
          type,
          ...(name.trim() ? { name: name.trim() } : {}),
          baseUrl: normalizedBaseUrl,
          auth,
          enabled,
        });
        props.onSaved(saved);
        return;
      }

      const auth: ProviderUpdateInput["auth"] =
        authKind === "none"
          ? { kind: "none" }
          : authKind === "basic"
            ? {
                kind: "basic",
                username: username.trim() || "opencode",
                ...(secret ? { password: secret } : {}),
              }
            : {
                kind: "bearer",
                ...(secret ? { token: secret } : {}),
              };
      const saved = await props.client.updateProvider(editing.id, {
        type,
        ...(name.trim() ? { name: name.trim() } : {}),
        baseUrl: normalizedBaseUrl,
        auth,
        enabled,
      });
      props.onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save the provider");
    } finally {
      setSubmitting(false);
    }
  };

  const authChoices: Array<[ProviderAuthKind, string]> =
    type === "openwebui"
      ? [
          ["bearer", "Bearer token"],
          ["none", "No authentication"],
        ]
      : [
          ["basic", "Basic auth"],
          ["none", "No authentication"],
        ];

  return (
    <form
      className="provider-form"
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="panel-head">
        <div>
          <h3 ref={headingRef} tabIndex={-1}>
            {editing ? "Edit provider" : "Add provider"}
          </h3>
          <p>
            Stored in the hub config file. Credentials are write-only and never
            returned by the API.
          </p>
        </div>
        <button
          className="icon-btn"
          type="button"
          onClick={props.onClose}
          aria-label="Close provider form"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span>Provider ID</span>
          <input
            value={id}
            disabled={Boolean(editing)}
            aria-required="true"
            placeholder="desktop-opencode"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setId((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label className="form-field">
          <span>Type</span>
          <select
            value={type}
            onChange={(event) =>
              chooseType((event.currentTarget as HTMLSelectElement).value as "opencode" | "openwebui")
            }
          >
            <option value="opencode">OpenCode</option>
            <option value="openwebui">Open WebUI</option>
          </select>
        </label>
        <label className="form-field">
          <span>Name</span>
          <input
            value={name}
            placeholder="Desktop OpenCode"
            onChange={(event) => setName((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label className="form-field">
          <span>Base URL</span>
          <input
            value={baseUrl}
            aria-required="true"
            placeholder="http://127.0.0.1:4096"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setBaseUrl((event.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <label className="form-field">
          <span>Authentication</span>
          <select
            value={authKind}
            onChange={(event) =>
              setAuthKind((event.currentTarget as HTMLSelectElement).value as ProviderAuthKind)
            }
          >
            {authChoices.map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        {authKind === "basic" ? (
          <label className="form-field">
            <span>Username</span>
            <input
              value={username}
              autoComplete="off"
              onChange={(event) => setUsername((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
        ) : null}
        {authKind !== "none" ? (
          <label className="form-field span-2">
            <span>{authKind === "basic" ? "Password" : "API token"}</span>
            <input
              type="password"
              value={secret}
              aria-required={secretRequired}
              autoComplete="new-password"
              placeholder={
                editing && !authChanged
                  ? "Leave blank to keep the current credential"
                  : "Required"
              }
              onChange={(event) => setSecret((event.currentTarget as HTMLInputElement).value)}
            />
          </label>
        ) : null}
        {authKind !== "none" ? (
          <p className="form-note">
            {type === "opencode" ? (
              <>
                Run <code>opencode service get password</code> on the machine that
                runs OpenCode. The username is <code>opencode</code>.
              </>
            ) : (
              <>
                Create the key in Open WebUI under{" "}
                <strong>Settings → Account → API keys</strong>.
              </>
            )}
          </p>
        ) : null}
        <label className="check-field span-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled((event.currentTarget as HTMLInputElement).checked)}
          />
          Enabled
        </label>
      </div>

      {error ? <div className="form-error" role="alert">{error}</div> : null}

      <div className="form-actions">
        <button className="btn small" type="button" onClick={props.onClose}>
          Cancel
        </button>
        <button className="btn primary small" type="submit" disabled={submitting}>
          {submitting
            ? "Saving…"
            : editing
              ? "Save provider"
              : "Add provider"}
        </button>
      </div>
    </form>
  );
}

function NewSessionForm(props: {
  client: HubClient;
  providers: Provider[];
  onClose: () => void;
  onCreated: (ref: string) => void;
}) {
  const creatable = props.providers.filter(
    (provider) => provider.enabled && provider.capabilities.create,
  );
  const [providerID, setProviderID] = useState(creatable[0]?.id ?? "");
  const [options, setOptions] = useState<ProviderOptions>();
  const [title, setTitle] = useState("");
  const [directory, setDirectory] = useState("");
  const [agent, setAgent] = useState("");
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const [createdRef, setCreatedRef] = useState<string>();
  const panelRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  useInlinePanelFocus(panelRef, headingRef);

  useEffect(() => {
    const available = props.providers.filter(
      (provider) => provider.enabled && provider.capabilities.create,
    );
    if (providerID && available.some((provider) => provider.id === providerID)) {
      return;
    }
    setProviderID(available[0]?.id ?? "");
  }, [props.providers, providerID]);

  useEffect(() => {
    if (!providerID) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    setOptions(undefined);
    props.client
      .options(providerID)
      .then((next) => {
        if (cancelled) return;
        setOptions(next);
        setDirectory(next.defaults?.directory ?? next.directories[0] ?? "");
        setAgent(next.defaults?.agent ?? next.agents[0]?.id ?? "");
        setModel(next.defaults?.model ?? next.models[0]?.id ?? "");
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load provider options");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, providerID]);

  const sendFirstPrompt = async (ref: string) => {
    setSubmitting(true);
    setError(undefined);
    try {
      await props.client.sendMessage(ref, { text: prompt.trim() });
    } catch (reason) {
      // Keep the panel open: the session exists, so the failure must stay
      // visible and retryable instead of navigating into an empty chat.
      setCreatedRef(ref);
      setSubmitting(false);
      setError(
        reason instanceof Error
          ? `Session created, but the first prompt failed: ${reason.message}`
          : "Session created, but the first prompt failed",
      );
      return;
    }
    setSubmitting(false);
    props.onCreated(ref);
  };

  const submit = async () => {
    if (submitting) return;
    if (createdRef) {
      if (!prompt.trim()) return;
      await sendFirstPrompt(createdRef);
      return;
    }
    if (!providerID || !title.trim()) return;
    setSubmitting(true);
    setError(undefined);
    let session;
    try {
      session = await props.client.createSession({
        providerID,
        title: title.trim(),
        ...(directory ? { directory } : {}),
        ...(agent ? { agent } : {}),
        ...(model ? { model } : {}),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create the session");
      setSubmitting(false);
      return;
    }

    if (prompt.trim()) {
      await sendFirstPrompt(session.ref);
      return;
    }
    setSubmitting(false);
    props.onCreated(session.ref);
  };

  return (
    <section className="panel new-session-panel" ref={panelRef}>
      <div className="panel-head">
        <div>
          <h2 ref={headingRef} tabIndex={-1}>
            New session
          </h2>
          <p>Create an OpenCode session and optionally send the first prompt.</p>
        </div>
        <button
          className="icon-btn"
          type="button"
          onClick={props.onClose}
          aria-label="Close new session"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      {creatable.length === 0 ? (
        <div className="empty">No configured provider supports session creation.</div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="form-grid">
            <label className="form-field">
              <span>Provider</span>
              <select value={providerID} onChange={(event) => setProviderID((event.currentTarget as HTMLSelectElement).value)}>
                {creatable.map((provider) => (
                  <option value={provider.id} key={provider.id}>{provider.name}</option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Title</span>
              <input
                value={title}
                aria-required="true"
                placeholder="Investigate auth race"
                onChange={(event) => setTitle((event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label className="form-field span-2">
              <span>Project directory</span>
              <input
                value={directory}
                list="new-session-directories"
                placeholder="/home/me/oktoso"
                onChange={(event) => setDirectory((event.currentTarget as HTMLInputElement).value)}
              />
              <datalist id="new-session-directories">
                {(options?.directories ?? []).map((item) => <option value={item} key={item} />)}
              </datalist>
            </label>
            <label className="form-field">
              <span>Agent</span>
              <select value={agent} disabled={loading} onChange={(event) => setAgent((event.currentTarget as HTMLSelectElement).value)}>
                {(options?.agents ?? []).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label className="form-field">
              <span>Model</span>
              <select value={model} disabled={loading} onChange={(event) => setModel((event.currentTarget as HTMLSelectElement).value)}>
                <ModelSelectOptions models={options?.models ?? []} />
              </select>
            </label>
            <label className="form-field span-2">
              <span>First prompt</span>
              <textarea
                rows={3}
                value={prompt}
                placeholder="Start by reading the auth middleware."
                onChange={(event) => setPrompt((event.currentTarget as HTMLTextAreaElement).value)}
              />
            </label>
          </div>

          {loading ? <div className="form-note">Loading provider options…</div> : null}
          {error ? <div className="form-error" role="alert">{error}</div> : null}

          <div className="form-actions">
            {createdRef ? (
              <>
                <button
                  className="btn small"
                  type="button"
                  onClick={() => props.onCreated(createdRef)}
                >
                  Open session
                </button>
                <button
                  className="btn primary small"
                  type="submit"
                  disabled={submitting || !prompt.trim()}
                >
                  {submitting ? "Sending…" : "Retry prompt"}
                </button>
              </>
            ) : (
              <>
                <button className="btn small" type="button" onClick={props.onClose}>
                  Cancel
                </button>
                <button
                  className="btn primary small"
                  type="submit"
                  disabled={loading || submitting || !title.trim() || !providerID}
                >
                  {submitting ? "Creating…" : "Create session"}
                </button>
              </>
            )}
          </div>
        </form>
      )}
    </section>
  );
}

type PendingScroll =
  | { mode: "bottom" }
  | { mode: "preserve"; height: number; top: number };

const MESSAGE_PAGE_SIZE = 200;
const MAX_MESSAGE_LOOKUP_PAGES = 20;
const MAX_DICTATION_MS = 120_000;

type DraftStatus = "idle" | "saving" | "saved" | "error";

type DictationState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "recording"; startedAt: number }
  | { phase: "transcribing" }
  | { phase: "error"; message: string };

function useSessionDraft(client: HubClient, sessionRef: string) {
  const [text, setTextState] = useState("");
  const [status, setStatus] = useState<DraftStatus>("idle");
  const textRef = useRef("");
  const revisionRef = useRef(0);
  const lastSavedRef = useRef<string | null>(null);
  const activeRef = useRef(sessionRef);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  activeRef.current = sessionRef;

  const setText = useCallback((value: string) => {
    textRef.current = value;
    setTextState(value);
  }, []);

  const enqueue = useCallback(
    (ref: string, value: string): Promise<void> => {
      const request = queueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (value === "") {
            await client.deleteDraft(ref);
          } else {
            await client.saveDraft(ref, value);
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
    (ref: string, value: string) => {
      if (value === lastSavedRef.current) return;
      setStatus("saving");
      void enqueue(ref, value)
        .then(() => {
          if (activeRef.current !== ref || textRef.current !== value) return;
          lastSavedRef.current = value === "" ? null : value;
          showSaved();
        })
        .catch(() => {
          if (activeRef.current === ref) setStatus("error");
        });
    },
    [enqueue, showSaved],
  );

  const scheduleSave = useCallback(
    (value: string) => {
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
      const ref = activeRef.current;
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        persist(ref, value);
      }, 600);
    },
    [persist],
  );

  const update = useCallback(
    (value: string) => {
      revisionRef.current += 1;
      setText(value);
      scheduleSave(value);
    },
    [scheduleSave, setText],
  );

  useEffect(() => {
    activeRef.current = sessionRef;
    revisionRef.current = 0;
    lastSavedRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = undefined;
    }
    setText("");
    setStatus("idle");
    let cancelled = false;

    void client
      .draft(sessionRef)
      .then((saved) => {
        if (cancelled || revisionRef.current > 0) return;
        const value = saved?.text ?? "";
        setText(value);
        lastSavedRef.current = saved ? saved.text : null;
        if (saved) showSaved();
      })
      .catch(() => {
        if (cancelled || revisionRef.current > 0) return;
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
      const value = textRef.current;
      if (value !== lastSavedRef.current) {
        void enqueue(sessionRef, value).catch(() => undefined);
      }
    };
  }, [client, sessionRef, enqueue, setText, showSaved]);

  const discard = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = undefined;
    }
    revisionRef.current += 1;
    lastSavedRef.current = null;
    setText("");
    setStatus("idle");
    await queueRef.current.catch(() => undefined);
    setStatus("saving");
    try {
      await client.deleteDraft(sessionRef);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }, [client, sessionRef, setText]);

  return { text, status, update, discard };
}

function draftStatusLabel(status: DraftStatus): string {
  if (status === "saving") return "Saving draft…";
  if (status === "saved") return "Draft saved";
  if (status === "error") return "Draft not saved";
  return "Ctrl/⌘ Enter";
}

function promptFailure(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unable to send the prompt";
}

function HandoffCard(props: {
  handoff: Handoff;
  draft: string;
  busy: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const { handoff } = props;
  const [expanded, setExpanded] = useState(false);
  const failed = handoff.status === "failed";
  const sent = handoff.status === "sent";
  const sending = handoff.status === "sending";
  const longMessage = sent && handoff.message.length > 800;
  return (
    <section
      className="handoff-card"
      data-status={handoff.status}
      aria-label={
        sent
          ? `Handoff to ${handoff.targetTitle}, sent`
          : `Handoff to ${handoff.targetTitle}`
      }
    >
      <div className="attention-top">
        <span className="type-badge handoff">Handoff</span>
        <span className="attention-provider">From this session</span>
        <span className={`handoff-status ${handoff.status}`}>
          {sent ? "Sent" : failed ? "Failed" : sending ? "Sending" : "Pending"}
        </span>
      </div>
      <div className="handoff-target-title">To {handoff.targetTitle}</div>
      <p className="handoff-meta">
        {handoff.targetProject ?? handoff.targetProviderID} · {handoff.targetRef}
      </p>
      {sent ? (
        <>
          <p
            className={`handoff-message-read${longMessage && !expanded ? " clamped" : ""}`}
          >
            {handoff.message}
          </p>
          {longMessage ? (
            <button
              className="text-button handoff-message-toggle"
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Show less" : "Show full message"}
            </button>
          ) : null}
        </>
      ) : (
        <textarea
          className="handoff-message"
          value={props.draft}
          rows={3}
          aria-label={`Handoff message to ${handoff.targetTitle}`}
          disabled={sending}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
      )}
      {handoff.reason ? (
        <p className="handoff-reason">Why: {handoff.reason}</p>
      ) : null}
      {handoff.evidence ? (
        <p className="handoff-evidence">Evidence: {handoff.evidence}</p>
      ) : null}
      {failed && handoff.error ? (
        <p className="handoff-error" role="alert">
          {handoff.error}
        </p>
      ) : null}
      {sent ? (
        <>
          <p className="handoff-sent-time">
            Sent {formatDateTime(handoff.sentAt ?? handoff.updatedAt)}
          </p>
          {handoff.receiptQueuedAt ? (
            <p className="handoff-receipt-note">
              Session receipt queued for its next turn.
            </p>
          ) : null}
        </>
      ) : (
        <div className="handoff-actions">
          <button
            className="btn primary small"
            type="button"
            disabled={
              props.busy || sending || props.draft.trim().length === 0
            }
            onClick={props.onSend}
          >
            {props.busy || sending
              ? "Sending…"
              : failed
                ? "Retry handoff"
                : "Send handoff"}
          </button>
          <button
            className="btn small"
            type="button"
            disabled={props.busy || sending}
            onClick={props.onCancel}
          >
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function SessionDetail(props: {
  client: HubClient;
  sessionRef: string;
  events: HubEvent[];
  providers: Provider[];
  detailsOpen: boolean;
  previewPath?: string;
  onPreviewClose?: () => void;
  onDetailsOpenChange: (open: boolean) => void;
  onSessionChange: (session: Session | undefined) => void;
  onOpenSession: (ref: string) => void;
  attentionID?: string;
  messageID?: string;
  onBack: () => void;
}) {
  const [session, setSession] = useState<Session | undefined>(() =>
    readSessionCache(props.sessionRef),
  );
  const [cachedTranscript] = useState(() =>
    readTranscriptCache(props.sessionRef),
  );
  const [messages, setMessages] = useState<Message[]>(() =>
    cachedTranscript
      ? [...cachedTranscript.messages, ...queuedMessages(props.sessionRef)]
      : [],
  );
  const [online, setOnline] = useState(() => isOnline());
  const [olderCursor, setOlderCursor] = useState<string | null>(() =>
    cachedTranscript?.olderCursor ?? null,
  );
  const [loading, setLoading] = useState(
    () => !cachedTranscript || !session,
  );
  const [checking, setChecking] = useState(Boolean(cachedTranscript));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [messageLookup, setMessageLookup] = useState<
    "idle" | "loading" | "missing"
  >("idle");
  const lookupMessageRef = useRef<string | undefined>(undefined);
  const scrolledMessageRef = useRef<string | undefined>(undefined);
  const [messageBarDismissed, setMessageBarDismissed] = useState(false);
  const [forkingMessageID, setForkingMessageID] = useState<string>();
  useRevalidationIndicator(checking);
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const restoreScroll = useRef(hasSavedScroll("transcript"));
  const [atBottom, setAtBottom] = useState(() => !restoreScroll.current);
  const atBottomRef = useRef(atBottom);
  const [showJump, setShowJump] = useState(false);
  const jumpTimer = useRef<number | undefined>(undefined);
  const focusBarRef = useRef<HTMLDivElement | null>(null);
  const [focusBarHeight, setFocusBarHeight] = useState(0);
  const [scrollable, setScrollable] = useState(false);
  const [inlineAttention, setInlineAttention] = useState<Attention[]>([]);
  const attentionSignature = useMemo(
    () =>
      inlineAttention
        .map(
          (item) =>
            `${item.id}:${(item.fields ?? [])
              .map(
                (field) =>
                  `${field.id}:${field.description ?? ""}:${field.options?.length ?? 0}`,
              )
              .join(",")}`,
        )
        .join("|"),
    [inlineAttention],
  );

  const [attentionBusyID, setAttentionBusyID] = useState<string>();
  const [attentionError, setAttentionError] = useState<string>();
  const focusedAttention = useRef<string | undefined>(undefined);
  const [selectionOptions, setSelectionOptions] = useState<ProviderOptions>();
  const [selectionSaving, setSelectionSaving] = useState(false);
  const [selectionError, setSelectionError] = useState<string>();
  const [agentValue, setAgentValue] = useState("");
  const [modelValue, setModelValue] = useState("");
  const [variantValue, setVariantValue] = useState("");
  const { text: draft, status: draftStatus, update: updateDraft, discard: discardDraft } =
    useSessionDraft(props.client, props.sessionRef);
  const [error, setError] = useState<string>();
  const [retryingTranscript, setRetryingTranscript] = useState(false);
  const autoRetried = useRef(false);
  const [sendError, setSendError] = useState<string>();
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [handoffDrafts, setHandoffDrafts] = useState<Record<string, string>>({});
  const [handoffBusy, setHandoffBusy] = useState<string>();
  const [handoffNotice, setHandoffNotice] = useState("");
  const [handoffAbortNotice, setHandoffAbortNotice] = useState("");
  const [handoffError, setHandoffError] = useState<string>();
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [queuedOpen, setQueuedOpen] = useState(false);
  const [inboxBusy, setInboxBusy] = useState<string>();
  const [inboxError, setInboxError] = useState<string>();
  const phase = transcriptPhase({
    loading,
    error,
    messageCount: messages.length,
    running: session?.status === "running",
  });
  const [previewPath, setPreviewPath] = useState<string | undefined>(
    props.previewPath,
  );
  useEffect(() => {
    setPreviewPath(props.previewPath);
  }, [props.previewPath]);
  const [stepPanelOpen, setStepPanelOpen] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [branches, setBranches] = useState<BranchPoint[]>([]);
  const [previewRoots, setPreviewRoots] = useState<string[]>([]);
  const [history, setHistory] = useState<SessionHistory | undefined>();
  const [historyBusy, setHistoryBusy] = useState<"undo" | "redo">();
  const [historyError, setHistoryError] = useState<string>();
  const [historyNotice, setHistoryNotice] = useState<string>();
  const [historyFilesOpen, setHistoryFilesOpen] = useState(false);
  const [historyPromptOpen, setHistoryPromptOpen] = useState(false);
  const [historyConfirmOpen, setHistoryConfirmOpen] = useState(false);
  const [historyRestoring, setHistoryRestoring] = useState(false);
  const historyRestoreRef = useRef<HTMLButtonElement | null>(null);

  const cancelHistoryConfirm = useCallback(() => {
    setHistoryConfirmOpen(false);
    requestAnimationFrame(() => historyRestoreRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!historyConfirmOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelHistoryConfirm();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [historyConfirmOpen, cancelHistoryConfirm]);
  const [branchBusy, setBranchBusy] = useState<string>();
  const [retryBusy, setRetryBusy] = useState<string>();
  const [continueBusy, setContinueBusy] = useState<string>();
  const [branchError, setBranchError] = useState<string>();
  const [editingMessageID, setEditingMessageID] = useState<string>();
  const [editText, setEditText] = useState("");
  const editDraft = useDraftSlot({
    client: props.client,
    key: editingMessageID
      ? `draft:edit:${props.sessionRef}:${editingMessageID}`
      : undefined,
    enabled: Boolean(editingMessageID),
    onLoad: (text) => {
      if (text) setEditText(text);
    },
  });
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string>();
  const [dictation, setDictation] = useState<DictationState>({ phase: "idle" });
  const [dictationElapsedMs, setDictationElapsedMs] = useState(0);
  const [dictationEnabled, setDictationEnabled] = useState(false);
  const [suggestEnabled, setSuggestEnabled] = useState(false);
  const [suggestions, setSuggestions] = useState<ReplyOption[]>([]);
  const [suggestState, setSuggestState] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [suggestError, setSuggestError] = useState<string>();
  const dictationStream = useRef<MediaStream | null>(null);
  const dictationRecorder = useRef<MediaRecorder | null>(null);
  const dictationChunks = useRef<Blob[]>([]);
  const dictationAbort = useRef<AbortController | null>(null);
  const dictationStopTimer = useRef<number | undefined>(undefined);
  const dictationMounted = useRef(true);
  const dictationStopRef = useRef<() => void>(() => undefined);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const transcriptRef = useRef<HTMLElement | null>(null);
  useScrollRestoration(transcriptRef, "transcript", !loading);
  const pendingScroll = useRef<PendingScroll | undefined>(undefined);
  const messagesRef = useRef<Message[]>([]);
  const processedSeq = useRef(props.events[0]?.seq ?? 0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  messagesRef.current = messages;
  const sessionProvider = session
    ? props.providers.find((provider) => provider.id === session.providerID)
    : undefined;

  const dictationSupported =
    dictationEnabled &&
    window.isSecureContext &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined";
  const dictationBusy =
    dictation.phase === "starting" ||
    dictation.phase === "recording" ||
    dictation.phase === "transcribing";
  const attachSupported = Boolean(sessionProvider?.capabilities.attach);
  const branchesSupported = Boolean(sessionProvider?.capabilities.branches);
  const historySupported = Boolean(
    sessionProvider?.capabilities.undo && sessionProvider?.capabilities.redo,
  );
  const restoreFilesSupported = Boolean(
    sessionProvider?.capabilities.restoreFiles,
  );
  const canEdit = Boolean(sessionProvider?.capabilities.fork);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const toolsRef = useRef<HTMLDivElement | null>(null);
  const toolsToggleRef = useRef<HTMLButtonElement | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const contextChipRef = useRef<HTMLButtonElement | null>(null);
  const contextSheetRef = useRef<HTMLElement | null>(null);
  const contextCloseRef = useRef<HTMLButtonElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [narrow, setNarrow] = useState(() =>
    window.matchMedia("(max-width: 360px)").matches,
  );
  const [compact, setCompact] = useState(() =>
    window.matchMedia("(max-width: 420px)").matches,
  );
  const prefetchedSuggestKey = useRef("");
  const suggestPrefetchTimer = useRef<number | undefined>(undefined);
  const [documentVisible, setDocumentVisible] = useState(
    () => document.visibilityState === "visible",
  );
  const canSteer = Boolean(sessionProvider?.capabilities.steer);
  const canQueue = Boolean(sessionProvider?.capabilities.queue);
  const running = session?.status === "running";
  const queuedItems = useMemo(
    () =>
      inbox.filter(
        (item) =>
          item.delivery === "queue" &&
          item.type === "user" &&
          item.text.trim().length > 0,
      ),
    [inbox],
  );

  const refreshInbox = useCallback(async () => {
    if (!canQueue) {
      setInbox([]);
      setInboxError(undefined);
      return;
    }
    try {
      const page = await props.client.inbox(props.sessionRef);
      setInbox(page.data);
      setInboxError(undefined);
    } catch (reason) {
      setInboxError(
        reason instanceof Error ? reason.message : "Unable to read the queue",
      );
    }
  }, [canQueue, props.client, props.sessionRef]);

  useEffect(() => {
    void refreshInbox();
  }, [refreshInbox]);

  useEffect(() => {
    if (!canQueue) return;
    if (!running && queuedItems.length === 0) return;
    const timer = window.setInterval(() => {
      void refreshInbox();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [canQueue, queuedItems.length, refreshInbox, running]);

  const loadHandoffs = useCallback(async () => {
    const list = await props.client.handoffs({
      sourceRef: props.sessionRef,
    });
    const open = list.filter(
      (handoff) =>
        handoff.status === "pending" ||
        handoff.status === "failed" ||
        handoff.status === "sending",
    );
    // Keep the newest sent receipts so the transcript retains a record
    // without accumulating every handoff this session ever made.
    const sent = list
      .filter((handoff) => handoff.status === "sent")
      .slice(0, 5);
    const visible = [...open, ...sent].sort(
      (left, right) => left.createdAt - right.createdAt,
    );
    setHandoffs(visible);
    setHandoffDrafts((current) => {
      const next: Record<string, string> = {};
      for (const handoff of visible) {
        if (handoff.status === "sent") continue;
        next[handoff.id] = current[handoff.id] ?? handoff.message;
      }
      return next;
    });
  }, [props.client, props.sessionRef]);

  useEffect(() => {
    void loadHandoffs().catch(() => undefined);
  }, [loadHandoffs]);

  const latestHandoffEvent = useMemo(() => {
    let latest: HubEvent | undefined;
    for (const event of props.events) {
      if (
        event.type !== "handoff.created" &&
        event.type !== "handoff.updated"
      ) {
        continue;
      }
      if (event.sessionRef !== props.sessionRef) continue;
      if (!latest || event.seq > latest.seq) latest = event;
    }
    return latest;
  }, [props.events, props.sessionRef]);
  const handoffLiveSeq = latestHandoffEvent?.seq ?? 0;
  useEffect(() => {
    if (!handoffLiveSeq) return;
    void loadHandoffs().catch(() => undefined);
    if (latestHandoffEvent?.type !== "handoff.updated") return;
    const handoff = (latestHandoffEvent.data as { handoff?: Handoff } | undefined)
      ?.handoff;
    if (handoff?.status !== "cancelled") return;
    setHandoffAbortNotice(
      handoff.cancelReason === "session-advanced"
        ? "Pending handoff cancelled because the session moved on."
        : "Handoff cancelled.",
    );
  }, [handoffLiveSeq, latestHandoffEvent, loadHandoffs]);

  useEffect(() => {
    if (!handoffNotice) return;
    const timer = window.setTimeout(() => setHandoffNotice(""), 4_000);
    return () => window.clearTimeout(timer);
  }, [handoffNotice]);

  useEffect(() => {
    if (!handoffAbortNotice) return;
    const timer = window.setTimeout(() => setHandoffAbortNotice(""), 6_000);
    return () => window.clearTimeout(timer);
  }, [handoffAbortNotice]);

  const sendHandoff = async (handoff: Handoff) => {
    const message = (handoffDrafts[handoff.id] ?? handoff.message).trim();
    if (!message) return;
    setHandoffBusy(handoff.id);
    setHandoffError(undefined);
    try {
      const next = await props.client.approveHandoff(handoff.id, message);
      if (next.status === "sent") {
        setHandoffs((current) =>
          current.map((entry) => (entry.id === next.id ? next : entry)),
        );
        setHandoffNotice(`Handoff sent to ${next.targetTitle}.`);
      } else {
        setHandoffs((current) =>
          current.map((entry) => (entry.id === next.id ? next : entry)),
        );
        setHandoffError(next.error ?? "The handoff could not be sent.");
      }
    } catch (reason) {
      setHandoffError(
        reason instanceof Error
          ? reason.message
          : "The handoff could not be sent.",
      );
    } finally {
      setHandoffBusy(undefined);
    }
  };

  const cancelHandoff = async (handoff: Handoff) => {
    setHandoffBusy(handoff.id);
    setHandoffError(undefined);
    try {
      await props.client.cancelHandoff(handoff.id);
      setHandoffs((current) =>
        current.filter((entry) => entry.id !== handoff.id),
      );
    } catch (reason) {
      setHandoffError(
        reason instanceof Error ? reason.message : "The handoff could not be cancelled.",
      );
    } finally {
      setHandoffBusy(undefined);
    }
  };

  const inboxLiveSeq =
    props.events.find(
      (event) =>
        (event.sessionRef === undefined ||
          event.sessionRef === props.sessionRef) &&
        (event.type === "session.updated" ||
          event.type === "message.created" ||
          event.type === "resync"),
    )?.seq ?? 0;
  useEffect(() => {
    if (!canQueue || !inboxLiveSeq) return;
    const timer = window.setTimeout(() => {
      void refreshInbox();
    }, 600);
    return () => window.clearTimeout(timer);
  }, [canQueue, inboxLiveSeq, refreshInbox]);

  useEffect(() => {
    if (queuedItems.length === 0) setQueuedOpen(false);
  }, [queuedItems.length]);

  useEffect(() => {
    if (!toolsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) {
        setToolsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setToolsOpen(false);
      toolsToggleRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [toolsOpen]);

  useEffect(() => {
    setToolsOpen(false);
    setContextOpen(false);
  }, [props.sessionRef]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 360px)");
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 420px)");
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useLayoutEffect(() => {
    const input = composerInputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
    // Growing the composer shrinks the transcript. Keep the reader pinned to
    // the bottom when that is where they were before typing; otherwise leave
    // their scroll position alone.
    const scroller = transcriptRef.current;
    if (scroller && atBottomRef.current && !stepPanelOpen) {
      scroller.scrollTop = scroller.scrollHeight;
    }
  }, [draft, stepPanelOpen]);

  useEffect(() => {
    if (!contextOpen) return;
    const previous = contextChipRef.current;
    contextCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setContextOpen(false);
        return;
      }
      trapTabKey(event, contextSheetRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    const mq = window.matchMedia("(min-width: 761px)");
    const onMediaChange = () => {
      if (mq.matches) setContextOpen(false);
    };
    mq.addEventListener("change", onMediaChange);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      mq.removeEventListener("change", onMediaChange);
      previous?.focus();
    };
  }, [contextOpen]);

  const suggestPrefetchKey = useCallback(() => {
    const last = messages.at(-1);
    return `${props.sessionRef}:${session?.updatedAt ?? 0}:${messages.length}:${last?.id ?? ""}`;
  }, [messages, props.sessionRef, session?.updatedAt]);

  useEffect(() => {
    const onChange = () =>
      setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  // Warm the hub cache for the session the reader is looking at. The result is
  // discarded; Suggest still renders its own loading state if the context
  // changed since the prefetch. Failures stay silent.
  useEffect(() => {
    if (!suggestEnabled || running || !documentVisible || messages.length === 0) {
      return;
    }
    const key = suggestPrefetchKey();
    if (prefetchedSuggestKey.current === key) return;
    suggestPrefetchTimer.current = window.setTimeout(() => {
      suggestPrefetchTimer.current = undefined;
      if (document.visibilityState !== "visible") return;
      prefetchedSuggestKey.current = key;
      void props.client
        .replyOptions(props.sessionRef, "reply")
        .catch(() => undefined);
    }, 1_000);
    return () => {
      if (suggestPrefetchTimer.current) {
        window.clearTimeout(suggestPrefetchTimer.current);
        suggestPrefetchTimer.current = undefined;
      }
    };
  }, [
    documentVisible,
    messages.length,
    props.client,
    props.sessionRef,
    running,
    suggestEnabled,
    suggestPrefetchKey,
  ]);

  const getScroller = () => transcriptRef.current;

  const isAtBottom = () => {
    const scroller = getScroller();
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  };

  const updateScrollState = useCallback(() => {
    const scroller = getScroller();
    if (!scroller) return;
    const max = scroller.scrollHeight - scroller.clientHeight;
    const overflows = max > 2;
    const atTop = scroller.scrollTop <= 2;
    const atEnd = scroller.scrollTop >= max - 2;
    scroller.classList.toggle("has-above", overflows && !atTop);
    scroller.classList.toggle("has-below", overflows && !atEnd);
    setScrollable(overflows);
    setShowJump(overflows && !atEnd);
    if (!stepPanelOpen) {
      const nextAtBottom =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
      atBottomRef.current = nextAtBottom;
      setAtBottom(nextAtBottom);
    }
  }, [stepPanelOpen]);

  const jumpToLatest = () => {
    const scroller = getScroller();
    if (!scroller) return;
    atBottomRef.current = true;
    setAtBottom(true);
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    // The transcript can grow while the smooth scroll runs (streaming text or
    // a newly loaded page). Re-pin once it settles so the pill and divider
    // cannot be left visible just short of the true bottom.
    if (jumpTimer.current) window.clearTimeout(jumpTimer.current);
    jumpTimer.current = window.setTimeout(() => {
      jumpTimer.current = undefined;
      if (!scroller.isConnected) return;
      scroller.scrollTop = scroller.scrollHeight;
      atBottomRef.current = true;
      setAtBottom(true);
      updateScrollState();
    }, 600);
  };

  useLayoutEffect(() => {
    const bar = focusBarRef.current;
    if (!bar) {
      setFocusBarHeight(0);
      return;
    }
    const update = () => setFocusBarHeight(bar.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [messageBarDismissed, props.messageID]);

  useEffect(
    () => () => {
      if (jumpTimer.current) window.clearTimeout(jumpTimer.current);
    },
    [],
  );

  const cleanupDictation = useCallback(() => {
    if (dictationStopTimer.current) {
      clearTimeout(dictationStopTimer.current);
      dictationStopTimer.current = undefined;
    }
    dictationAbort.current?.abort();
    dictationAbort.current = null;

    const recorder = dictationRecorder.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      try {
        recorder.stop();
      } catch {
        // The recorder may already be tearing down.
      }
    }
    dictationRecorder.current = null;
    stopMediaStream(dictationStream.current);
    dictationStream.current = null;
    dictationChunks.current = [];
  }, []);

  async function transcribeDictation() {
    const recorder = dictationRecorder.current;
    const mimeType =
      recorder?.mimeType || pickAudioMimeType() || "audio/webm";
    const chunks = dictationChunks.current;
    dictationChunks.current = [];
    dictationRecorder.current = null;

    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size === 0) {
      setDictation({
        phase: "error",
        message: "No audio was captured. Try again.",
      });
      return;
    }

    const controller = new AbortController();
    dictationAbort.current = controller;
    setDictation({ phase: "transcribing" });
    try {
      const result = await props.client.transcribe(blob, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const text = result.text.trim();
      if (!text) {
        setDictation({
          phase: "error",
          message: "No speech was detected. Try again.",
        });
        return;
      }
      updateDraft(appendTranscript(draftRef.current, text));
      setDictation({ phase: "idle" });
    } catch (reason) {
      if (controller.signal.aborted) return;
      setDictation({
        phase: "error",
        message:
          reason instanceof Error
            ? reason.message
            : "Unable to transcribe the recording.",
      });
    } finally {
      if (dictationAbort.current === controller) dictationAbort.current = null;
    }
  }

  async function startDictation() {
    if (!dictationSupported || dictationBusy) return;
    setDictation({ phase: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!dictationMounted.current) {
        stopMediaStream(stream);
        return;
      }
      const mimeType = pickAudioMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      dictationStream.current = stream;
      dictationRecorder.current = recorder;
      dictationChunks.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) dictationChunks.current.push(event.data);
      };
      recorder.onerror = () => {
        cleanupDictation();
        setDictation({
          phase: "error",
          message: "Recording failed. Check the microphone and try again.",
        });
      };
      recorder.onstop = () => {
        void transcribeDictation();
      };
      recorder.start(250);
      setDictation({ phase: "recording", startedAt: Date.now() });
    } catch (reason) {
      cleanupDictation();
      setDictation({ phase: "error", message: microphoneErrorMessage(reason) });
    }
  }

  function stopDictation() {
    const recorder = dictationRecorder.current;
    if (recorder && recorder.state !== "inactive") {
      setDictation({ phase: "transcribing" });
      recorder.stop();
    }
    stopMediaStream(dictationStream.current);
    dictationStream.current = null;
  }

  dictationStopRef.current = stopDictation;

  useEffect(() => {
    let cancelled = false;
    void props.client
      .assistantSettings()
      .then((view) => {
        if (cancelled) return;
        setDictationEnabled(view.transcription.enabled);
        setSuggestEnabled(
          view.reply.enabled &&
            view.reply.baseUrl.trim().length > 0 &&
            view.reply.model.trim().length > 0,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setDictationEnabled(false);
          setSuggestEnabled(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.client]);

  useEffect(() => {
    dictationMounted.current = true;
    return () => {
      dictationMounted.current = false;
    };
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    setDictation({ phase: "idle" });
    setDictationElapsedMs(0);
    return () => cleanupDictation();
  }, [props.sessionRef, cleanupDictation]);

  useEffect(() => {
    setSuggestions([]);
    setSuggestState("idle");
    setSuggestError(undefined);
  }, [props.sessionRef]);

  useEffect(() => {
    if (dictation.phase !== "recording") {
      setDictationElapsedMs(0);
      return;
    }
    const startedAt = dictation.startedAt;
    setDictationElapsedMs(Date.now() - startedAt);
    const timer = window.setInterval(() => {
      setDictationElapsedMs(Date.now() - startedAt);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [dictation]);

  useEffect(() => {
    if (dictation.phase !== "recording") return;
    const remaining = Math.max(
      0,
      MAX_DICTATION_MS - (Date.now() - dictation.startedAt),
    );
    dictationStopTimer.current = window.setTimeout(() => {
      dictationStopRef.current();
    }, remaining);
    return () => {
      if (dictationStopTimer.current) {
        clearTimeout(dictationStopTimer.current);
        dictationStopTimer.current = undefined;
      }
    };
  }, [dictation]);

  const refreshHistory = useCallback(async () => {
    if (!sessionProvider?.capabilities.undo) {
      setHistory(undefined);
      return;
    }
    try {
      setHistory(await props.client.history(props.sessionRef));
    } catch {
      // History is an affordance, not the transcript. Keep the last known
      // state rather than hiding the banner on a transient provider error.
    }
  }, [props.client, props.sessionRef, sessionProvider?.capabilities.undo]);

  const refreshLatest = useCallback(
    async (forceBottom = false, replace = false) => {
      // Apply the header as soon as it arrives: a slow transcript should not
      // hold the context strip and title hostage.
      const sessionPromise = props.client
        .session(props.sessionRef)
        .then((nextSession) => {
          setSession(nextSession);
          writeSessionCache(nextSession);
          return nextSession;
        });
      const [, page] = await Promise.all([
        sessionPromise,
        props.client.messages(props.sessionRef, {
          limit: MESSAGE_PAGE_SIZE,
          order: "desc",
        }),
      ]);
      const latest = [...page.data].reverse();
      const stick = (forceBottom || isAtBottom()) && !restoreScroll.current;
      setError(undefined);
      setMessages((current) =>
        replace ? latest : mergeLatestPage(current, latest),
      );
      setOlderCursor((current) => (replace ? page.cursor.next : current ?? page.cursor.next));
      if (stick) pendingScroll.current = { mode: "bottom" };
    },
    [props.client, props.sessionRef],
  );

  useEffect(() => {
    let cancelled = false;
    setHistory(undefined);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    setHistoryFilesOpen(false);
    setHistoryPromptOpen(false);
    setHistoryConfirmOpen(false);
    if (!sessionProvider?.capabilities.undo) return;
    void props.client
      .history(props.sessionRef)
      .then((next) => {
        if (!cancelled) setHistory(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [
    props.client,
    props.sessionRef,
    sessionProvider?.capabilities.undo,
  ]);

  useEffect(() => {
    if (!historyNotice || history?.staged) return;
    const timer = window.setTimeout(() => setHistoryNotice(undefined), 4_000);
    return () => window.clearTimeout(timer);
  }, [historyNotice, history?.staged]);

  const retryTranscript = useCallback(async () => {
    if (retryingTranscript) return;
    setRetryingTranscript(true);
    try {
      await refreshLatest(true);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load the transcript",
      );
    } finally {
      setRetryingTranscript(false);
    }
  }, [refreshLatest, retryingTranscript]);

  useEffect(
    () =>
      subscribeQueueResults(({ idempotencyKey, status, error }) => {
        setMessages((current) =>
          current.map((message) => {
            const payload = optimisticSend(message);
            if (!payload || payload.idempotencyKey !== idempotencyKey) {
              return message;
            }
            return status === "sent"
              ? updateOptimisticStatus(message, "sent")
              : updateOptimisticStatus(message, "failed", error);
          }),
        );
        if (status === "sent") {
          window.setTimeout(
            () => void refreshLatest(true).catch(() => undefined),
            300,
          );
        }
      }),
    [refreshLatest],
  );

  const loadOlder = useCallback(async () => {
    if (!olderCursor || loadingOlder) return;
    const scroller = getScroller();
    if (scroller) {
      pendingScroll.current = {
        mode: "preserve",
        height: scroller.scrollHeight,
        top: scroller.scrollTop,
      };
    }
    setLoadingOlder(true);
    setError(undefined);
    try {
      const page = await props.client.messages(props.sessionRef, {
        limit: MESSAGE_PAGE_SIZE,
        order: "desc",
        cursor: olderCursor,
      });
      const older = [...page.data].reverse();
      if (older.length === 0) pendingScroll.current = undefined;
      setMessages((current) => {
        const seen = new Set(current.map((message) => message.id));
        const prepend = older.filter((message) => !seen.has(message.id));
        return prepend.length > 0 ? [...prepend, ...current] : current;
      });
      setOlderCursor(page.cursor.next);
    } catch (reason) {
      pendingScroll.current = undefined;
      setError(reason instanceof Error ? reason.message : "Unable to load older messages");
    } finally {
      setLoadingOlder(false);
    }
  }, [olderCursor, loadingOlder, props.client, props.sessionRef]);

  useEffect(() => {
    lookupMessageRef.current = undefined;
    scrolledMessageRef.current = undefined;
    setMessageLookup("idle");
    setMessageBarDismissed(false);
  }, [props.messageID]);

  useEffect(() => {
    const target = props.messageID;
    if (!target) return;
    if (lookupMessageRef.current === target) return;
    if (loading) return;
    if (messages.some((message) => message.id === target)) {
      lookupMessageRef.current = target;
      setMessageLookup("idle");
      return;
    }
    if (!olderCursor) {
      lookupMessageRef.current = target;
      setMessageLookup("missing");
      return;
    }
    lookupMessageRef.current = target;
    setMessageLookup("loading");
    let cancelled = false;
    let cursor: string | null = olderCursor;
    void (async () => {
      let found = false;
      for (
        let pageIndex = 0;
        pageIndex < MAX_MESSAGE_LOOKUP_PAGES && cursor;
        pageIndex += 1
      ) {
        const page = await props.client.messages(props.sessionRef, {
          limit: MESSAGE_PAGE_SIZE,
          order: "desc",
          cursor,
        });
        const older = [...page.data].reverse();
        if (older.length === 0) {
          cursor = null;
          break;
        }
        setMessages((current) => {
          const seen = new Set(current.map((message) => message.id));
          const prepend = older.filter((message) => !seen.has(message.id));
          return prepend.length > 0 ? [...prepend, ...current] : current;
        });
        cursor = page.cursor.next;
        setOlderCursor(cursor);
        if (older.some((message) => message.id === target)) {
          found = true;
          break;
        }
      }
      if (cancelled) return;
      setOlderCursor(cursor);
      setMessageLookup(found ? "idle" : "missing");
    })().catch((reason) => {
      if (cancelled) return;
      setMessageLookup("missing");
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to locate the message",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [
    loading,
    messages,
    olderCursor,
    props.client,
    props.messageID,
    props.sessionRef,
  ]);

  useEffect(() => {
    const target = props.messageID;
    if (!target) {
      scrolledMessageRef.current = undefined;
      return;
    }
    if (scrolledMessageRef.current === target) return;
    let element = document.getElementById(`message-${target}`);
    if (!element) {
      element = document.querySelector(`[data-message-ids~="${target}"]`);
    }
    if (!element) return;
    scrolledMessageRef.current = target;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const frame = requestAnimationFrame(() => {
      element!.scrollIntoView({
        block: "center",
        behavior: reduced ? "auto" : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, props.messageID]);

  const forkFromMessage = useCallback(
    async (message: Message) => {
      if (forkingMessageID) return;
      setForkingMessageID(message.id);
      setError(undefined);
      try {
        const forked = await props.client.forkSession(props.sessionRef, {
          before: message.id,
        });
        props.onOpenSession(forked.ref);
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to fork this session",
        );
      } finally {
        setForkingMessageID(undefined);
      }
    },
    [
      forkingMessageID,
      props.client,
      props.onOpenSession,
      props.sessionRef,
    ],
  );

  const refreshBranches = useCallback(async () => {
    if (!branchesSupported) {
      setBranches([]);
      return;
    }
    try {
      setBranches(await props.client.branches(props.sessionRef));
    } catch {
      setBranches([]);
    }
  }, [branchesSupported, props.client, props.sessionRef]);

  useEffect(() => {
    void refreshBranches();
  }, [refreshBranches]);

  const refreshFileRoots = useCallback(async () => {
    if (!sessionProvider?.capabilities.files) {
      setPreviewRoots([]);
      return;
    }
    try {
      setPreviewRoots(await props.client.fileRoots(props.sessionRef));
    } catch {
      setPreviewRoots([]);
    }
  }, [props.client, props.sessionRef, sessionProvider?.capabilities.files]);

  useEffect(() => {
    void refreshFileRoots();
  }, [refreshFileRoots]);

  const retryMessage = async (messageId: string) => {
    if (retryBusy) return;
    setRetryBusy(messageId);
    setBranchError(undefined);
    try {
      await props.client.retryMessage(props.sessionRef, messageId);
      await refreshLatest(true, true);
      await refreshBranches();
      void refreshHistory();
      atBottomRef.current = true;
      setAtBottom(true);
    } catch (reason) {
      setBranchError(
        reason instanceof Error
          ? reason.message
          : "Unable to retry the message.",
      );
    } finally {
      setRetryBusy(undefined);
    }
  };

  const undoLastTurn = async () => {
    if (!historySupported || historyBusy) return;
    setToolsOpen(false);
    setHistoryBusy("undo");
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    setHistoryFilesOpen(false);
    setHistoryPromptOpen(false);
    setHistoryConfirmOpen(false);
    try {
      const next = await props.client.undoLastTurn(props.sessionRef);
      setHistory(next);
      const text = next.prompt?.text ?? "";
      if (text && !draftRef.current.trim()) {
        updateDraft(text);
        setHistoryNotice("Prompt restored to the composer.");
      } else if (text) {
        setHistoryNotice("Draft kept. Show prompt to insert the undone prompt.");
      }
      pendingScroll.current = { mode: "bottom" };
      atBottomRef.current = true;
      setAtBottom(true);
    } catch (reason) {
      setHistoryError(
        reason instanceof Error
          ? reason.message
          : "Unable to undo the last turn.",
      );
    } finally {
      setHistoryBusy(undefined);
    }
  };

  const redoLastTurn = async () => {
    if (!historySupported || historyBusy) return;
    const stagedPrompt = history?.prompt?.text;
    setHistoryBusy("redo");
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    try {
      const next = await props.client.redoLastTurn(props.sessionRef);
      setHistory(next);
      setHistoryFilesOpen(false);
      setHistoryPromptOpen(false);
      setHistoryConfirmOpen(false);
      if (stagedPrompt && draftRef.current === stagedPrompt) {
        await discardDraft();
      }
      setHistoryNotice("Turn restored.");
      await refreshLatest(true);
      atBottomRef.current = true;
      setAtBottom(true);
    } catch (reason) {
      setHistoryError(
        reason instanceof Error
          ? reason.message
          : "Unable to redo the last turn.",
      );
    } finally {
      setHistoryBusy(undefined);
    }
  };

  const restoreHistoryFiles = async () => {
    if (!restoreFilesSupported || historyRestoring) return;
    setHistoryRestoring(true);
    setHistoryError(undefined);
    setHistoryNotice(undefined);
    try {
      const next = await props.client.restoreHistoryFiles(props.sessionRef);
      setHistory(next);
      setHistoryConfirmOpen(false);
      setHistoryNotice("Files restored.");
    } catch (reason) {
      setHistoryError(
        reason instanceof Error ? reason.message : "Unable to restore files.",
      );
    } finally {
      setHistoryRestoring(false);
    }
  };

  const continueTurn = async (messageId: string) => {
    if (continueBusy || sending) return;
    setContinueBusy(messageId);
    setBranchError(undefined);
    setSendError(undefined);
    try {
      await props.client.sendMessage(props.sessionRef, {
        text: "Continue from where you left off.",
      });
      setSession((current) =>
        current ? { ...current, status: "running" } : current,
      );
      await refreshLatest(true);
      atBottomRef.current = true;
      setAtBottom(true);
    } catch (reason) {
      setBranchError(
        reason instanceof Error
          ? reason.message
          : "Unable to continue the session.",
      );
    } finally {
      setContinueBusy(undefined);
    }
  };

  const switchBranch = async (point: BranchPoint, siblingId: string) => {
    if (branchBusy) return;
    setBranchBusy(point.messageId);
    setBranchError(undefined);
    try {
      await props.client.switchBranch(props.sessionRef, siblingId);
      await refreshLatest(true, true);
      await refreshBranches();
      void refreshHistory();
      atBottomRef.current = true;
      setAtBottom(true);
    } catch (reason) {
      setBranchError(
        reason instanceof Error
          ? reason.message
          : "Unable to switch the branch.",
      );
    } finally {
      setBranchBusy(undefined);
    }
  };

  const suggestReplies = async () => {
    if (!suggestEnabled || suggestState === "loading" || sending) return;
    if (suggestPrefetchTimer.current) {
      window.clearTimeout(suggestPrefetchTimer.current);
      suggestPrefetchTimer.current = undefined;
    }
    prefetchedSuggestKey.current = suggestPrefetchKey();
    setSuggestState("loading");
    setSuggestError(undefined);
    setSuggestions([]);
    try {
      const options = await props.client.replyOptions(
        props.sessionRef,
        "reply",
      );
      // A finished or running turn is still a conversation: show the model's
      // suggestions instead of a "no reply needed" notice.
      const modelOptions = options.data.filter(
        (option) => option.source === "model" && option.text.trim(),
      );
      if (modelOptions.length === 0) {
        setSuggestState("error");
        setSuggestError(
          "No grounded suggestions. Try again or check the reply model.",
        );
        return;
      }
      setSuggestions(modelOptions);
      setSuggestState("idle");
    } catch (reason) {
      setSuggestState("error");
      setSuggestError(
        reason instanceof Error ? reason.message : "Unable to suggest replies",
      );
    }
  };

  const insertSuggestion = (option: ReplyOption) => {
    const text = option.text.trim();
    if (!text) return;
    const current = draftRef.current.trimEnd();
    const next = current ? `${current}\n${text}` : text;
    updateDraft(next);
    setSuggestions([]);
    setSuggestState("idle");
    setSuggestError(undefined);
    requestAnimationFrame(() => {
      const input = document.getElementById(
        "chat-composer-input",
      ) as HTMLTextAreaElement | null;
      if (!input) return;
      input.focus();
      input.setSelectionRange(next.length, next.length);
    });
  };

  const dismissSuggestions = () => {
    setSuggestions([]);
    setSuggestState("idle");
    setSuggestError(undefined);
  };

  const runSuggest = () => {
    setToolsOpen(false);
    void suggestReplies();
  };

  const toggleDictation = () => {
    setToolsOpen(false);
    if (dictation.phase === "recording") stopDictation();
    else void startDictation();
  };

  const send = async (override?: SendDelivery) => {
    setToolsOpen(false);
    const text = draft.trim();
    const attachmentIDs = attachments.map((attachment) => attachment.id);
    if (
      (!text && attachmentIDs.length === 0) ||
      sending ||
      dictationBusy ||
      uploadingAttachments > 0 ||
      (running && !canSteer && !canQueue)
    ) {
      return;
    }
    // Send always means steer while a steer-capable agent runs. Queue is an
    // explicit secondary action, never a mode that changes Send's meaning.
    const delivery: SendDelivery | undefined = running
      ? (override ?? (canSteer ? "steer" : canQueue ? "queue" : undefined))
      : undefined;
    const queueDelivery =
      delivery === "queue" && running && canQueue;
    const historyWasStaged = Boolean(history?.staged);
    const previousAttachments = attachments;
    setSending(true);
    setSendError(undefined);

    let idempotencyKey: string;
    let created: Message;
    try {
      idempotencyKey = createID();
      created = createOptimisticMessage({
        sessionRef: props.sessionRef,
        text,
        attachments,
        idempotencyKey,
      });
    } catch (reason) {
      setSendError(promptFailure(reason));
      setSending(false);
      return;
    }

    let appended = false;
    const queue = () => {
      enqueueSend({
        id: created.id,
        sessionRef: props.sessionRef,
        text,
        attachments,
        idempotencyKey,
        createdAt: created.createdAt,
        ...(delivery ? { delivery } : {}),
      });
      if (appended) {
        setMessages((current) =>
          current.map((message) =>
            message.id === created.id
              ? updateOptimisticStatus(message, "queued")
              : message,
          ),
        );
      } else {
        appended = true;
        setMessages((current) => [
          ...current,
          updateOptimisticStatus(created, "queued"),
        ]);
        pendingScroll.current = { mode: "bottom" };
      }
    };

    try {
      if (!queueDelivery) {
        appended = true;
        setMessages((current) => [...current, created]);
        pendingScroll.current = { mode: "bottom" };
      }
      setAttachments([]);
      await discardDraft();
      dismissSuggestions();

      if (!isOnline()) {
        queue();
        return;
      }

      await props.client.sendMessage(
        props.sessionRef,
        {
          text,
          ...(attachmentIDs.length > 0 ? { attachments: attachmentIDs } : {}),
          ...(delivery ? { delivery } : {}),
        },
        { idempotencyKey },
      );
      setAttachments([]);
      if (queueDelivery) {
        await refreshInbox();
      } else if (appended) {
        setMessages((current) =>
          current.map((message) =>
            message.id === created.id
              ? updateOptimisticStatus(message, "sent")
              : message,
          ),
        );
      }
      setSession((current) => (current ? { ...current, status: "running" } : current));
      setHistoryNotice(undefined);
      window.setTimeout(() => {
        void refreshLatest(true, historyWasStaged).catch(() => undefined);
        void refreshBranches();
        void refreshHistory();
      }, 500);
    } catch (reason) {
      if (shouldQueue(reason)) {
        queue();
        return;
      }
      const message = promptFailure(reason);
      if (text && !draftRef.current.trim()) {
        // The draft was deleted before the request. Restore it so a reload
        // does not lose the failed message, unless the user already typed a
        // new draft.
        void props.client.saveDraft(props.sessionRef, text).catch(() => undefined);
      }
      if (queueDelivery) setAttachments(previousAttachments);
      if (appended) {
        setMessages((current) =>
          current.map((item) =>
            item.id === created.id
              ? updateOptimisticStatus(item, "failed", message)
              : item,
          ),
        );
      } else {
        // The failure happened before the optimistic message existed, so there
        // is nothing in the transcript to carry the error. Surface it directly.
        setSendError(message);
      }
    } finally {
      setSending(false);
    }
  };

  const retryOptimistic = async (message: Message) => {
    const payload = optimisticSend(message);
    if (!payload) return;
    setMessages((current) =>
      current.map((item) =>
        item.id === message.id ? updateOptimisticStatus(item, "sending") : item,
      ),
    );
    try {
      await props.client.sendMessage(
        props.sessionRef,
        {
          text: payload.text,
          ...(payload.attachmentIDs.length > 0
            ? { attachments: payload.attachmentIDs }
            : {}),
        },
        { idempotencyKey: payload.idempotencyKey },
      );
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id ? updateOptimisticStatus(item, "sent") : item,
        ),
      );
      setSession((current) => (current ? { ...current, status: "running" } : current));
      if (!draftRef.current.trim()) {
        void props.client.deleteDraft(props.sessionRef).catch(() => undefined);
      }
      window.setTimeout(() => {
        void refreshLatest(true).catch(() => undefined);
        void refreshBranches();
      }, 500);
    } catch (reason) {
      const error = promptFailure(reason);
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? updateOptimisticStatus(item, "failed", error)
            : item,
        ),
      );
    }
  };

  const discardOptimistic = (message: Message) => {
    const payload = optimisticSend(message);
    if (payload) removeQueuedSend(payload.idempotencyKey);
    setMessages((current) => current.filter((item) => item.id !== message.id));
    for (const id of payload?.attachmentIDs ?? []) {
      void props.client.deleteAttachment(id).catch(() => undefined);
    }
    if (!draftRef.current.trim()) {
      void props.client.deleteDraft(props.sessionRef).catch(() => undefined);
    }
  };

  const promoteQueued = async (item: InboxItem) => {
    if (inboxBusy) return;
    setInboxBusy(item.id);
    setSendError(undefined);
    try {
      await props.client.updateInboxDelivery(
        props.sessionRef,
        item.id,
        "steer",
      );
      await refreshInbox();
      await refreshLatest(true);
      atBottomRef.current = true;
      setAtBottom(true);
    } catch (reason) {
      setSendError(
        reason instanceof Error
          ? reason.message
          : "Unable to steer the queued message.",
      );
    } finally {
      setInboxBusy(undefined);
    }
  };

  const removeQueued = async (item: InboxItem) => {
    if (inboxBusy) return;
    setInboxBusy(item.id);
    setSendError(undefined);
    try {
      await props.client.deleteInbox(props.sessionRef, item.id);
      await refreshInbox();
    } catch (reason) {
      setSendError(
        reason instanceof Error
          ? reason.message
          : "Unable to remove the queued message.",
      );
    } finally {
      setInboxBusy(undefined);
    }
  };

  const beginEdit = (message: Message) => {
    if (!canEdit || message.role !== "user" || optimisticSend(message)) return;
    const text = messageCopyText(message);
    if (!text) return;
    setEditingMessageID(message.id);
    setEditText(text);
    setEditError(undefined);
  };

  const cancelEdit = () => {
    if (editBusy) return;
    void editDraft.clear();
    setEditingMessageID(undefined);
    setEditText("");
    setEditError(undefined);
  };

  const saveEdit = async () => {
    if (!editingMessageID || editBusy || !editText.trim()) return;
    setEditBusy(true);
    setEditError(undefined);
    try {
      await editDraft.flush();
      const forked = await props.client.forkSession(props.sessionRef, {
        before: editingMessageID,
      });
      await props.client.saveDraft(forked.ref, editText.trim());
      await editDraft.clear();
      setEditingMessageID(undefined);
      setEditText("");
      props.onOpenSession(forked.ref);
    } catch (reason) {
      setEditError(
        reason instanceof Error
          ? reason.message
          : "Unable to edit this message.",
      );
    } finally {
      setEditBusy(false);
    }
  };

  const uploadAttachments = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return;
    setAttachmentError(undefined);
    let count = attachments.length;
    for (const file of Array.from(files)) {
      if (count >= MAX_ATTACHMENTS_PER_MESSAGE) {
        setAttachmentError(
          `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files.`,
        );
        break;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        setAttachmentError(`${file.name} is larger than 20 MB.`);
        continue;
      }
      count += 1;
      setUploadingAttachments((current) => current + 1);
      try {
        const attachment = await props.client.uploadAttachment(file);
        setAttachments((current) => [...current, attachment]);
      } catch (reason) {
        setAttachmentError(
          reason instanceof Error
            ? reason.message
            : "Unable to upload the attachment.",
        );
      } finally {
        setUploadingAttachments((current) => Math.max(0, current - 1));
      }
    }
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  };

  const removeAttachment = async (id: string) => {
    setAttachments((current) =>
      current.filter((attachment) => attachment.id !== id),
    );
    await props.client.deleteAttachment(id).catch(() => undefined);
  };

  const pasteAttachments = (event: ClipboardEvent<HTMLFormElement>) => {
    if (!attachSupported) return;
    const files = pastedFiles(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadAttachments(files);
  };

  const interrupt = async () => {
    if (interrupting) return;
    setInterrupting(true);
    setSendError(undefined);
    try {
      await props.client.interrupt(props.sessionRef);
      await refreshLatest();
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "Unable to interrupt");
    } finally {
      setInterrupting(false);
    }
  };

  const loadAttention = useCallback(async () => {
    try {
      const page = await props.client.attention({ sessionRef: props.sessionRef });
      setInlineAttention(
        page.data.filter(
          (item) =>
            item.type === "permission" ||
            item.type === "approval" ||
            item.type === "question" ||
            item.type === "error",
        ),
      );
      setAttentionError(undefined);
    } catch (reason) {
      setAttentionError(
        reason instanceof Error ? reason.message : "Unable to load approvals",
      );
    }
  }, [props.client, props.sessionRef]);

  const actOnAttention = async (
    item: Attention,
    action: string,
    input: Record<string, unknown> = {},
  ) => {
    setAttentionBusyID(item.id);
    setAttentionError(undefined);
    try {
      await props.client.actOnAttention(item.id, action, input);
      setInlineAttention((current) => current.filter((candidate) => candidate.id !== item.id));
      window.setTimeout(() => void loadAttention().catch(() => undefined), 600);
    } catch (reason) {
      setAttentionError(
        reason instanceof Error ? reason.message : "Unable to complete the action",
      );
    } finally {
      setAttentionBusyID(undefined);
    }
  };

  const markRead = async () => {
    if (markingRead) return;
    setMarkingRead(true);
    try {
      await props.client.markRead(props.sessionRef);
      setSession((current) => (current ? { ...current, unread: false } : current));
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "Unable to mark the session read");
    } finally {
      setMarkingRead(false);
    }
  };

  const applySelection = async (input: SessionSelectionInput) => {
    if (selectionSaving) return;
    setSelectionSaving(true);
    setSelectionError(undefined);
    try {
      const updated = await props.client.setSessionSelection(props.sessionRef, input);
      setSession(updated);
    } catch (reason) {
      setSelectionError(
        reason instanceof Error
          ? reason.message
          : "Unable to change the model or agent",
      );
      if (session) {
        const parsed = splitModel(session.model);
        setAgentValue(
          session.agent ??
            selectionOptions?.defaults?.agent ??
            selectionOptions?.agents[0]?.id ??
            "",
        );
        setModelValue(
          parsed.model ||
            selectionOptions?.defaults?.model ||
            selectionOptions?.models[0]?.id ||
            "",
        );
        setVariantValue(parsed.variant ?? "");
      }
    } finally {
      setSelectionSaving(false);
    }
  };

  useEffect(() => {
    if (!session || !sessionProvider?.capabilities.options) {
      setSelectionOptions(undefined);
      return;
    }
    let cancelled = false;
    props.client
      .options(session.providerID)
      .then((options) => {
        if (!cancelled) setSelectionOptions(options);
      })
      .catch(() => {
        if (!cancelled) setSelectionOptions(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, session?.providerID, sessionProvider?.capabilities.options]);

  useEffect(() => {
    if (!session || !selectionOptions) return;
    const parsed = splitModel(session.model);
    setAgentValue(
      session.agent ??
        selectionOptions.defaults?.agent ??
        selectionOptions.agents[0]?.id ??
        "",
    );
    setModelValue(
      parsed.model ||
        selectionOptions.defaults?.model ||
        selectionOptions.models[0]?.id ||
        "",
    );
    setVariantValue(parsed.variant ?? "");
    setSelectionError(undefined);
  }, [session?.model, session?.agent, selectionOptions]);

  useEffect(() => {
    props.onSessionChange(session);
  }, [session, props.onSessionChange]);

  useEffect(
    () => () => {
      props.onSessionChange(undefined);
    },
    [props.onSessionChange],
  );

  const attentionSeq = props.events.reduce(
    (latest, event) =>
      event.type === "resync" ||
      (event.type.startsWith("attention.") && event.sessionRef === props.sessionRef)
        ? Math.max(latest, event.seq)
        : latest,
    0,
  );

  useEffect(() => {
    void loadAttention();
    const timer = setInterval(() => void loadAttention(), 15_000);
    return () => clearInterval(timer);
  }, [loadAttention]);

  useEffect(() => {
    if (!attentionSeq) return;
    const timer = setTimeout(() => void loadAttention(), 500);
    return () => clearTimeout(timer);
  }, [attentionSeq, loadAttention]);

  // A notification deep link names one item. Scroll it into view once it
  // arrives; the inline card is the action surface, so no separate sheet.
  useEffect(() => {
    if (!props.attentionID) {
      focusedAttention.current = undefined;
      return;
    }
    if (focusedAttention.current === props.attentionID) return;
    const element = document.getElementById(`attention-${props.attentionID}`);
    if (!element) return;
    focusedAttention.current = props.attentionID;
    const frame = requestAnimationFrame(() => {
      element.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [props.attentionID, inlineAttention]);

  useEffect(() => {
    if (!atBottom || stepPanelOpen) return;
    const scroller = getScroller();
    if (!scroller) return;
    const frame = requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [attentionSignature, atBottom, stepPanelOpen]);

  useEffect(() => {
    const scroller = getScroller();
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        updateScrollState();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [session, updateScrollState]);

  useEffect(() => {
    const scroller = getScroller();
    if (!scroller) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current && !stepPanelOpen) {
        scroller.scrollTop = scroller.scrollHeight;
      }
      updateScrollState();
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [session, stepPanelOpen, updateScrollState]);

  useEffect(() => {
    if (loading) return;
    const scroller = getScroller();
    if (!scroller) return;
    const frame = requestAnimationFrame(() => {
      if (atBottomRef.current && !stepPanelOpen) {
        scroller.scrollTop = scroller.scrollHeight;
      }
      updateScrollState();
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, messages, stepPanelOpen, updateScrollState]);

  useEffect(() => {
    let cancelled = false;
    pendingScroll.current = undefined;
    restoreScroll.current = hasSavedScroll("transcript");
    autoRetried.current = false;
    const cachedSession = readSessionCache(props.sessionRef);
    setSession(cachedSession);
    setMessages(
      cachedTranscript
        ? [...cachedTranscript.messages, ...queuedMessages(props.sessionRef)]
        : queuedMessages(props.sessionRef),
    );
    setOlderCursor(cachedTranscript?.olderCursor ?? null);
    setLoading(!cachedTranscript || !cachedSession);
    setChecking(Boolean(cachedTranscript));
    setError(undefined);
    setSendError(undefined);
    setInlineAttention([]);
    setAttentionBusyID(undefined);
    setAttentionError(undefined);
    const initialAtBottom = !restoreScroll.current;
    atBottomRef.current = initialAtBottom;
    setAtBottom(initialAtBottom);
    setShowJump(false);
    setScrollable(false);
    refreshLatest(true)
      .then(() => {
        if (!cancelled) {
          void props.client.markRead(props.sessionRef).catch(() => undefined);
        }
      })
      .catch((reason) => {
        if (cancelled) return;
        if ((reason as { status?: number } | undefined)?.status === 404) {
          removeSessionCache(props.sessionRef);
          removeTranscriptCache(props.sessionRef);
          setSession(undefined);
          setMessages([]);
          props.onSessionChange(undefined);
        }
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load the session",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setChecking(false);
          restoreScroll.current = false;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.sessionRef, refreshLatest]);

  useEffect(() => {
    if (loading || checking || error) return;
    writeTranscriptCache(props.sessionRef, {
      messages: messages.filter((message) => !isOptimisticMessage(message)),
      olderCursor,
    });
  }, [checking, error, loading, messages, olderCursor, props.sessionRef]);

  /**
   * One automatic retry when a running session has not written its first
   * message yet. The provider may accept a prompt before it is readable; a
   * second read a moment later usually settles it. One shot only, reset per
   * session, so a stuck provider cannot loop.
   */
  useEffect(() => {
    if (phase !== "waiting" || autoRetried.current) return;
    autoRetried.current = true;
    const timer = window.setTimeout(() => void retryTranscript(), 1200);
    return () => window.clearTimeout(timer);
  }, [phase, retryTranscript]);

  useEffect(() => {
    const fresh = props.events.filter((event) => event.seq > processedSeq.current);
    if (fresh.length === 0) return;
    processedSeq.current = Math.max(
      processedSeq.current,
      ...fresh.map((event) => event.seq),
    );

    const upserts: Message[] = [];
    let needsRefresh = false;
    let needsHistory = false;
    let replaceTranscript = false;
    for (const event of fresh) {
      if (event.type === "resync") {
        needsRefresh = true;
        needsHistory = true;
        continue;
      }
      if (event.sessionRef !== props.sessionRef) continue;
      if (event.type === "message.created" || event.type === "message.updated") {
        const message = messageFromHubEvent(event);
        if (message) upserts.push(message);
        continue;
      }
      if (event.type === "session.updated" || event.type === "message.delta") {
        needsRefresh = true;
        const eventType =
          event.data && typeof event.data === "object" && "eventType" in event.data
            ? (event.data as { eventType?: unknown }).eventType
            : undefined;
        if (
          typeof eventType === "string" &&
          eventType.startsWith("session.revert.")
        ) {
          needsHistory = true;
          if (eventType === "session.revert.committed") replaceTranscript = true;
        }
      }
    }

    if (upserts.length > 0) {
      setMessages((current) => mergeMessageUpdates(current, upserts));
    }
    if (needsRefresh) {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = undefined;
        void refreshLatest(false, replaceTranscript).catch(() => undefined);
        if (needsHistory) void refreshHistory();
      }, 400);
    }
  }, [props.events, props.sessionRef, refreshLatest, refreshHistory]);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    [],
  );

  useEffect(() => {
    const pending = pendingScroll.current;
    const scroller = getScroller();
    if (!pending || !scroller) return;
    pendingScroll.current = undefined;
    const frame = requestAnimationFrame(() => {
      if (pending.mode === "bottom") {
        scroller.scrollTop = scroller.scrollHeight;
      } else {
        scroller.scrollTop =
          pending.top + (scroller.scrollHeight - pending.height);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [messages]);

  useEffect(() => {
    const scroller = getScroller();
    if (!scroller || !olderCursor || loadingOlder) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (scroller.scrollTop < 120) void loadOlder();
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [session, olderCursor, loadingOlder, loadOlder]);

  const agents = selectionOptions?.agents ?? [];
  const models = selectionOptions?.models ?? [];
  const agentChoices =
    agentValue && !agents.some((agent) => agent.id === agentValue)
      ? [...agents, { id: agentValue, label: agentValue }]
      : agents;
  const modelChoices =
    modelValue && !models.some((model) => model.id === modelValue)
      ? [...models, { id: modelValue, label: modelValue }]
      : models;
  const selectedModelOption = models.find((model) => model.id === modelValue);
  const variants = selectedModelOption?.variants ?? [];
  const variantChoices =
    variantValue && !variants.some((variant) => variant.id === variantValue)
      ? [...variants, { id: variantValue, label: variantValue }]
      : variants;
  const variantSelectLabel = variantChoices.some((variant) =>
    /^(max|high|medium|low|minimal|none|default)$/i.test(variant.id),
  )
    ? "Reasoning"
    : "Variant";
  const showSelection = Boolean(
    selectionOptions && (agents.length > 0 || models.length > 0),
  );
  const selectionDisabled =
    selectionSaving || sending || session?.status === "running";
  const attachInTools = attachSupported && (narrow || (compact && running));
  const undoAvailable = Boolean(
    historySupported && history?.canUndo && !history?.staged,
  );
  const undoDisabledReason = running
    ? "Undo waits for the current run to finish"
    : sending
      ? "Undo waits for the send to finish"
      : historyBusy === "undo"
        ? "Undoing the last turn"
        : undefined;
  const stagedHistory = history?.staged;
  const stagedFiles = stagedHistory?.files ?? [];
  const hasComposerTools =
    dictationSupported ||
    (running && canSteer && canQueue) ||
    attachInTools ||
    undoAvailable;
  const selectedAgentLabel =
    agentChoices.find((agent) => agent.id === agentValue)?.label ?? "";
  const selectedModelLabel =
    modelChoices.find((model) => model.id === modelValue)?.label ?? "";
  const contextChipTitle = [selectedAgentLabel, selectedModelLabel]
    .filter(Boolean)
    .join(" · ");
  const contextChipLabel = selectedAgentLabel || "Model";
  const renderSelection = (layout: "inline" | "sheet") => {
    const fieldClass =
      layout === "inline" ? "composer-option" : "composer-sheet-field";
    return (
      <>
        {agentChoices.length > 0 ? (
          <label className={fieldClass}>
            <span>Agent</span>
            <select
              value={agentValue}
              disabled={selectionDisabled}
              aria-label="Agent"
              onChange={(event) => {
                const next = event.currentTarget.value;
                setAgentValue(next);
                void applySelection({ agent: next });
              }}
            >
              {agentChoices.map((agent) => (
                <option value={agent.id} key={agent.id}>
                  {agent.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {modelChoices.length > 0 ? (
          <label className={fieldClass}>
            <span>Model</span>
            <select
              value={modelValue}
              disabled={selectionDisabled}
              aria-label="Model"
              title={modelValue || undefined}
              onChange={(event) => {
                const next = event.currentTarget.value;
                const nextVariants =
                  models.find((model) => model.id === next)?.variants ?? [];
                const nextVariant = nextVariants.some(
                  (variant) => variant.id === variantValue,
                )
                  ? variantValue
                  : "";
                setModelValue(next);
                setVariantValue(nextVariant);
                void applySelection({
                  model: composeModel(next, nextVariant),
                });
              }}
            >
              <ModelSelectOptions models={modelChoices} />
            </select>
          </label>
        ) : null}
        {variantChoices.length > 0 ? (
          <label className={fieldClass}>
            <span>{variantSelectLabel}</span>
            <select
              value={variantValue}
              disabled={selectionDisabled}
              aria-label={variantSelectLabel}
              onChange={(event) => {
                const next = event.currentTarget.value;
                setVariantValue(next);
                void applySelection({
                  model: composeModel(modelValue, next),
                });
              }}
            >
              <option value="">Default</option>
              {variantChoices.map((variant) => (
                <option value={variant.id} key={variant.id}>
                  {variant.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selectionSaving ? (
          <span
            className={`composer-option-status ${layout === "sheet" ? "composer-sheet-status" : ""}`}
          >
            Saving…
          </span>
        ) : null}
        {selectionError ? (
          <span
            className={`composer-option-status error ${layout === "sheet" ? "composer-sheet-status" : ""}`}
          >
            {selectionError}
          </span>
        ) : null}
      </>
    );
  };
  useEffect(() => {
    if (!showSelection) setContextOpen(false);
  }, [showSelection]);
  const errorAttention = inlineAttention.find((item) => item.type === "error");
  const errorMessage = [...messages]
    .reverse()
    .find((message) => message.metadata?.error);
  const providerError = errorMessage?.metadata?.error;
  const attentionDetail =
    errorAttention && providerError ? providerErrorMessage(providerError) : undefined;
  const hasBlockingAttention = inlineAttention.some((item) => item.priority === "blocking");
  const latestQuestion = latestQuestionText(messages);
  const stagedBoundary = history?.staged?.messageId;
  const transcriptMessages = useMemo(() => {
    if (!stagedBoundary) return messages;
    const index = messages.findIndex((message) => message.id === stagedBoundary);
    return index < 0 ? messages : messages.slice(0, index);
  }, [messages, stagedBoundary]);
  const transcriptItems = useMemo(
    () => groupTranscript(transcriptMessages),
    [transcriptMessages],
  );
  const sentHandoffs = useMemo(
    () => handoffs.filter((handoff) => handoff.status === "sent"),
    [handoffs],
  );
  const openHandoffs = useMemo(
    () => handoffs.filter((handoff) => handoff.status !== "sent"),
    [handoffs],
  );
  const timelineItems = useMemo(
    () => mergeHandoffs(transcriptItems, sentHandoffs),
    [transcriptItems, sentHandoffs],
  );
  const focusedMessage = useMemo(
    () =>
      props.messageID
        ? messages.find((message) => message.id === props.messageID)
        : undefined,
    [messages, props.messageID],
  );
  const composerHint =
    uploadingAttachments > 0
      ? "Uploading attachment…"
      : dictation.phase === "starting"
        ? "Starting dictation…"
      : dictation.phase === "recording"
        ? "Recording…"
        : dictation.phase === "transcribing"
          ? "Transcribing…"
          : stagedHistory
            ? history?.mode === "revert"
              ? "Sending accepts the undo"
              : "Sending starts a new branch"
          : draftStatus === "idle" && running
            ? canSteer
              ? "Agent running · Ctrl/⌘ Enter to steer"
              : canQueue
                ? "Agent running · Ctrl/⌘ Enter to queue"
                : "Agent running · interrupt to send"
            : draftStatusLabel(draftStatus);
  const artifactPaths = useMemo(
    () => artifactPathsFromMessages(messages, session?.directory),
    [messages, session?.directory],
  );
  const resource: ResourceContext = {
    baseUrl: sessionProvider?.baseUrl,
    providerID: session?.providerID,
    providerType: sessionProvider?.type,
    directory: session?.directory,
    sessionRef: session?.ref,
    fileRead: Boolean(sessionProvider?.capabilities.files),
    previewRoots,
    artifactPaths,
  };
  // A background subagent's launch call completes immediately, so the tool
  // part keeps a stale `running` status. Liveness comes from the child session.
  const subagentRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool" || toolKind(part.name) !== "subagent") continue;
        const ref = subagentRef(part, session?.providerID);
        if (ref) refs.add(ref);
      }
    }
    return [...refs].sort();
  }, [messages, session?.providerID]);

  const [childStatus, setChildStatus] = useState<
    Record<string, Session["status"] | "unknown">
  >({});

  const refreshChildren = useCallback(async () => {
    if (subagentRefs.length === 0) return;
    const results = await Promise.allSettled(
      subagentRefs.map(async (ref) => {
        const child = await props.client.session(ref);
        return [ref, child.status] as const;
      }),
    );
    setChildStatus((current) => {
      const next = { ...current };
      subagentRefs.forEach((ref, index) => {
        const result = results[index];
        next[ref] =
          result && result.status === "fulfilled"
            ? result.value[1]
            : "unknown";
      });
      return next;
    });
  }, [props.client, subagentRefs]);

  useEffect(() => {
    void refreshChildren().catch(() => undefined);
  }, [refreshChildren]);

  useEffect(() => {
    const live = subagentRefs.some((ref) => childStatus[ref] === "running");
    if (!live) return;
    const timer = setInterval(() => void refreshChildren().catch(() => undefined), 15_000);
    return () => clearInterval(timer);
  }, [childStatus, refreshChildren, subagentRefs]);

  useEffect(() => {
    const touched = props.events.some(
      (event) =>
        event.type.startsWith("session.") &&
        typeof event.sessionRef === "string" &&
        subagentRefs.includes(event.sessionRef),
    );
    if (touched) void refreshChildren().catch(() => undefined);
  }, [props.events, refreshChildren, subagentRefs]);

  const backgroundItems = useMemo<BackgroundItem[]>(() => {
    const items: BackgroundItem[] = [];
    for (const message of messages) {
      const part = shellPart(message);
      if (!part || part.status !== "running") continue;
      items.push({
        key: `shell:${part.id}`,
        kind: "shell",
        label: "Background shell",
        detail: part.command,
        status: "running",
        meta:
          part.startedAt !== undefined
            ? `${formatDuration(Date.now() - part.startedAt)} elapsed`
            : "running",
      });
    }
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type !== "tool" || toolKind(part.name) !== "subagent") continue;
        const ref = subagentRef(part, session?.providerID);
        if (!ref || childStatus[ref] !== "running") continue;
        const detail = [
          inputText(part.input, ["agent"]),
          inputText(part.input, ["description"]),
        ]
          .filter(Boolean)
          .join(" · ");
        items.push({
          key: `subagent:${part.id}`,
          kind: "subagent",
          label: "Subagent",
          detail: detail || "child session",
          status: "running",
          meta: "running",
          childRef: ref,
        });
      }
    }
    return items;
  }, [messages, session?.providerID, childStatus]);
  const backgroundSubagents = backgroundItems.filter(
    (item) => item.kind === "subagent",
  ).length;
  const backgroundShells = backgroundItems.length - backgroundSubagents;
  const backgroundLabel =
    backgroundSubagents > 0 && backgroundShells === 0
      ? `${backgroundSubagents} subagent${backgroundSubagents === 1 ? "" : "s"} running`
      : backgroundShells > 0 && backgroundSubagents === 0
        ? `${backgroundShells} shell${backgroundShells === 1 ? "" : "s"} running`
        : `${backgroundItems.length} running`;

  useEffect(() => {
    if (loading) return;
    const scroller = getScroller();
    if (!scroller) return;
    const frame = requestAnimationFrame(() => {
      if (atBottomRef.current && !stepPanelOpen) {
        scroller.scrollTop = scroller.scrollHeight;
      }
      updateScrollState();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    backgroundItems.length,
    handoffAbortNotice,
    handoffs.length,
    loading,
    stepPanelOpen,
    updateScrollState,
  ]);

  return (
    <div className={`chat-layout ${props.detailsOpen && session ? "details-open" : ""}`}>
      <div className="chat-main">
        {loading && !session ? (
          <div className="empty chat-loading" aria-busy="true">
            <TranscriptSkeleton />
            <span className="sr-only" role="status" aria-live="polite">
              Loading transcript…
            </span>
          </div>
        ) : error && !session ? (
          <div className="alert" role="alert">
            {error}
            <button className="text-button" type="button" onClick={props.onBack}>
              Back
            </button>
          </div>
        ) : session ? (
          <>
            {error ? (
              <div className="alert" role="alert">
                {error}
                {messages.length === 0 ? (
                  <button
                    className="text-button"
                    type="button"
                    disabled={retryingTranscript}
                    onClick={() => void retryTranscript()}
                  >
                    {retryingTranscript ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
                <button className="text-button" type="button" onClick={() => setError(undefined)}>
                  Dismiss
                </button>
              </div>
            ) : null}

            <div className="chat-transcript">
              <section
                className="chat-panel"
                aria-label="Session transcript"
                ref={transcriptRef}
                tabIndex={0}
                aria-busy={phase === "loading" || checking}
              >
              {phase === "loading" ? (
                <span className="sr-only" role="status" aria-live="polite">
                  Loading transcript…
                </span>
              ) : null}
              <header className="chat-doc-head">
                <div className="chat-meta">
                  {session.project || session.directory ? (
                    <span>{session.project ?? session.directory}</span>
                  ) : null}
                  {session.agent ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{session.agent}</span>
                    </>
                  ) : null}
                  {session.model ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="mono">{session.model}</span>
                    </>
                  ) : null}
                  <span className={`status-chip ${session.status}`}>
                    <i />
                    {statusLabel(session.status)}
                  </span>
                </div>
              </header>

              {olderCursor ? (
                <div className="chat-history-control">
                  <button
                    className="btn small"
                    type="button"
                    disabled={loadingOlder}
                    onClick={() => void loadOlder()}
                  >
                    {loadingOlder ? "Loading older…" : "Load older messages"}
                  </button>
                </div>
              ) : null}

              {phase === "loading" ? (
                <TranscriptSkeleton />
              ) : phase === "waiting" ? (
                <div className="empty transcript-waiting">
                  The agent is running, but no messages have been written yet.
                  <button
                    className="text-button"
                    type="button"
                    disabled={retryingTranscript}
                    onClick={() => void retryTranscript()}
                  >
                    {retryingTranscript ? "Retrying…" : "Retry"}
                  </button>
                </div>
              ) : phase === "empty" && checking ? (
                <div className="empty">Checking for messages…</div>
              ) : phase === "empty" && timelineItems.length === 0 ? (
                <div className="empty">
                  {sessionProvider?.capabilities.send === false
                    ? "No messages yet."
                    : "No messages yet. Send the first prompt below."}
                </div>
              ) : phase === "error" ? null : (
                timelineItems.map((item) =>
                  item.kind === "date" ? (
                    <DateSeparator at={item.at} key={item.key} />
                  ) : item.kind === "message" ? (
                    <TranscriptMessage
                      message={item.message}
                      focused={item.message.id === props.messageID}
                      key={item.message.id}
                      client={props.client}
                      resource={resource}
                      branchPoint={branches.find(
                        (point) =>
                          point.messageId === item.message.id &&
                          point.role === "assistant",
                      )}
                      branchBusy={branchBusy === item.message.id}
                      onSwitchBranch={(point, siblingId) =>
                        void switchBranch(point, siblingId)
                      }
                      canRetry={
                        Boolean(sessionProvider?.capabilities.retry) &&
                        !selectionSaving
                      }
                      retryBusy={retryBusy === item.message.id}
                      onRetry={(messageId) => void retryMessage(messageId)}
                      canContinue={Boolean(sessionProvider?.capabilities.send)}
                      continueBusy={continueBusy === item.message.id}
                      onContinue={(messageId) => void continueTurn(messageId)}
                      onRetryOptimistic={(message) => void retryOptimistic(message)}
                      onDiscardOptimistic={discardOptimistic}
                      canEdit={canEdit}
                      onEdit={(message) => beginEdit(message)}
                      editing={editingMessageID === item.message.id}
                      editText={editText}
                      editBusy={editBusy}
                      editError={editError}
                      editDraftStatus={draftSlotStatusText(editDraft.status)}
                      onEditTextChange={(value) => {
                        setEditText(value);
                        editDraft.save(value);
                      }}
                      onSaveEdit={() => void saveEdit()}
                      onCancelEdit={cancelEdit}
                      suppressError={Boolean(errorAttention)}
                      onPreviewFile={(path) => setPreviewPath(path)}
                      onOpenSession={props.onOpenSession}
                      onStepOpenChange={(open) => {
                        setStepPanelOpen(open);
                        if (open) {
                          atBottomRef.current = false;
                          setAtBottom(false);
                        }
                      }}
                      subagentStatus={childStatus}
                    />
                  ) : item.kind === "compaction" ? (
                    <div
                      id={`message-${item.message.id}`}
                      data-message-ids={item.message.id}
                      className={
                        item.message.id === props.messageID
                          ? "chat-focus-target"
                          : undefined
                      }
                      key={item.key}
                    >
                      <CompactionRow
                        message={item.message}
                        client={props.client}
                        resource={resource}
                      />
                    </div>
                  ) : item.kind === "shell" ? (
                    <div
                      id={`message-${item.message.id}`}
                      data-message-ids={item.message.id}
                      className={
                        item.message.id === props.messageID
                          ? "chat-focus-target"
                          : undefined
                      }
                      key={item.key}
                    >
                      <ShellRow message={item.message} />
                    </div>
                  ) : item.kind === "handoff" ? (
                    <HandoffCard
                      key={item.key}
                      handoff={item.handoff}
                      draft={
                        handoffDrafts[item.handoff.id] ?? item.handoff.message
                      }
                      busy={handoffBusy === item.handoff.id}
                      onChange={(value) =>
                        setHandoffDrafts((current) => ({
                          ...current,
                          [item.handoff.id]: value,
                        }))
                      }
                      onSend={() => void sendHandoff(item.handoff)}
                      onCancel={() => void cancelHandoff(item.handoff)}
                    />
                  ) : (
                    <div
                      id={`message-${item.messages[0]?.id}`}
                      data-message-ids={item.messages
                        .map((message) => message.id)
                        .join(" ")}
                      className={
                        item.messages.some(
                          (message) => message.id === props.messageID,
                        )
                          ? "chat-focus-target"
                          : undefined
                      }
                      key={item.key}
                    >
                      <ActivityTiles
                        steps={item.steps}
                        client={props.client}
                        resource={resource}
                        onPreviewFile={(path) => setPreviewPath(path)}
                        onOpenSession={props.onOpenSession}
                        onStepOpenChange={(open) => {
                          setStepPanelOpen(open);
                          if (open) {
                            atBottomRef.current = false;
                            setAtBottom(false);
                          }
                        }}
                        subagentStatus={childStatus}
                        header={{
                          label: "Agent activity",
                          at: item.messages[0]?.createdAt ?? 0,
                        }}
                      />
                    </div>
                  ),
                )
              )}

              {inlineAttention.length > 0 ? (
                <div
                  className="chat-inline-attention"
                  role="group"
                  aria-label="Needs your input"
                >
                  {inlineAttention.map((item) => (
                    <div
                      className={`chat-inline-attention-item${props.attentionID === item.id ? " is-focused" : ""}`}
                      id={`attention-${item.id}`}
                      key={item.id}
                    >
                      <AttentionCard
                        client={props.client}
                        item={item}
                        busy={attentionBusyID === item.id}
                        inline
                        detail={
                          item.type === "error"
                            ? attentionDetail
                            : item.type === "question"
                              ? item.fields?.some((field) =>
                                  field.description?.trim(),
                                )
                                ? undefined
                                : attentionDetailText(item) ?? latestQuestion
                              : undefined
                        }
                        onAction={(action, input) => void actOnAttention(item, action, input)}
                        onRetry={
                          item.type === "error" &&
                          errorMessage &&
                          sessionProvider?.capabilities.retry &&
                          !selectionSaving
                            ? () => void retryMessage(errorMessage.id)
                            : undefined
                        }
                        retryBusy={retryBusy === errorMessage?.id}
                        onContinue={
                          item.type === "error" &&
                          errorMessage &&
                          sessionProvider?.capabilities.send
                            ? () => void continueTurn(errorMessage.id)
                            : undefined
                        }
                        continueBusy={continueBusy === errorMessage?.id}
                      />
                    </div>
                  ))}
                </div>
              ) : null}

              {attentionError ? (
                <div className="chat-inline-note" role="alert">
                  {attentionError}
                  <button className="text-button" type="button" onClick={() => void loadAttention()}>
                    Retry
                  </button>
                </div>
              ) : null}

              {backgroundItems.length > 0 ? (
                <div className="chat-background-row">
                  <button
                    className="chat-background-chip"
                    type="button"
                    aria-label={`${backgroundLabel}. Open details.`}
                    onClick={() => props.onDetailsOpenChange(true)}
                  >
                    <span className="chat-background-dot" aria-hidden="true" />
                    <span className="chat-background-label">
                      {backgroundLabel}
                    </span>
                  </button>
                </div>
              ) : null}

              {openHandoffs.length > 0 || handoffError ? (
                <div className="chat-inline-handoff">
                  {handoffError ? (
                    <div className="handoff-error-banner" role="alert">
                      {handoffError}
                      <button
                        className="text-button"
                        type="button"
                        onClick={() => setHandoffError(undefined)}
                      >
                        Dismiss
                      </button>
                    </div>
                  ) : null}
                  {openHandoffs.map((handoff) => (
                    <HandoffCard
                      key={handoff.id}
                      handoff={handoff}
                      draft={handoffDrafts[handoff.id] ?? handoff.message}
                      busy={handoffBusy === handoff.id}
                      onChange={(value) =>
                        setHandoffDrafts((current) => ({
                          ...current,
                          [handoff.id]: value,
                        }))
                      }
                      onSend={() => void sendHandoff(handoff)}
                      onCancel={() => void cancelHandoff(handoff)}
                    />
                  ))}
                </div>
              ) : null}

              {handoffAbortNotice ? (
                <div className="handoff-notice" role="status">
                  <span>{handoffAbortNotice}</span>
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setHandoffAbortNotice("")}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              </section>
              {props.messageID && !messageBarDismissed ? (
                <div
                  className="chat-focus-bar"
                  ref={focusBarRef}
                  role="region"
                  aria-label="Focused message"
                >
                  <span className="chat-focus-text" role="status">
                    {focusedMessage
                      ? `Focused ${focusedMessage.role === "user" ? "message" : "agent message"} · ${formatTime(focusedMessage.createdAt)}`
                      : messageLookup === "loading"
                        ? "Loading message…"
                        : "Message is outside the loaded transcript."}
                  </span>
                  {focusedMessage && sessionProvider?.capabilities.fork ? (
                    <button
                      className="btn small primary"
                      type="button"
                      disabled={forkingMessageID === focusedMessage.id}
                      onClick={() => void forkFromMessage(focusedMessage)}
                    >
                      {forkingMessageID === focusedMessage.id
                        ? "Forking…"
                        : "Fork from here"}
                    </button>
                  ) : messageLookup === "missing" && olderCursor ? (
                    <button
                      className="text-button"
                      type="button"
                      onClick={() => {
                        lookupMessageRef.current = undefined;
                        void loadOlder();
                      }}
                    >
                      Load older
                    </button>
                  ) : null}
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => setMessageBarDismissed(true)}
                  >
                    Dismiss
                  </button>
                </div>
              ) : null}
              <div
                className="chat-jump-band"
                data-visible={showJump}
                hidden={!scrollable}
                style={{ bottom: focusBarHeight }}
              >
                <button
                  className="chat-jump-float"
                  type="button"
                  data-visible={showJump}
                  aria-hidden={showJump ? undefined : true}
                  tabIndex={showJump ? 0 : -1}
                  inert={!showJump}
                  onClick={jumpToLatest}
                >
                  {hasBlockingAttention ? "Input needed" : "Jump to latest"}
                  <Icon name="arrow-down" size={14} />
                </button>
              </div>
            </div>

            {sendError ? (
              <div className="alert" role="alert">
                {sendError}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setSendError(undefined)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {dictation.phase === "error" ? (
              <div className="alert" role="alert">
                {dictation.message}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setDictation({ phase: "idle" })}
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {attachmentError ? (
              <div className="alert" role="alert">
                {attachmentError}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setAttachmentError(undefined)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {branchError ? (
              <div className="alert" role="alert">
                {branchError}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setBranchError(undefined)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            {historyError ? (
              <div className="alert" role="alert">
                {historyError}
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setHistoryError(undefined)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}

            <div className="chat-composer-wrap">
              <span className="sr-only" role="status" aria-live="polite">
                {handoffNotice}
              </span>
              <span className="sr-only" role="status" aria-live="polite">
                {queuedItems.length > 0
                  ? `${queuedItems.length} queued message${
                      queuedItems.length === 1 ? "" : "s"
                    }`
                  : ""}
              </span>
              {!online ? (
                <p className="composer-offline-note" role="status">
                  Offline · sends will be queued.
                </p>
              ) : null}
              {queuedItems.length > 0 ? (
                <div
                  className="composer-queued"
                  role="region"
                  aria-label="Queued messages"
                >
                  <button
                    className="composer-queued-summary"
                    type="button"
                    aria-expanded={queuedOpen}
                    aria-controls="composer-queued-list"
                    onClick={() => setQueuedOpen((open) => !open)}
                  >
                    <span className="composer-queued-label">Queued</span>
                    <span className="composer-queued-count">
                      {queuedItems.length}
                    </span>
                    {!queuedOpen ? (
                      <span className="composer-queued-preview">
                        {queuedItems[0]?.text}
                      </span>
                    ) : null}
                    <Icon
                      name="chevron-right"
                      size={14}
                      className="composer-queued-chevron"
                    />
                  </button>
                  {inboxError ? (
                    <div className="composer-queued-error" role="status">
                      {inboxError}
                    </div>
                  ) : null}
                  {queuedOpen ? (
                    <div
                      className="composer-queued-list"
                      id="composer-queued-list"
                    >
                      {queuedItems.map((item) => (
                        <div className="composer-queued-item" key={item.id}>
                          <span className="composer-queued-text">{item.text}</span>
                          <div className="composer-queued-actions">
                            {running ? (
                              <button
                                type="button"
                                disabled={inboxBusy === item.id}
                                onClick={() => void promoteQueued(item)}
                              >
                                Send now
                              </button>
                            ) : null}
                            <button
                              className="composer-queued-remove"
                              type="button"
                              aria-label="Remove queued message"
                              disabled={inboxBusy === item.id}
                              onClick={() => void removeQueued(item)}
                            >
                              <Icon name="x" size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {stagedHistory ? (
                <div
                  className="composer-history"
                  role="group"
                  aria-label="Undo staged"
                >
                  <span className="sr-only" role="status" aria-live="polite">
                    {history?.mode === "revert"
                      ? "Last turn undone."
                      : "Last turn hidden."}
                    {historyNotice ? ` ${historyNotice}` : ""}
                  </span>
                  <div className="composer-history-head">
                    <span className="composer-history-title">Undo staged</span>
                    <span className="composer-history-detail">
                      {history?.mode === "revert"
                        ? stagedFiles.length === 0
                          ? "No files changed"
                          : stagedHistory.filesRestored
                            ? `${stagedFiles.length} file${
                                stagedFiles.length === 1 ? "" : "s"
                              } restored`
                            : `${stagedFiles.length} file${
                                stagedFiles.length === 1 ? "" : "s"
                              } changed, not restored`
                        : "Last turn hidden"}
                    </span>
                    <div className="composer-history-buttons">
                      <button
                        className="composer-history-action"
                        type="button"
                        disabled={running || historyBusy === "redo"}
                        title={
                          running
                            ? "Redo waits for the current run to finish"
                            : "Restore the undone turn"
                        }
                        onClick={() => void redoLastTurn()}
                      >
                        {historyBusy === "redo" ? "Restoring…" : "Redo"}
                      </button>
                      {restoreFilesSupported &&
                      history?.mode === "revert" &&
                      stagedFiles.length > 0 &&
                      !stagedHistory.filesRestored ? (
                        <button
                          ref={historyRestoreRef}
                          className="composer-history-action danger"
                          type="button"
                          disabled={historyRestoring || running}
                          onClick={() => setHistoryConfirmOpen(true)}
                        >
                          Restore files
                        </button>
                      ) : null}
                      {history?.prompt &&
                      (history.prompt.text !== draft ||
                        history.prompt.attachments.length > 0) ? (
                        <button
                          className="composer-history-action"
                          type="button"
                          aria-expanded={historyPromptOpen}
                          onClick={() => setHistoryPromptOpen((open) => !open)}
                        >
                          {historyPromptOpen ? "Hide prompt" : "Show prompt"}
                        </button>
                      ) : null}
                      {stagedFiles.length > 0 ? (
                        <button
                          className="composer-history-action"
                          type="button"
                          aria-expanded={historyFilesOpen}
                          onClick={() => setHistoryFilesOpen((open) => !open)}
                        >
                          {historyFilesOpen ? "Hide files" : "Show files"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {historyConfirmOpen ? (
                    <div
                      className="composer-history-confirm"
                      role="group"
                      aria-label="Restore files"
                    >
                      <p>
                        Restore {stagedFiles.length} file
                        {stagedFiles.length === 1 ? "" : "s"} to their state
                        before this turn? Current edits to these paths may be
                        overwritten. Redo restores the conversation and files to
                        how they were when you undid the turn.
                      </p>
                      <div className="composer-history-buttons">
                        <button
                          className="composer-history-action"
                          type="button"
                          autoFocus
                          disabled={historyRestoring}
                          onClick={cancelHistoryConfirm}
                        >
                          Cancel
                        </button>
                        <button
                          className="composer-history-action danger"
                          type="button"
                          disabled={historyRestoring}
                          onClick={() => void restoreHistoryFiles()}
                        >
                          {historyRestoring ? "Restoring…" : "Restore files"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {historyPromptOpen && history?.prompt ? (
                    <div className="composer-history-prompt">
                      <p>
                        {history.prompt.text || "This turn had no text."}
                      </p>
                      {history.prompt.attachments.length > 0 ? (
                        <p className="composer-history-attachments">
                          Attachments: {history.prompt.attachments.join(", ")}
                        </p>
                      ) : null}
                      <button
                        className="composer-history-action"
                        type="button"
                        onClick={() => {
                          updateDraft(history.prompt?.text ?? "");
                          setHistoryNotice("Prompt inserted.");
                        }}
                      >
                        Insert prompt
                      </button>
                    </div>
                  ) : null}
                  {historyFilesOpen && stagedFiles.length > 0 ? (
                    <ul className="composer-history-files">
                      {stagedFiles.map((file) => (
                        <li key={file.path}>
                          <span className="composer-history-file-path">
                            {file.path}
                          </span>
                          <span
                            className={`composer-history-file-status ${file.status}`}
                          >
                            {file.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {historyNotice ? (
                    <p className="composer-history-note">{historyNotice}</p>
                  ) : null}
                </div>
              ) : historyNotice ? (
                <p className="composer-history-notice" role="status">
                  {historyNotice}
                </p>
              ) : null}
              <form
                className="chat-composer"
                onPaste={pasteAttachments}
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                {attachSupported ? (
                  <input
                    ref={attachmentInputRef}
                    id="chat-attachment-input"
                    name="attachment"
                    type="file"
                    multiple
                    hidden
                    accept="image/png,image/jpeg,image/gif,image/webp,image/avif,application/pdf,application/json,text/plain,text/markdown,text/csv"
                    onChange={(event) =>
                      void uploadAttachments(event.currentTarget.files)
                    }
                  />
                ) : null}
                {attachments.length > 0 ? (
                  <div className="composer-attachments">
                    {attachments.map((attachment) => (
                      <div className="composer-attachment" key={attachment.id}>
                        <span className="composer-attachment-name">
                          {attachment.name}
                        </span>
                        <span className="composer-attachment-size">
                          {formatBytes(attachment.size)}
                        </span>
                        <button
                          className="composer-attachment-remove"
                          type="button"
                          aria-label={`Remove ${attachment.name}`}
                          onClick={() => void removeAttachment(attachment.id)}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {suggestState !== "idle" || suggestions.length > 0 ? (
                  <div className="composer-suggest" aria-live="polite">
                    <div className="composer-suggest-head">
                      <span className="composer-suggest-label">Suggested</span>
                      {suggestState === "loading" ? (
                        <span className="composer-suggest-status">
                          Reading session…
                        </span>
                      ) : null}
                      {suggestState === "error" ? (
                        <span className="composer-suggest-status error">
                          {suggestError}
                        </span>
                      ) : null}
                      {suggestions.length > 0 ? (
                        <button
                          className="composer-suggest-dismiss"
                          type="button"
                          aria-label="Dismiss suggestions"
                          onClick={dismissSuggestions}
                        >
                          <Icon name="x" size={14} />
                        </button>
                      ) : null}
                    </div>
                    {suggestions.length > 0 ? (
                      <div className="composer-suggest-list">
                        {suggestions.map((option) => (
                          <button
                            className="composer-suggest-chip"
                            type="button"
                            key={option.id}
                            aria-label={`Use suggestion: ${option.text}`}
                            onClick={() => insertSuggestion(option)}
                          >
                            <span>{option.text}</span>
                            {roleTag(option.role) ? (
                              <span className="composer-suggest-tag">
                                {roleTag(option.role)}
                              </span>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {suggestState === "error" ? (
                      <button
                        className="composer-suggest-retry"
                        type="button"
                        onClick={() => void suggestReplies()}
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <textarea
                  ref={composerInputRef}
                  id="chat-composer-input"
                  name="message"
                  rows={1}
                  value={draft}
                  aria-label={`Reply to ${session.title}`}
                  aria-describedby="chat-composer-hint"
                  placeholder="Reply…"
                  onChange={(event) =>
                    updateDraft((event.currentTarget as HTMLTextAreaElement).value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                />
                {dictation.phase === "starting" ||
                dictation.phase === "recording" ||
                dictation.phase === "transcribing" ? (
                  <>
                    <span className="sr-only" role="status" aria-live="polite">
                      {dictation.phase === "starting"
                        ? "Starting dictation"
                        : dictation.phase === "recording"
                          ? "Recording"
                          : "Transcribing"}
                    </span>
                    <div className="composer-dictation">
                      <span
                        className="composer-dictation-dot"
                        aria-hidden="true"
                      />
                      <span>
                        {dictation.phase === "starting"
                          ? "Starting dictation…"
                          : dictation.phase === "recording"
                            ? "Recording"
                            : "Transcribing…"}
                      </span>
                      {dictation.phase === "recording" ? (
                        <span
                          className="composer-dictation-time"
                          aria-hidden="true"
                        >
                          {formatDictationDuration(dictationElapsedMs)}
                        </span>
                      ) : null}
                    </div>
                  </>
                ) : null}
                <div className={`chat-composer-bar ${running ? "running" : ""}`}>
                  {undoAvailable ? (
                    <button
                      className="composer-history-action composer-desktop-tool"
                      type="button"
                      aria-label="Undo last turn"
                      title={
                        undoDisabledReason ??
                        "Undo the last turn and return its prompt"
                      }
                      disabled={
                        running || sending || historyBusy === "undo"
                      }
                      onClick={() => void undoLastTurn()}
                    >
                      {historyBusy === "undo" ? "Undoing…" : "Undo"}
                    </button>
                  ) : null}
                  {showSelection ? (
                    <button
                      ref={contextChipRef}
                      className={`composer-context-chip ${selectionError ? "error" : ""}`}
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={contextOpen}
                      aria-controls="composer-context-sheet"
                      aria-label={`Model and agent: ${contextChipTitle || contextChipLabel}`}
                      title={contextChipTitle || undefined}
                      onClick={() => {
                        setToolsOpen(false);
                        setContextOpen(true);
                      }}
                    >
                      <span className="composer-context-label">
                        {contextChipLabel}
                      </span>
                      <Icon
                        name="chevron-right"
                        size={12}
                        className="composer-context-chevron"
                      />
                    </button>
                  ) : null}
                  {showSelection ? (
                    <div
                      className="composer-options"
                      title={
                        session.status === "running"
                          ? "Wait for the current run to finish"
                          : undefined
                      }
                    >
                      {renderSelection("inline")}
                    </div>
                  ) : null}
                  <span
                    id="chat-composer-hint"
                    className={`composer-hint ${draftStatus === "error" ? "error" : ""}`}
                  >
                    {composerHint}
                  </span>
                  <div className="composer-actions">
                    {suggestEnabled ? (
                      <button
                        className="composer-voice"
                        type="button"
                        disabled={
                          suggestState === "loading" ||
                          dictationBusy ||
                          sending
                        }
                        onClick={runSuggest}
                      >
                        {suggestState === "loading" ? "Reading…" : "Suggest"}
                      </button>
                    ) : null}
                    {attachSupported && !attachInTools ? (
                      <button
                        className="composer-voice composer-attach"
                        type="button"
                        disabled={uploadingAttachments > 0}
                        onClick={() => attachmentInputRef.current?.click()}
                      >
                        {uploadingAttachments > 0 ? "Uploading…" : "Attach"}
                      </button>
                    ) : null}
                    {dictationSupported ? (
                      <button
                        className={`composer-voice composer-desktop-tool ${dictation.phase === "recording" ? "recording" : ""}`}
                        type="button"
                        disabled={
                          dictation.phase === "starting" ||
                          dictation.phase === "transcribing"
                        }
                        aria-pressed={dictation.phase === "recording"}
                        aria-label={
                          dictation.phase === "recording"
                            ? "Stop dictation"
                            : dictation.phase === "transcribing"
                              ? "Transcribing"
                              : "Start dictation"
                        }
                        onClick={toggleDictation}
                      >
                        {dictation.phase === "starting"
                          ? "Starting…"
                          : dictation.phase === "recording"
                            ? "Stop"
                            : dictation.phase === "transcribing"
                              ? "Transcribing…"
                              : "Dictate"}
                      </button>
                    ) : null}
                    {hasComposerTools ? (
                      <div className="composer-tools" ref={toolsRef}>
                        <button
                          ref={toolsToggleRef}
                          className="composer-voice composer-tools-toggle"
                          type="button"
                          aria-label="More composer actions"
                          aria-expanded={toolsOpen}
                          aria-controls="composer-tools-menu"
                          onClick={() => setToolsOpen((open) => !open)}
                        >
                          <Icon name="ellipsis" size={16} />
                        </button>
                        {toolsOpen ? (
                          <div
                            className="composer-tools-menu"
                            id="composer-tools-menu"
                            role="group"
                            aria-label="Composer tools"
                          >
                            {undoAvailable ? (
                              <>
                                <button
                                  type="button"
                                  title={undoDisabledReason}
                                  disabled={
                                    running || sending || historyBusy === "undo"
                                  }
                                  onClick={() => void undoLastTurn()}
                                >
                                  {historyBusy === "undo"
                                    ? "Undoing…"
                                    : "Undo last turn"}
                                </button>
                                {undoDisabledReason ? (
                                  <span className="composer-tools-note">
                                    {undoDisabledReason}
                                  </span>
                                ) : null}
                              </>
                            ) : null}
                            {running && canSteer && canQueue ? (
                              <button
                                type="button"
                                disabled={
                                  sending ||
                                  (!draft.trim() && attachments.length === 0) ||
                                  dictationBusy ||
                                  uploadingAttachments > 0
                                }
                                onClick={() => void send("queue")}
                              >
                                Queue
                              </button>
                            ) : null}
                            {attachInTools ? (
                              <button
                                type="button"
                                disabled={uploadingAttachments > 0}
                                onClick={() => {
                                  setToolsOpen(false);
                                  attachmentInputRef.current?.click();
                                }}
                              >
                                {uploadingAttachments > 0
                                  ? "Uploading…"
                                  : "Attach"}
                              </button>
                            ) : null}
                            {dictationSupported ? (
                              <button
                                type="button"
                                className={
                                  dictation.phase === "recording"
                                    ? "recording"
                                    : undefined
                                }
                                disabled={
                                  dictation.phase === "starting" ||
                                  dictation.phase === "transcribing"
                                }
                                aria-pressed={dictation.phase === "recording"}
                                onClick={toggleDictation}
                              >
                                {dictation.phase === "starting"
                                  ? "Starting…"
                                  : dictation.phase === "recording"
                                    ? "Stop dictation"
                                    : dictation.phase === "transcribing"
                                      ? "Transcribing…"
                                      : "Dictate"}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {running ? (
                      <button
                        className="btn small composer-interrupt"
                        type="button"
                        disabled={interrupting}
                        aria-label={
                          interrupting
                            ? "Interrupting"
                            : "Interrupt the running agent"
                        }
                        onClick={() => void interrupt()}
                      >
                        <span className="composer-interrupt-long">
                          {interrupting ? "Interrupting…" : "Interrupt"}
                        </span>
                        <span className="composer-interrupt-short">
                          {interrupting ? "Stopping…" : "Stop"}
                        </span>
                        <span
                          className="composer-stop-square"
                          aria-hidden="true"
                        />
                      </button>
                    ) : null}
                    {running && canSteer && canQueue ? (
                      <button
                        className="composer-voice composer-queue composer-desktop-tool"
                        type="button"
                        aria-label="Queue message for the running agent"
                        disabled={
                          sending ||
                          (!draft.trim() && attachments.length === 0) ||
                          dictationBusy ||
                          uploadingAttachments > 0
                        }
                        onClick={() => void send("queue")}
                      >
                        Queue
                      </button>
                    ) : null}
                    <button
                      className="btn primary small composer-send"
                      type="submit"
                      aria-label={
                        running && canSteer
                          ? "Steer the running agent"
                          : running && canQueue
                            ? "Queue message for the running agent"
                            : sending
                              ? "Sending message"
                              : "Send message"
                      }
                      disabled={
                        sending ||
                        (!draft.trim() && attachments.length === 0) ||
                        dictationBusy ||
                        uploadingAttachments > 0 ||
                        (running && !canSteer && !canQueue)
                      }
                    >
                      <span className="composer-send-label">
                        {running && canSteer
                          ? "Steer"
                          : running && canQueue
                            ? "Queue"
                            : sending
                              ? "Sending…"
                              : "Send"}
                      </span>
                      <Icon
                        name="arrow-up"
                        size={16}
                        className="composer-send-icon"
                      />
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </>
        ) : null}
      </div>

      {session && props.detailsOpen ? (
        <>
          <div
            className="chat-details-scrim"
            aria-hidden="true"
            onClick={() => props.onDetailsOpenChange(false)}
          />
          <SessionDetails
            client={props.client}
            session={session}
            provider={sessionProvider}
            markingRead={markingRead}
            interrupting={interrupting}
            background={backgroundItems}
            onClose={() => props.onDetailsOpenChange(false)}
            onMarkRead={() => void markRead()}
            onInterrupt={() => void interrupt()}
            onSessionUpdated={(next) => {
              setSession(next);
              writeSessionCache(next);
              props.onSessionChange(next);
            }}
            onOpenSession={props.onOpenSession}
          />
        </>
      ) : null}

      {previewPath && resource.sessionRef ? (
        <FilePreview
          path={previewPath}
          client={props.client}
          resource={resource}
          onClose={() => {
            setPreviewPath(undefined);
            props.onPreviewClose?.();
          }}
          onPreviewFile={(path) => setPreviewPath(path)}
        />
      ) : null}

      {contextOpen && showSelection ? (
        <>
          <div
            className="composer-sheet-scrim"
            aria-hidden="true"
            onClick={() => setContextOpen(false)}
          />
          <section
            ref={contextSheetRef}
            className="composer-sheet"
            id="composer-context-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="composer-context-title"
          >
            <header className="composer-sheet-head">
              <h2 className="composer-sheet-title" id="composer-context-title">
                Model &amp; agent
              </h2>
              <button
                ref={contextCloseRef}
                className="icon-btn"
                type="button"
                aria-label="Close model and agent"
                onClick={() => setContextOpen(false)}
              >
                <Icon name="x" size={16} />
              </button>
            </header>
            <div className="composer-sheet-body">
              {renderSelection("sheet")}
            </div>
            <footer className="composer-sheet-foot">
              <span className="composer-sheet-note">
                {running
                  ? "Changes wait for the current run to finish."
                  : "Applies to this session."}
              </span>
              <button
                className="btn small"
                type="button"
                onClick={() => setContextOpen(false)}
              >
                Done
              </button>
            </footer>
          </section>
        </>
      ) : null}
    </div>
  );
}

interface BackgroundItem {
  key: string;
  kind: "shell" | "subagent";
  label: string;
  detail: string;
  status: "running";
  meta: string;
  childRef?: string;
}

type TranscriptItem =
  | { kind: "message"; message: Message }
  | { kind: "activity"; messages: Message[]; key: string; steps: ActivityStep[] }
  | { kind: "compaction"; message: Message; key: string }
  | { kind: "shell"; message: Message; key: string }
  | { kind: "handoff"; handoff: Handoff; key: string }
  | { kind: "date"; at: number; key: string };

function transcriptItemAt(item: TranscriptItem): number {
  switch (item.kind) {
    case "date":
      return item.at;
    case "message":
      return item.message.createdAt;
    case "activity":
      return item.messages[0]?.createdAt ?? 0;
    case "compaction":
    case "shell":
      return item.message.createdAt;
    case "handoff":
      return item.handoff.sentAt ?? item.handoff.updatedAt ?? item.handoff.createdAt;
  }
}

/**
 * Merge sent handoff receipts into the transcript by time.
 *
 * The provider transcript stays authoritative; a hub-owned receipt sits where
 * its send happened. Pending and failed handoffs are not merged: they stay at
 * the end as actionable cards. Date separators are rebuilt so a receipt on a
 * day with no provider message still gets one.
 */
function mergeHandoffs(
  items: TranscriptItem[],
  handoffs: Handoff[],
): TranscriptItem[] {
  if (handoffs.length === 0) return items;
  const entries: Array<{ at: number; item: TranscriptItem; order: number }> = [];
  items.forEach((item, index) => {
    if (item.kind === "date") return;
    entries.push({ at: transcriptItemAt(item), item, order: index });
  });
  handoffs.forEach((handoff, index) => {
    entries.push({
      at: handoff.sentAt ?? handoff.updatedAt ?? handoff.createdAt,
      item: { kind: "handoff", handoff, key: `handoff:${handoff.id}` },
      order: items.length + index,
    });
  });
  entries.sort((left, right) => left.at - right.at || left.order - right.order);
  const merged: TranscriptItem[] = [];
  let lastDay = "";
  for (const entry of entries) {
    const day = new Date(entry.at).toDateString();
    if (day !== lastDay) {
      merged.push({ kind: "date", at: entry.at, key: `date:${day}` });
      lastDay = day;
    }
    merged.push(entry.item);
  }
  return merged;
}

function groupTranscript(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let activity: Message[] = [];
  let lastDay = "";
  const push = (item: TranscriptItem, at: number) => {
    const day = new Date(at).toDateString();
    if (day !== lastDay) {
      items.push({ kind: "date", at, key: `date:${day}` });
      lastDay = day;
    }
    items.push(item);
  };
  const flush = () => {
    if (activity.length === 0) return;
    push(
      {
        kind: "activity",
        messages: activity,
        steps: stepsFromMessages(activity),
        // Keep the disclosure mounted while new activity appends to the group.
        // Including the last message ID remounts and collapses it on every update.
        key: `activity:${activity[0]!.id}`,
      },
      activity[0]!.createdAt,
    );
    activity = [];
  };
  for (const message of messages) {
    if (compactionPart(message)) {
      flush();
      push({ kind: "compaction", message, key: `compaction:${message.id}` }, message.createdAt);
    } else if (shellPart(message)) {
      flush();
      push({ kind: "shell", message, key: `shell:${message.id}` }, message.createdAt);
    } else if (isActivityMessage(message)) {
      activity.push(message);
    } else {
      flush();
      push({ kind: "message", message }, message.createdAt);
    }
  }
  flush();
  return items;
}

function isActivityMessage(message: Message): boolean {
  return (
    message.role === "assistant" &&
    !message.metadata?.error &&
    message.parts.length > 0 &&
    message.parts.every((part) => {
      if (part.type === "tool" && answeredQuestions(part)) return false;
      return (
        part.type === "reasoning" ||
        part.type === "tool" ||
        part.type === "unknown"
      );
    })
  );
}

function CopyMessageButton(props: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const reset = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2_000);
  };

  const copy = async () => {
    const copied = await copyTextToClipboard(props.text);
    setState(copied ? "copied" : "error");
    reset();
  };

  return (
    <>
      <button
        className="message-action"
        type="button"
        data-copied={state === "copied" ? "true" : undefined}
        onClick={() => void copy()}
      >
        {state === "copied"
          ? "Copied"
          : state === "error"
            ? "Copy failed"
            : "Copy"}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {state === "copied"
          ? "Copied to clipboard"
          : state === "error"
            ? "Copy failed"
            : ""}
      </span>
    </>
  );
}

function BranchPicker(props: {
  point: BranchPoint;
  busy: boolean;
  onSwitch: (siblingId: string) => void;
}) {
  const { point } = props;
  return (
    <div
      className="message-branch"
      role="group"
      aria-label={`Response ${point.index + 1} of ${point.count}`}
    >
      <button
        className="message-branch-button"
        type="button"
        aria-label="Previous response"
        disabled={props.busy || point.index <= 0}
        onClick={() => {
          const sibling = point.siblingIds[point.index - 1];
          if (sibling) props.onSwitch(sibling);
        }}
      >
        <Icon name="chevron-left" size={16} />
      </button>
      <span className="message-branch-count" aria-hidden="true">
        {point.index + 1} / {point.count}
      </span>
      <span className="sr-only">
        Response {point.index + 1} of {point.count}
      </span>
      <button
        className="message-branch-button"
        type="button"
        aria-label="Next response"
        disabled={props.busy || point.index >= point.count - 1}
        onClick={() => {
          const sibling = point.siblingIds[point.index + 1];
          if (sibling) props.onSwitch(sibling);
        }}
      >
        <Icon name="chevron-right" size={16} />
      </button>
    </div>
  );
}

function TranscriptMessage(props: {
  message: Message;
  focused?: boolean;
  client: HubClient;
  resource: ResourceContext;
  branchPoint?: BranchPoint;
  branchBusy?: boolean;
  onSwitchBranch?: (point: BranchPoint, siblingId: string) => void;
  canRetry?: boolean;
  retryBusy?: boolean;
  onRetry?: (messageId: string) => void;
  onRetryOptimistic?: (message: Message) => void;
  onDiscardOptimistic?: (message: Message) => void;
  canContinue?: boolean;
  continueBusy?: boolean;
  onContinue?: (messageId: string) => void;
  canEdit?: boolean;
  onEdit?: (message: Message) => void;
  editing?: boolean;
  editText?: string;
  editBusy?: boolean;
  editError?: string;
  editDraftStatus?: string;
  onEditTextChange?: (value: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  suppressError?: boolean;
  onPreviewFile?: (path: string) => void;
  onOpenSession?: (ref: string) => void;
  onStepOpenChange?: (open: boolean) => void;
  subagentStatus?: Record<string, Session["status"] | "unknown">;
}) {
  const message = props.message;
  // Keep the provider's part order. A final answer is normally emitted after
  // its reasoning and tools, so moving every step to the bottom put the
  // reasoning below the answer it produced.
  const segments = useMemo(
    () => messageSegments(message.parts),
    [message.parts],
  );
  const send = optimisticSend(message);
  const copyText =
    message.role === "assistant" && !message.streaming
      ? messageCopyText(message)
      : "";
  const editCopy = message.role === "user" ? messageCopyText(message) : "";
  const showEdit = Boolean(props.canEdit && editCopy && !send && !props.editing);
  return (
    <article
      id={`message-${message.id}`}
      className={`chat-message ${message.role}${props.focused ? " is-focused" : ""}`}
    >
      <div className="chat-message-role">
        <span>{message.role === "user" ? "You" : "Agent"}</span>
        <time dateTime={new Date(message.createdAt).toISOString()}>
          {formatTime(message.createdAt)}
        </time>
        {message.streaming ? <span className="streaming-label">streaming</span> : null}
      </div>
      <div className="chat-message-parts">
        {props.editing ? (
          <div className="message-edit">
            <textarea
              aria-label="Edit message"
              value={props.editText ?? ""}
              onChange={(event) => props.onEditTextChange?.(event.currentTarget.value)}
              rows={4}
              autoFocus
              disabled={props.editBusy}
            />
            <p className="message-edit-note">
              Saves to a new forked session. Attachments are not carried over.
            </p>
            {props.editDraftStatus ? (
              <p className="form-note" role="status">
                {props.editDraftStatus}
              </p>
            ) : null}
            {props.editError ? (
              <div className="form-error" role="alert">
                {props.editError}
              </div>
            ) : null}
            <div className="message-edit-actions">
              <button
                className="btn small"
                type="button"
                disabled={props.editBusy}
                onClick={props.onCancelEdit}
              >
                Cancel
              </button>
              <button
                className="btn primary small"
                type="button"
                disabled={props.editBusy || !props.editText?.trim()}
                onClick={props.onSaveEdit}
              >
                {props.editBusy ? "Forking…" : "Save & fork"}
              </button>
            </div>
          </div>
        ) : (
          <>
            {message.metadata?.error && !props.suppressError ? (
              <div className="message-error" role="alert">
                <span className="message-error-label">Provider error</span>
                <p>{providerErrorMessage(message.metadata.error)}</p>
                <div className="message-error-actions">
                  {props.canRetry ? (
                    <button
                      className="btn small"
                      type="button"
                      disabled={props.retryBusy}
                      onClick={() => props.onRetry?.(message.id)}
                    >
                      {props.retryBusy ? "Retrying…" : "Retry turn"}
                    </button>
                  ) : null}
                  {props.canContinue ? (
                    <button
                      className="btn small secondary"
                      type="button"
                      disabled={props.continueBusy}
                      onClick={() => props.onContinue?.(message.id)}
                    >
                      {props.continueBusy ? "Sending…" : "Continue"}
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            {message.parts.length === 0 && !message.metadata?.error ? (
              <div className="message-empty">No content</div>
            ) : message.parts.length === 0 && props.suppressError ? (
              <div className="message-empty">Provider error reported below.</div>
            ) : (
              <>
                {segments.map((segment, segmentIndex) =>
                  segment.kind === "content" ? (
                    segment.parts.map((part, index) => (
                      <MessagePartView
                        part={part}
                        key={`content:${segmentIndex}:${index}`}
                        client={props.client}
                        resource={props.resource}
                        onPreviewFile={props.onPreviewFile}
                      />
                    ))
                  ) : (
                    <ActivityTiles
                      key={`steps:${segment.start}`}
                      steps={stepsFromParts(
                        segment.parts,
                        `${message.id}:${segment.start}:`,
                      )}
                      client={props.client}
                      resource={props.resource}
                      onPreviewFile={props.onPreviewFile}
                      onOpenSession={props.onOpenSession}
                      onStepOpenChange={props.onStepOpenChange}
                      subagentStatus={props.subagentStatus}
                      header={{ label: "Agent activity" }}
                    />
                  ),
                )}
              </>
            )}
          </>
        )}
      </div>
      {send?.status === "queued" ? (
        <div className="message-send-state queued" role="status">
          <span>Queued. Sends when the hub is reachable.</span>
          <div className="message-send-actions">
            <button
              className="message-action"
              type="button"
              onClick={() => props.onDiscardOptimistic?.(message)}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
      {send?.status === "sending" ? (
        <div className="message-send-state" role="status">
          <span>Sending…</span>
        </div>
      ) : null}
      {send?.status === "failed" ? (
        <div className="message-send-state error" role="alert">
          <span>Not sent. {send.error}</span>
          <div className="message-send-actions">
            <button
              className="message-action"
              type="button"
              onClick={() => props.onRetryOptimistic?.(message)}
            >
              Retry
            </button>
            <button
              className="message-action"
              type="button"
              onClick={() => props.onDiscardOptimistic?.(message)}
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
      {!props.editing && (copyText || props.branchPoint || props.canRetry || showEdit) ? (
        <div className="chat-message-actions">
          <div className="chat-message-actions-left">
            {props.branchPoint && props.onSwitchBranch ? (
              <BranchPicker
                point={props.branchPoint}
                busy={Boolean(props.branchBusy)}
                onSwitch={(siblingId) =>
                  props.onSwitchBranch?.(props.branchPoint!, siblingId)
                }
              />
            ) : null}
          </div>
          <div className="chat-message-actions-right">
            {showEdit ? (
              <button
                className="message-action"
                type="button"
                aria-label="Edit message and fork the session"
                onClick={() => props.onEdit?.(message)}
              >
                Edit & fork
              </button>
            ) : null}
            {props.canRetry && copyText ? (
              <button
                className="message-action"
                type="button"
                disabled={props.retryBusy}
                onClick={() => props.onRetry?.(message.id)}
              >
                {props.retryBusy ? "Retrying…" : "Retry"}
              </button>
            ) : null}
            {copyText ? <CopyMessageButton text={copyText} /> : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function stepStatusLabel(status: StepStatus): string {
  return status === "error" ? "error" : status === "running" ? "running" : "completed";
}

/** Short role tag for a suggestion chip, or undefined for the primary answer. */
function roleTag(role: ReplyOption["role"]): string | undefined {
  switch (role) {
    case "opposite":
      return "Alt";
    case "next":
      return "Next";
    case "verify":
      return "Check";
    case "extend":
      return "More";
    case "ask":
      return "Ask";
    default:
      return undefined;
  }
}

function inputText(input: unknown, keys: string[]): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") return value;
  }
  return undefined;
}

function stepSubtitle(step: ActivityStep): string {
  const part = step.part;
  if (part.type === "reasoning") {
    return `${part.text.length.toLocaleString()} characters`;
  }
  const metadata = part.metadata ?? {};
  switch (step.kind) {
    case "shell":
      return inputText(part.input, ["command"]) ?? "";
    case "execute":
      return inputText(part.input, ["language"]) ?? "code";
    case "read":
    case "write":
      return inputText(part.input, ["filePath", "path"]) ?? "";
    case "search":
      return inputText(part.input, ["pattern", "query"]) ?? "";
    case "fetch":
      return inputText(part.input, ["url"]) ?? "";
    case "subagent": {
      const agent = inputText(part.input, ["agent", "description"]) ?? "";
      const sessionID =
        typeof metadata.sessionID === "string" ? metadata.sessionID : "";
      return [agent, sessionID].filter(Boolean).join(" · ");
    }
    case "image":
      return inputText(part.input, ["filePath", "path"]) ?? "";
    default:
      return step.metric ?? "";
  }
}

/**
 * Agent activity as a wrapping tile grid.
 *
 * Every step is a thumb-size button. Selecting one opens the step inline, on
 * its own line under the row of the selected tile, like a disclosure - never a
 * modal. The grid height is the only cost; the transcript keeps scrolling.
 */
/**
 * The chat's adapter for the shared activity grid.
 *
 * Provider parts are resolved here - subagent status comes from the session
 * list - and then handed to the one renderer as the common view model.
 */
function ActivityTiles(props: {
  steps: ActivityStep[];
  client: HubClient;
  resource: ResourceContext;
  onPreviewFile?: (path: string) => void;
  onOpenSession?: (ref: string) => void;
  onStepOpenChange?: (open: boolean) => void;
  subagentStatus?: Record<string, Session["status"] | "unknown">;
  header?: { label: string; at?: number };
}) {
  const resolved = useMemo(
    () =>
      props.steps.map((step) => {
        if (step.kind !== "subagent" || step.part.type !== "tool") return step;
        const ref = subagentRef(step.part, props.resource.providerID);
        const status = ref ? props.subagentStatus?.[ref] : undefined;
        return {
          ...step,
          status:
            status === "running"
              ? ("running" as const)
              : status === "error"
                ? ("error" as const)
                : ("completed" as const),
        };
      }),
    [props.steps, props.subagentStatus, props.resource.providerID],
  );
  const items = useMemo(() => itemsFromChatSteps(resolved), [resolved]);

  return (
    <ActivityGrid
      items={items}
      label={props.header?.label ?? "Steps"}
      {...(props.header?.at !== undefined
        ? { time: formatTime(props.header.at) }
        : {})}
      {...(props.onStepOpenChange
        ? { onStepOpenChange: props.onStepOpenChange }
        : {})}
      renderDetail={({ item, index, total, onClose, onPrev, onNext }) => (
        <StepPanel
          step={item.data!}
          index={index}
          total={total}
          client={props.client}
          resource={props.resource}
          {...(props.onPreviewFile ? { onPreviewFile: props.onPreviewFile } : {})}
          {...(props.onOpenSession ? { onOpenSession: props.onOpenSession } : {})}
          onClose={onClose}
          onPrev={() => onPrev?.()}
          onNext={() => onNext?.()}
        />
      )}
    />
  );
}

function StepPanel(props: {
  step: ActivityStep;
  index: number;
  total: number;
  client: HubClient;
  resource: ResourceContext;
  onPreviewFile?: (path: string) => void;
  onOpenSession?: (ref: string) => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Let the transcript finish its own anchoring pass, then bring the step
    // fully into view.
    const timer = window.setTimeout(() => {
      ref.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [props.step.key]);

  return (
    <section
      className="activity-step"
      aria-label={`${props.step.label} step`}
      ref={ref}
    >
      <header className="activity-step-head">
        <span className={`tool-status ${props.step.status}`}>
          {stepStatusLabel(props.step.status)}
        </span>
        <span className="activity-step-title">{props.step.label}</span>
        <span className="activity-step-subtitle">{stepSubtitle(props.step)}</span>
        {props.step.startedAt !== undefined ? (
          <time
            className="activity-step-time"
            dateTime={new Date(props.step.startedAt).toISOString()}
          >
            {formatTime(props.step.startedAt)}
          </time>
        ) : null}
        <button
          className="icon-btn activity-step-close"
          type="button"
          aria-label="Close step"
          onClick={props.onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </header>
      <div className="activity-step-body">
        <StepBody
          step={props.step}
          client={props.client}
          resource={props.resource}
          onPreviewFile={props.onPreviewFile}
          onOpenSession={props.onOpenSession}
        />
      </div>
      <footer className="activity-step-foot">
        <span className="activity-step-hint">
          Arrow keys move between tiles · Esc closes
        </span>
        <span className="activity-step-nav">
          <button
            className="btn small"
            type="button"
            disabled={props.index === 0}
            onClick={props.onPrev}
          >
            Previous
          </button>
          <button
            className="btn small"
            type="button"
            disabled={props.index === props.total - 1}
            onClick={props.onNext}
          >
            Next
          </button>
        </span>
      </footer>
    </section>
  );
}

function StepBlock(props: { label: string; aside?: string; children: ReactNode }) {
  return (
    <div className="activity-block">
      <span className="activity-block-label">
        {props.label}
        {props.aside ? <span className="activity-block-aside">{props.aside}</span> : null}
      </span>
      {props.children}
    </div>
  );
}

function StepOutputImages(props: {
  output: unknown;
  client: HubClient;
  resource: ResourceContext;
}) {
  const images = collectToolImages(props.output);
  if (images.length === 0) return null;
  return (
    <div className="activity-step-images">
      {images.map((image, index) => {
        const resolved = resolveSessionResource(image.url, props.resource, "image");
        return (
          <figure className="message-attachment" key={`${image.url.slice(0, 48)}-${index}`}>
            <AttachmentImage
              client={props.client}
              providerID={props.resource.providerID}
              url={resolved.url ?? image.url}
              viaProxy={resolved.attachment}
              name={image.name}
            />
            <figcaption>
              <span className="message-file-name">{image.name}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function StepBody(props: {
  step: ActivityStep;
  client: HubClient;
  resource: ResourceContext;
  onPreviewFile?: (path: string) => void;
  onOpenSession?: (ref: string) => void;
}) {
  const { step } = props;
  const part = step.part;

  if (part.type === "reasoning") {
    return (
      <div className="activity-step-markdown">
        <Markdown
          text={part.text}
          client={props.client}
          resource={props.resource}
          headingOffset={1}
          onPreviewFile={props.onPreviewFile}
        />
      </div>
    );
  }

  const metadata = part.metadata ?? {};
  const outputText = toolOutputText(part.output);

  switch (step.kind) {
    case "shell": {
      const command = inputText(part.input, ["command"]);
      const exit = typeof metadata.exit === "number" ? metadata.exit : undefined;
      return (
        <>
          {command ? (
            <StepBlock label="Command">
              <pre className="activity-code">{`$ ${command}`}</pre>
            </StepBlock>
          ) : null}
          {outputText ? (
            <StepBlock
              label="Output"
              aside={exit !== undefined ? `exit ${exit}` : undefined}
            >
              <pre className="activity-code">{outputText}</pre>
            </StepBlock>
          ) : null}
        </>
      );
    }
    case "execute": {
      const code = inputText(part.input, ["code"]);
      const language = inputText(part.input, ["language"]);
      return (
        <>
          {code ? (
            <StepBlock label="Code" aside={language}>
              <pre className="activity-code">{code}</pre>
            </StepBlock>
          ) : null}
          {outputText ? (
            <StepBlock label="Output">
              <pre className="activity-code">{outputText}</pre>
            </StepBlock>
          ) : null}
        </>
      );
    }
    case "write": {
      const path = inputText(part.input, ["filePath", "path", "file"]);
      const content = inputText(part.input, ["content", "text", "body"]);
      if (!path || content === undefined) break;
      const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
      const bytes = new TextEncoder().encode(content).byteLength;
      const markdown = /\.(?:md|markdown|mdx)$/i.test(path);
      return (
        <>
          <div className="activity-file-head">
            <span className="activity-file-name">{name}</span>
            <span className="activity-file-size">{formatBytes(bytes)}</span>
          </div>
          {path === name ? null : <span className="activity-file-path">{path}</span>}
          {markdown ? (
            <div className="activity-step-markdown">
              <Markdown
                text={content}
                client={props.client}
                resource={props.resource}
                headingOffset={1}
                onPreviewFile={props.onPreviewFile}
              />
            </div>
          ) : (
            <pre className="activity-code">{content}</pre>
          )}
        </>
      );
    }
    case "read": {
      const path = inputText(part.input, ["filePath", "path", "file"]);
      return (
        <>
          {path ? (
            <StepBlock label="File">
              <pre className="activity-code">{path}</pre>
            </StepBlock>
          ) : null}
          {/* A read of an image returns the bytes in the tool output, even when
              the path sits outside the session directory. Show them here; the
              path preview would be jailed and fail. */}
          <StepOutputImages
            output={part.output}
            client={props.client}
            resource={props.resource}
          />
          {outputText ? (
            <StepBlock label="Content">
              <pre className="activity-code">{outputText}</pre>
            </StepBlock>
          ) : null}
        </>
      );
    }
    case "search": {
      const query = inputText(part.input, ["pattern", "query"]);
      return (
        <>
          {query ? (
            <StepBlock label="Query">
              <pre className="activity-code">{query}</pre>
            </StepBlock>
          ) : null}
          {outputText ? (
            <StepBlock label="Result">
              <pre className="activity-code">{outputText}</pre>
            </StepBlock>
          ) : null}
        </>
      );
    }
    case "fetch": {
      const url = inputText(part.input, ["url", "query"]);
      return (
        <>
          {url ? (
            <StepBlock label="Request">
              <pre className="activity-code">{url}</pre>
            </StepBlock>
          ) : null}
          {outputText ? (
            <StepBlock label="Response">
              <pre className="activity-code">{outputText}</pre>
            </StepBlock>
          ) : null}
        </>
      );
    }
    case "subagent": {
      const agent = inputText(part.input, ["agent"]);
      const description = inputText(part.input, ["description"]);
      const prompt = inputText(part.input, ["prompt"]);
      const background = part.input && typeof part.input === "object"
        ? Boolean((part.input as Record<string, unknown>).background)
        : false;
      const sessionID =
        typeof metadata.sessionID === "string" ? metadata.sessionID : undefined;
      const childRef =
        sessionID && props.resource.providerID
          ? `${props.resource.providerID}:${sessionID}`
          : undefined;
      return (
        <>
          <StepBlock label="Agent" aside={background ? "background" : undefined}>
            <pre className="activity-code">{agent ?? "subagent"}</pre>
          </StepBlock>
          {description ? (
            <StepBlock label="Task">
              <div className="activity-step-markdown">
                <Markdown
                  text={description}
                  client={props.client}
                  resource={props.resource}
                  headingOffset={1}
                />
              </div>
            </StepBlock>
          ) : null}
          {prompt ? (
            <StepBlock label="Prompt">
              <pre className="activity-code">{prompt}</pre>
            </StepBlock>
          ) : null}
          {sessionID ? (
            <StepBlock label="Child session">
              <pre className="activity-code">{sessionID}</pre>
            </StepBlock>
          ) : null}
          {childRef && props.onOpenSession ? (
            <button
              className="btn small activity-step-open"
              type="button"
              onClick={() => props.onOpenSession?.(childRef)}
            >
              Open session
            </button>
          ) : null}
        </>
      );
    }
    default:
      break;
  }

  return (
    <>
      {part.input !== undefined ? (
        <StepBlock label="Input">
          <pre className="activity-code">{formatJson(part.input)}</pre>
        </StepBlock>
      ) : null}
      <StepOutputImages
        output={part.output}
        client={props.client}
        resource={props.resource}
      />
      {part.output !== undefined ? (
        <StepBlock label="Output">
          <pre className="activity-code">
            {outputText ?? formatJson(sanitizeToolOutput(part.output))}
          </pre>
        </StepBlock>
      ) : null}
    </>
  );
}

function CompactionRow(props: {
  message: Message;
  client: HubClient;
  resource: ResourceContext;
}) {
  const part = compactionPart(props.message);
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [retryError, setRetryError] = useState<string | undefined>(undefined);
  if (!part) return null;

  const tokensIn = part.tokens?.input;
  const running =
    part.status === "running" ||
    part.status === "pending" ||
    part.status === "streaming";
  const failed = part.status === "failed" || part.error !== undefined;
  const retryable = failed && part.retryable === true;
  const meta = running
    ? `${part.reason} · in progress`
    : failed
      ? `${part.reason} · ${part.error ?? "Compaction failed"}`
      : [
          part.reason,
          tokensIn !== undefined
            ? `${tokensIn.toLocaleString()} tokens in`
            : undefined,
          `${formatChars(part.summary.length)} summary`,
        ]
          .filter(Boolean)
          .join(" · ");

  const retry = async () => {
    setWorking(true);
    setRetryError(undefined);
    try {
      await props.client.compactSession(props.message.sessionRef);
    } catch (error) {
      setRetryError(
        error instanceof Error ? error.message : "Unable to retry compaction",
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <section
      className={`chat-compaction${running ? " running" : ""}${
        failed ? " failed" : ""
      }`}
      {...(running || failed ? { "aria-live": "polite" } : {})}
    >
      <div className="chat-compaction-row">
        <span className="chat-compaction-icon" aria-hidden="true">
          <Icon name="layers" size={16} />
        </span>
        <span className="chat-compaction-title">
          {running
            ? "Compacting context…"
            : failed
              ? retryable
                ? "Compaction failed"
                : "Nothing to compact"
              : "Context compacted"}
        </span>
        <span className="chat-compaction-meta">{meta}</span>
        {retryable ? (
          <button
            className="text-button chat-compaction-action"
            type="button"
            disabled={working}
            onClick={() => void retry()}
          >
            {working ? "Retrying…" : "Retry"}
          </button>
        ) : null}
        {!running && !failed ? (
          <button
            className="text-button chat-compaction-action"
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide summary" : "Show summary"}
          </button>
        ) : null}
      </div>
      {retryError ? (
        <p className="chat-compaction-error" role="alert">
          {retryError}
        </p>
      ) : null}
      {!running && !failed && open ? (
        <div className="chat-compaction-body">
          <Markdown
            text={part.summary}
            client={props.client}
            resource={props.resource}
            headingOffset={1}
          />
        </div>
      ) : null}
    </section>
  );
}


function ShellRow(props: { message: Message }) {
  const part = shellPart(props.message);
  const [open, setOpen] = useState(false);
  if (!part) return null;

  const running = part.status === "running";
  const exit = part.exit;
  const failed = !running && exit !== undefined && exit !== 0;
  const status = running
    ? "running"
    : exit !== undefined
      ? `exit ${exit}`
      : part.status;
  const duration =
    part.startedAt !== undefined
      ? formatDuration(
          (part.completedAt ?? (running ? Date.now() : part.startedAt)) -
            part.startedAt,
        )
      : undefined;
  const output = part.output ?? "";

  return (
    <section className="shell-run">
      <div className="shell-run-row">
        <span className="shell-run-icon" aria-hidden="true">
          <Icon name="terminal" size={16} />
        </span>
        <span className="shell-run-title">
          {part.background ? "Background shell" : "Shell"}
        </span>
        <code className="shell-run-command">{part.command}</code>
        <span
          className={`shell-run-status ${running ? "running" : failed ? "error" : ""}`}
        >
          {status}
        </span>
        {duration ? <span className="shell-run-time">{duration}</span> : null}
        {output ? (
          <button
            className="text-button shell-run-toggle"
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide output" : "Show output"}
          </button>
        ) : null}
      </div>
      {open && output ? (
        <pre className="shell-run-output">{output}</pre>
      ) : null}
    </section>
  );
}

/** Decorative placeholders while the first transcript page loads. */
function TranscriptSkeleton() {
  return (
    <div className="transcript-skeleton" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div className="skeleton-row" key={row}>
          <span className="skeleton-role" />
          <span
            className="skeleton-line"
            style={{ width: `${row === 1 ? 62 : 78}%` }}
          />
          <span
            className="skeleton-line"
            style={{ width: `${row === 2 ? 44 : 58}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function DateSeparator(props: { at: number }) {
  return (
    <div className="chat-date-separator">
      <span>{dateLabel(props.at)}</span>
    </div>
  );
}

function SessionDetails(props: {
  client: HubClient;
  session: Session;
  provider: Provider | undefined;
  markingRead: boolean;
  interrupting: boolean;
  background: BackgroundItem[];
  onClose: () => void;
  onMarkRead: () => void;
  onInterrupt: () => void;
  onSessionUpdated: (session: Session) => void;
  onOpenSession: (ref: string) => void;
}) {
  const { session, provider } = props;
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string>();
  const [lineage, setLineage] = useState<SessionLineage>();
  const [exporting, setExporting] = useState<"md" | "json">();
  const [exportError, setExportError] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState(session.title);
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string>();
  const renameButtonRef = useRef<HTMLButtonElement | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreOnClose = useRef(false);
  const [overlay, setOverlay] = useState(() =>
    window.matchMedia("(max-width: 1319px)").matches,
  );
  const providerUrl =
    safeExternalURL(session.nativeUrl) ?? safeExternalURL(provider?.baseUrl);
  const tokens = session.tokens;
  const totalTokens =
    tokens?.total ??
    (tokens?.input !== undefined || tokens?.output !== undefined
      ? (tokens.input ?? 0) + (tokens.output ?? 0)
      : undefined);

  useEffect(() => {
    let cancelled = false;
    setLineage(undefined);
    props.client
      .lineage(session.ref)
      .then((next) => {
        if (!cancelled) setLineage(next);
      })
      .catch(() => {
        // Lineage is optional context; the rest of the panel stays usable.
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, session.ref]);

  useEffect(() => {
    setRenaming(false);
    setTitleDraft(session.title);
    setRenameError(undefined);
  }, [session.ref, session.title]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1319px)");
    const onChange = () => setOverlay(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const previous = document.activeElement;
    // Restore the opener in both layouts. Above 1320px details is a column,
    // but the X and Escape still unmount it and should return focus.
    restoreOnClose.current = true;
    if (window.matchMedia("(max-width: 1319px)").matches) {
      closeRef.current?.focus();
    }
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, []);

  useEffect(() => {
    if (!overlay) return;
    // The overlay is a modal sheet. Escape closes it; the FilePreview and
    // composer sheets stop their own Escape before it reaches this listener.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, props.onClose]);

  useEffect(() => {
    if (!overlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A sheet opened above details owns Tab until it closes.
      if (document.querySelector(".file-preview, .composer-sheet")) return;
      trapTabKey(event, asideRef.current);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [overlay]);

  useEffect(() => {
    if (overlay) return;
    // Above 1320px details is a column, not a modal, but Escape remains a
    // shortcut. Nested previews and composer sheets stop their own Escape
    // before it reaches this listener.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlay, props.onClose]);

  const copyReference = async () => {
    setNotice(undefined);
    try {
      await navigator.clipboard.writeText(session.ref);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setNotice("Could not copy the session reference.");
    }
  };

  const downloadExport = async (format: "md" | "json") => {
    if (exporting) return;
    setExporting(format);
    setExportError(undefined);
    try {
      const { text, filename } = await props.client.exportSession(session.ref, format);
      const blob = new Blob([text], {
        type: format === "json" ? "application/json" : "text/markdown",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      setExportError(
        reason instanceof Error ? reason.message : "Unable to export the session",
      );
    } finally {
      setExporting(undefined);
    }
  };

  const forkSession = async () => {
    if (forking) return;
    setForking(true);
    setForkError(undefined);
    try {
      const forked = await props.client.forkSession(session.ref);
      props.onOpenSession(forked.ref);
    } catch (reason) {
      setForkError(
        reason instanceof Error ? reason.message : "Unable to fork the session.",
      );
    } finally {
      setForking(false);
    }
  };

  const startRename = () => {
    setTitleDraft(session.title);
    setRenameError(undefined);
    setNotice(undefined);
    setRenaming(true);
  };

  const cancelRename = () => {
    setRenaming(false);
    setTitleDraft(session.title);
    setRenameError(undefined);
    setNotice(undefined);
    window.requestAnimationFrame(() => renameButtonRef.current?.focus());
  };

  const saveRename = async () => {
    const title = titleDraft.trim();
    if (!title || title === session.title || renameBusy) return;
    setRenameBusy(true);
    setRenameError(undefined);
    setNotice(undefined);
    try {
      const updated = await props.client.renameSession(session.ref, title);
      props.onSessionUpdated(updated);
      setTitleDraft(updated.title);
      setRenaming(false);
      setNotice("Session renamed.");
      window.requestAnimationFrame(() => renameButtonRef.current?.focus());
    } catch (reason) {
      setRenameError(
        reason instanceof Error
          ? reason.message
          : "Unable to rename the session.",
      );
    } finally {
      setRenameBusy(false);
    }
  };

  return (
    <aside
      className="chat-details"
      id="session-details"
      role={overlay ? "dialog" : undefined}
      aria-modal={overlay ? true : undefined}
      aria-labelledby="session-details-title"
      ref={asideRef}
    >
      <div className="chat-details-head">
        <div className="chat-details-title" id="session-details-title">
          Session details
        </div>
        <button
          className="icon-btn"
          type="button"
          onClick={props.onClose}
          aria-label="Close details"
          ref={closeRef}
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="chat-details-body">
        {provider?.capabilities.rename ? (
          <section className="chat-details-section">
            <div className="chat-details-label">Name</div>
            {renaming ? (
              <form
                className="session-rename-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveRename();
                }}
                onKeyDownCapture={(event) => {
                  if (event.key !== "Escape") return;
                  event.preventDefault();
                  event.stopPropagation();
                  cancelRename();
                }}
              >
                <label className="sr-only" htmlFor="session-rename-input">
                  Session title
                </label>
                <input
                  id="session-rename-input"
                  className="session-rename-input"
                  value={titleDraft}
                  maxLength={200}
                  autoFocus
                  disabled={renameBusy}
                  onChange={(event) => setTitleDraft(event.currentTarget.value)}
                />
                <div className="session-rename-actions">
                  <button
                    className="btn small primary"
                    type="submit"
                    disabled={
                      renameBusy ||
                      !titleDraft.trim() ||
                      titleDraft.trim() === session.title
                    }
                  >
                    {renameBusy ? "Saving…" : "Save"}
                  </button>
                  <button
                    className="btn ghost small"
                    type="button"
                    disabled={renameBusy}
                    onClick={cancelRename}
                  >
                    Cancel
                  </button>
                </div>
                {renameError ? (
                  <span className="form-error" role="alert">
                    {renameError}
                  </span>
                ) : null}
              </form>
            ) : (
              <div className="session-rename-row">
                <strong>{session.title}</strong>
                <button
                  className="text-button"
                  type="button"
                  ref={renameButtonRef}
                  onClick={startRename}
                >
                  Rename
                </button>
              </div>
            )}
          </section>
        ) : null}

        <section className="chat-details-section">
          <div className="chat-details-label">Connection</div>
          <Detail label="Provider" value={providerLabel(session.providerID)} mono={false} />
          {provider?.baseUrl ? <Detail label="Endpoint" value={provider.baseUrl} /> : null}
          <Detail label="Session reference" value={session.ref} />
          <Detail label="Native ID" value={session.nativeID} />
        </section>

        <section className="chat-details-section">
          <div className="chat-details-label">Working context</div>
          {session.project ? <Detail label="Project" value={session.project} mono={false} /> : null}
          {session.directory ? <Detail label="Directory" value={session.directory} /> : null}
          {session.agent ? <Detail label="Agent" value={session.agent} mono={false} /> : null}
          {session.model ? <Detail label="Model" value={session.model} /> : null}
          {session.parentRef ? (
          <Detail label="Parent session" value={session.parentRef} />
        ) : null}
        </section>

        <section className="chat-details-section">
          <div className="chat-details-label">Data</div>
          <div className="details-links">
            <button
              className="text-button"
              type="button"
              disabled={exporting !== undefined}
              onClick={() => void downloadExport("md")}
            >
              {exporting === "md" ? "Exporting…" : "Export Markdown"}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={exporting !== undefined}
              onClick={() => void downloadExport("json")}
            >
              {exporting === "json" ? "Exporting…" : "Export JSON"}
            </button>
          </div>
          <p className="form-note">
            Transcript and session facts. Attachment files are listed, not
            embedded.
          </p>
        </section>

        {lineage && lineage.nodes.length > 1 ? (
          <section className="chat-details-section">
            <div className="chat-details-label">
              Lineage
              <span className="chat-details-count">
                {lineage.nodes.length} session{lineage.nodes.length === 1 ? "" : "s"}
                {lineage.truncated ? " · partial" : ""}
              </span>
            </div>
            <ul className="lineage-tree">
              {lineage.nodes.map((node) => (
                <li
                  key={node.ref}
                  style={{ "--depth": node.depth } as React.CSSProperties}
                >
                  <button
                    className={`lineage-node ${node.current ? "current" : ""}`}
                    type="button"
                    aria-current={node.current ? "true" : undefined}
                    title={node.ref}
                    onClick={() => {
                      if (!node.current) props.onOpenSession(node.ref);
                    }}
                  >
                    <span className="lineage-title">{node.title}</span>
                    <span className="lineage-meta">
                      {node.depth === 0 ? "root" : `depth ${node.depth}`}
                      {node.project ? ` · ${node.project}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="chat-details-section">
          <div className="chat-details-label">State</div>
          <div className="detail">
            <span>Status</span>
            <span className={`status-chip detail-chip ${session.status}`}>
              <i />
              {statusLabel(session.status)}
            </span>
          </div>
          <Detail label="Created" value={formatDateTime(session.createdAt)} mono={false} />
          <Detail label="Updated" value={formatDateTime(session.updatedAt)} mono={false} />
        </section>

        {props.background.length > 0 ? (
          <section className="chat-details-section">
            <div className="chat-details-label">Background</div>
            {props.background.map((item) => (
              <div className="background-item" key={item.key}>
                <span className="background-item-head">
                  <Icon name={item.kind === "subagent" ? "bot" : "terminal"} size={14} />
                  <span>{item.label}</span>
                  <span className="tool-status running">running</span>
                </span>
                <strong>{item.detail}</strong>
                <span className="background-item-meta">{item.meta}</span>
                {item.childRef ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => props.onOpenSession(item.childRef!)}
                  >
                    Open session
                  </button>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        {session.cost !== undefined || tokens ? (
          <section className="chat-details-section">
            <div className="chat-details-label">Usage</div>
            {session.cost !== undefined ? (
              <Detail label="Cost" value={`$${session.cost.toFixed(2)}`} mono={false} />
            ) : null}
            {totalTokens !== undefined ? (
              <Detail label="Tokens" value={formatTokenSummary(tokens, totalTokens)} mono={false} />
            ) : null}
          </section>
        ) : null}
      </div>

      <div className="chat-details-actions">
        {providerUrl ? (
          <a className="btn small" href={providerUrl} target="_blank" rel="noreferrer">
            Open in provider
          </a>
        ) : null}
        <button className="btn small" type="button" onClick={() => void copyReference()}>
          {copied ? "Copied" : "Copy reference"}
        </button>
        {session.parentRef ? (
          <button
            className="btn small"
            type="button"
            onClick={() => props.onOpenSession(session.parentRef!)}
          >
            Open parent
          </button>
        ) : null}
        {provider?.capabilities.fork ? (
          <button
            className="btn small"
            type="button"
            disabled={forking}
            onClick={() => void forkSession()}
          >
            {forking ? "Forking…" : "Fork session"}
          </button>
        ) : null}
        <button
          className="btn small"
          type="button"
          disabled={props.markingRead}
          onClick={props.onMarkRead}
        >
          {props.markingRead ? "Marking…" : "Mark read"}
        </button>
        {session.status === "running" ? (
          <button
            className="btn small danger"
            type="button"
            disabled={props.interrupting}
            onClick={props.onInterrupt}
          >
            {props.interrupting ? "Interrupting…" : "Interrupt"}
          </button>
        ) : null}
        <span className="chat-details-notice" aria-live="polite">
          {exportError ?? forkError ?? notice ?? ""}
        </span>
      </div>
    </aside>
  );
}


function MessagePartView(props: {
  part: MessagePart;
  client: HubClient;
  resource: ResourceContext;
  onPreviewFile?: (path: string) => void;
}) {
  const part = props.part;
  if (part.type === "tool") {
    const answered = answeredQuestions(part);
    return answered ? <QuestionAnswerCard answered={answered} /> : null;
  }
  if (
    part.type === "reasoning" ||
    part.type === "compaction" ||
    part.type === "shell"
  ) {
    return null;
  }
  if (part.type === "text") {
    return (
      <Markdown
        text={part.text}
        client={props.client}
        resource={props.resource}
        headingOffset={1}
        onPreviewFile={props.onPreviewFile}
      />
    );
  }
  if (part.type === "file") {
    const image = resolveSessionResource(part.url, props.resource, "image");
    const link = resolveSessionResource(part.url, props.resource, "link");
    const dataUrl = part.url?.startsWith("data:") ? part.url : undefined;
    const isImage =
      Boolean(part.mimeType?.startsWith("image/")) ||
      (!part.mimeType &&
        /\.(?:png|jpe?g|gif|webp|avif)(?:[?#]|$)/i.test(part.url ?? ""));
    const isVideo =
      Boolean(part.mimeType?.startsWith("video/")) ||
      /\.(?:mp4|m4v|webm|mov|ogv)(?:[?#]|$)/i.test(part.url ?? "");
    const isAudio =
      Boolean(part.mimeType?.startsWith("audio/")) ||
      /\.(?:mp3|m4a|wav|ogg|flac)(?:[?#]|$)/i.test(part.url ?? "");

    // A file inside the session directory can stream from a preview ticket:
    // seeking asks the provider for a slice, and a 100 MB clip never becomes a
    // hub-side buffer. The element also never needs the bearer token.
    const sessionFile = sessionFileTarget(part.url, props.resource);

    if ((isVideo || isAudio) && (dataUrl || link.url || sessionFile)) {
      return (
        <figure className="message-attachment">
          <MediaPlayer
            client={props.client}
            providerID={props.resource.providerID}
            url={link.url}
            dataUrl={dataUrl}
            viaProxy={link.attachment}
            kind={isVideo ? "video" : "audio"}
            {...(sessionFile ? { sessionFile } : {})}
          />
          <figcaption>
            <span className="message-file-name">{part.name}</span>
            {part.mimeType ? (
              <span className="message-file-meta">{part.mimeType}</span>
            ) : null}
            {dataUrl ? (
              <DataAttachmentButton url={dataUrl} name={part.name} />
            ) : (
              <AttachmentButton
                client={props.client}
                providerID={props.resource.providerID}
                url={link.url}
                viaProxy={link.attachment}
                name={part.name}
              />
            )}
          </figcaption>
        </figure>
      );
    }

    if (isImage && image.url) {
      return (
        <figure className="message-attachment">
          <AttachmentImage
            client={props.client}
            providerID={props.resource.providerID}
            url={image.url}
            viaProxy={image.attachment}
            name={part.name}
          />
          <figcaption>
            <span className="message-file-name">{part.name}</span>
            {part.mimeType ? (
              <span className="message-file-meta">{part.mimeType}</span>
            ) : null}
            {dataUrl ? (
              <DataAttachmentButton url={dataUrl} name={part.name} />
            ) : (
              <AttachmentButton
                client={props.client}
                providerID={props.resource.providerID}
                url={link.url ?? image.url}
                viaProxy={link.attachment || image.attachment}
                name={part.name}
              />
            )}
          </figcaption>
        </figure>
      );
    }

    return (
      <div className="message-file">
        <span className="message-file-name">{part.name}</span>
        {part.mimeType ? <span className="message-file-meta">{part.mimeType}</span> : null}
        {dataUrl ? (
          <DataAttachmentButton url={dataUrl} name={part.name} />
        ) : (
          <AttachmentButton
            client={props.client}
            providerID={props.resource.providerID}
            url={link.url}
            viaProxy={link.attachment}
            name={part.name}
          />
        )}
      </div>
    );
  }
  return (
    <details className="message-aux message-unknown">
      <summary>
        <span className="message-aux-label">Unsupported content</span>
        <span className="message-aux-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={14} />
        </span>
      </summary>
      <div className="message-aux-body">
        <pre>{formatJson(part.raw)}</pre>
      </div>
    </details>
  );
}

async function downloadDataUrl(url: string, name: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to read the attachment");
  saveBlob(await response.blob(), name);
}

/**
 * A video or audio file part.
 *
 * A session file plays through a preview ticket (see `TicketMedia`), so a
 * 100 MB clip is streamed instead of fetched as a blob. Data URLs need no round
 * trip, and any other provider file keeps the authenticated blob path.
 */
function MediaPlayer(props: {
  client: HubClient;
  providerID?: string;
  url?: string;
  dataUrl?: string;
  viaProxy: boolean;
  kind: "video" | "audio";
  sessionFile?: SessionFileTarget;
}) {
  const [src, setSrc] = useState<string | undefined>(props.dataUrl);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (props.sessionFile) return;
    if (props.dataUrl) {
      setSrc(props.dataUrl);
      setFailed(false);
      return;
    }
    if (!props.url) {
      setSrc(undefined);
      return;
    }
    if (!props.viaProxy) {
      setSrc(props.url);
      setFailed(false);
      return;
    }
    if (!props.providerID) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    let objectURL: string | undefined;
    setSrc(undefined);
    setFailed(false);
    void props.client
      .attachment(props.providerID, props.url)
      .then((blob) => {
        if (cancelled) return;
        objectURL = URL.createObjectURL(blob);
        setSrc(objectURL);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [
    props.client,
    props.dataUrl,
    props.providerID,
    props.url,
    props.viaProxy,
    props.sessionFile,
  ]);

  if (props.sessionFile) {
    return (
      <TicketMedia
        client={props.client}
        sessionRef={props.sessionFile.ref}
        path={props.sessionFile.path}
        kind={props.kind}
        className={`message-attachment-${props.kind}`}
      />
    );
  }

  if (failed) {
    return (
      <div className="message-file-meta" role="alert">
        This media could not be loaded.
      </div>
    );
  }
  if (!src) {
    return <div className="message-file-meta">Loading media…</div>;
  }

  return props.kind === "video" ? (
    <video
      className="message-attachment-video"
      src={src}
      controls
      playsInline
      preload="metadata"
    />
  ) : (
    <audio className="message-attachment-audio" src={src} controls preload="metadata" />
  );
}

function AttachmentImage(props: {
  client: HubClient;
  providerID?: string;
  url: string;
  viaProxy: boolean;
  name: string;
}) {
  const [source, setSource] = useState<string | undefined>(
    props.viaProxy ? undefined : props.url,
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!props.viaProxy) {
      setSource(props.url);
      setFailed(false);
      return;
    }
    if (!props.providerID) {
      setFailed(true);
      return;
    }

    let cancelled = false;
    let objectURL: string | undefined;
    setSource(undefined);
    setFailed(false);

    void props.client
      .attachment(props.providerID, props.url)
      .then((blob) => {
        if (cancelled) return;
        objectURL = URL.createObjectURL(blob);
        setSource(objectURL);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [props.client, props.providerID, props.url, props.viaProxy]);

  if (failed) {
    return <span className="message-image-missing">{props.name}</span>;
  }
  if (!source) {
    return <span className="message-image-loading">Loading image…</span>;
  }
  return (
    <img
      src={source}
      alt={props.name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function DataAttachmentButton(props: { url: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const open = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await downloadDataUrl(props.url, props.name);
    } catch {
      setError("Unable to open the attachment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="message-file-action">
      <button
        className="message-file-open"
        type="button"
        disabled={busy}
        aria-label={`Open ${props.name}`}
        onClick={() => void open()}
      >
        {busy ? "Opening…" : "Open"}
      </button>
      {error ? <span className="message-file-error">{error}</span> : null}
    </span>
  );
}

function AttachmentButton(props: {
  client: HubClient;
  providerID?: string;
  url?: string;
  viaProxy: boolean;
  name: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const url = props.url;
  const providerID = props.providerID;

  if (!url) return null;

  const open = async () => {
    if (!props.viaProxy) {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (!providerID) {
      setError("This provider cannot open the attachment");
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      await downloadAttachment(props.client, providerID, url, props.name);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to open the attachment");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="message-file-action">
      <button
        className="message-file-open"
        type="button"
        disabled={busy}
        aria-label={`Open ${props.name}`}
        onClick={() => void open()}
      >
        {busy ? "Opening…" : "Open"}
      </button>
      {error ? <span className="message-file-error">{error}</span> : null}
    </span>
  );
}

function safeExternalURL(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function formatJson(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}


function stopMediaStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission was denied. Allow microphone access and try again.";
    }
    if (error.name === "NotFoundError") {
      return "No microphone was found.";
    }
    if (error.name === "NotReadableError") {
      return "The microphone is already in use by another app.";
    }
  }
  return "Unable to start recording. Check the microphone and try again.";
}

/**
 * Inline panels are not modal. They move focus to their first field when they
 * open, and hand focus back to the opener when they close. Tab stays free.
 * The opener is captured on mount, so no extra prop is needed.
 */
function useInlinePanelFocus(
  rootRef: RefObject<HTMLElement | null>,
  headingRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const opener = document.activeElement;
    // The app focuses the page title for push navigations. A panel is the real
    // content of that navigation, so queue this focus after the parent effect
    // (children run first) instead of racing it.
    queueMicrotask(() => {
      const field = rootRef.current?.querySelector<HTMLElement>(
        'input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      );
      (field ?? headingRef.current)?.focus();
    });
    return () => {
      queueMicrotask(() => {
        if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
      });
    };
    // Mount and unmount only; re-renders must not steal focus.
  }, []);
}


function relativeTime(at: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function Placeholder(props: { view: View; onBack: () => void }) {
  const item = VIEW_META[props.view];
  return (
    <section className="hero placeholder">
      <div>
        <p className="eyebrow">Coming next</p>
        <h2>{item.label} is next</h2>
        <p>{item.description} This screen is not wired to the hub yet.</p>
      </div>
      <button className="btn small" type="button" onClick={props.onBack}>
        Back to Overview
      </button>
    </section>
  );
}

function Detail(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="detail">
      <span>{props.label}</span>
      <strong className={props.mono === false ? undefined : "mono"}>{props.value}</strong>
    </div>
  );
}

function splitModel(value: string | undefined): { model: string; variant?: string } {
  if (!value) return { model: "" };
  const separator = value.indexOf("#");
  if (separator === -1) return { model: value };
  return {
    model: value.slice(0, separator),
    ...(value.slice(separator + 1)
      ? { variant: value.slice(separator + 1) }
      : {}),
  };
}

function composeModel(model: string, variant: string): string {
  return variant ? `${model}#${variant}` : model;
}

function providerLabel(providerID: string): string {
  if (providerID.includes("opencode")) return "OpenCode";
  if (providerID.includes("openwebui")) return "Open WebUI";
  if (providerID.includes("hermes")) return "Hermes";
  return providerID;
}

function statusLabel(status: SessionStatus): string {
  if (status === "running") return "Running";
  if (status === "idle") return "Idle";
  if (status === "error") return "Error";
  return "Offline";
}

function isFakeProvider(baseUrl: string): boolean {
  return /^http:\/\/127\.0\.0\.1:410[1-3]$/.test(baseUrl);
}

function providerMark(type: string): string {
  if (type === "opencode") return "OC";
  if (type === "openwebui") return "OW";
  if (type === "hermes") return "H";
  return type.slice(0, 2).toUpperCase();
}

function ModelSelectOptions({ models }: { models: ModelOption[] }) {
  const { ungrouped, groups } = groupModelOptions(models);
  const renderOption = (model: ModelOption) => (
    <option value={model.id} key={model.id}>
      {model.label}
    </option>
  );

  if (groups.length <= 1 && ungrouped.length === 0) {
    return <>{models.map(renderOption)}</>;
  }

  return (
    <>
      {ungrouped.map(renderOption)}
      {groups.map((group) => (
        <optgroup label={group.label} key={group.provider}>
          {group.models.map(renderOption)}
        </optgroup>
      ))}
    </>
  );
}

function connectionLabel(status: ConnectionStatus): string {
  if (status === "open") return "Live";
  if (status === "connecting") return "Connecting";
  if (status === "reconnecting") return "Reconnecting";
  return "Offline";
}

function connectionClass(status: ConnectionStatus): string {
  if (status === "open") return "running";
  if (status === "closed") return "error";
  return "offline";
}

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDateTime(at: number): string {
  return new Date(at).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function dateLabel(at: number): string {
  const date = new Date(at);
  const now = new Date();
  const startOfDay = (value: Date) =>
    new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

function formatTokenSummary(
  tokens: Session["tokens"],
  total: number,
): string {
  if (!tokens) return total.toLocaleString();
  const parts = [
    tokens.input !== undefined ? `${tokens.input.toLocaleString()} in` : undefined,
    tokens.output !== undefined ? `${tokens.output.toLocaleString()} out` : undefined,
    `${total.toLocaleString()} total`,
  ].filter(Boolean);
  return parts.join(" · ");
}


function providerErrorMessage(value: unknown): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof value === "string" && value.trim()) return value;
  return "The provider reported an error.";
}
