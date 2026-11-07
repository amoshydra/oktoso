import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_ATTACHMENT_BYTES,
} from "@amoshydra/oktoso-contracts";
import type {
  AssistantView,
  Attachment,
  Attention,
  AttentionType,
  BranchPoint,
  Diagnostics,
  Health,
  HubEvent,
  Message,
  MessagePart,
  Provider,
  ProviderAuthKind,
  ProviderInput,
  ProviderOptions,
  ProviderUpdateInput,
  Session,
  SessionSelectionInput,
  SessionStatus,
} from "@amoshydra/oktoso-contracts";
import {
  HubClient,
  HubError,
  canScanPairingQr,
  messageFromHubEvent,
  scanPairingQr,
  type ConnectionStatus,
} from "@amoshydra/oktoso-client";
import { BrandMark } from "./BrandMark";
import { Icon, type IconName } from "./Icon";
import {
  appendTranscript,
  formatDictationDuration,
  messageCopyText,
  pickAudioMimeType,
} from "./chat-actions";
import { createID } from "./ids";
import { renderMarkdown } from "./markdown";
import { mergeLatestPage, mergeMessageUpdates } from "./message-order";
import {
  useBackTo,
  useHistoryLocation,
  useNavigate,
  useNavigationType,
  type NavigateOptions,
} from "./history";
import {
  currentHref,
  DEFAULT_ROUTE,
  isInternalNext,
  parseRouteHref,
  type Route,
} from "./router";
import { readRouteCache, writeRouteCache } from "./route-cache";
import { hasSavedScroll, useScrollRestoration } from "./scroll";
import {
  createOptimisticMessage,
  optimisticSend,
  updateOptimisticStatus,
} from "./optimistic";
import {
  resolveSessionResource,
  type ResourceContext,
} from "./urls";

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
    label: "Foundation",
    icon: "activity",
    sub: "Hub runtime",
    phase: "0",
    description: "Hub runtime, authentication, state, and the event stream.",
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

function routeForView(view: View): Route {
  switch (view) {
    case "foundation":
      return DEFAULT_ROUTE;
    case "inbox":
      return { name: "inbox", filter: "all" };
    case "sessions":
      return { name: "sessions", newSession: false };
    case "search":
      return { name: "search", query: "", provider: "all", status: "all" };
    case "providers":
      return { name: "providers" };
    case "settings":
      return { name: "settings" };
  }
}

export function App() {
  const { route, key: routeKey } = useHistoryLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const backTo = useBackTo();

  const view = viewForRoute(route);
  const selectedSessionRef = route.name === "chat" ? route.ref : undefined;
  const chatOpen = route.name === "chat";
  const detailsOpen = route.name === "chat" ? route.details : false;

  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [auth, setAuth] = useState<AuthState>("checking");
  const [client, setClient] = useState<HubClient | null>(null);
  const [health, setHealth] = useState<Health>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [attentionCount, setAttentionCount] = useState(0);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
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
  const lastSeq = useRef(0);
  const attentionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const autoDetailsKey = useRef<string | undefined>(undefined);
  const detailsPushed = useRef(false);

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
        navigate({ name: "search", query: "", provider: "all", status: "all" });
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
    (ref: string, options?: NavigateOptions) => {
      navigate({ name: "chat", ref, details: false }, options);
    },
    [navigate],
  );

  const navigateSearch = useCallback(
    (next: SearchState, options?: NavigateOptions) => {
      navigate({ name: "search", ...next }, options);
    },
    [navigate],
  );

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
    void new HubClient({}).signOut().catch(() => undefined);
    setToken("");
    setClient(null);
    setAuth("signed-out");
    setHealth(undefined);
    setDiagnostics(undefined);
    setProviders([]);
    setAttentionCount(0);
    setEvents([]);
    setError(undefined);
  }, []);

  const loadSnapshot = useCallback(async (hub: HubClient) => {
    const [nextHealth, nextProviders, nextDiagnostics, nextAttention] =
      await Promise.all([
        hub.health(),
        hub.providers(),
        hub.diagnostics(),
        hub.attention().catch(() => undefined),
      ]);
    setHealth(nextHealth);
    setProviders(nextProviders);
    setDiagnostics(nextDiagnostics);
    if (nextAttention) setAttentionCount(nextAttention.data.length);
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
          if (event.type.startsWith("attention.")) {
            if (attentionTimer.current) clearTimeout(attentionTimer.current);
            attentionTimer.current = setTimeout(() => {
              void client
                .attention()
                .then((page) => setAttentionCount(page.data.length))
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
      await hub.authCheck();
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
  const badge = attentionCount > 99 ? "99+" : String(attentionCount);
  const attentionAria =
    attentionCount === 1 ? "1 item needs attention" : `${attentionCount} items need attention`;

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
    <article className="panel">
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
              <div className="provider-mark">{providerMark(provider.type)}</div>
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
                  id === "inbox" && attentionCount > 0
                    ? `${item.label}, ${attentionAria}`
                    : item.label
                }
              >
                <span className="rail-mark" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                  {id === "inbox" && attentionCount > 0 ? (
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
              onClick={() => backTo({ name: "sessions" })}
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
          {chatOpen && activeSession ? (
            <button
              className="btn small topbar-details"
              type="button"
              aria-expanded={detailsOpen}
              aria-controls={detailsOpen ? "session-details" : undefined}
              onClick={() => setDetailsOpen(!detailsOpen)}
            >
              Details
            </button>
          ) : null}
          <span className={`status-chip topbar-live ${connectionClass(connection)}`}>
            <i />
            {connectionLabel(connection)}
          </span>
          <button className="icon-btn" type="button" onClick={toggleTheme} aria-label="Toggle theme">
            <Icon name={theme === "dark" ? "sun" : "moon"} size={16} />
          </button>
          <button className="btn small topbar-disconnect" type="button" onClick={signOut}>
            Disconnect
          </button>
        </header>

        <main className={`content ${chatOpen ? "chat-content" : ""}`} ref={contentRef}>
          <div className={`page ${chatOpen ? "page-chat" : ""}`}>
            {view === "foundation" ? (
              <>
                <section className="hero">
                  <div>
                    <p className="eyebrow">Oktoso</p>
                    <h2>Runtime online</h2>
                    <p>
                      The hub API, authentication, durable state, event bus, and provider
                      adapters are connected. Sessions and attention are live; search and
                      deployment hardening are next.
                    </p>
                  </div>
                  <div className="hero-badge">
                    <span className="status-dot online" />
                    v{health?.version ?? "0.1.0"}
                  </div>
                </section>

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
              />
            ) : view === "sessions" ? (
              selectedSessionRef ? (
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
                    onDetailsOpenChange={setDetailsOpen}
                    onSessionChange={setActiveSession}
                    onOpenSession={openSession}
                    onBack={() => backTo({ name: "sessions" })}
                  />
                </div>
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
                onNavigate={navigateSearch}
                onOpen={openSession}
              />
            ) : view === "providers" ? (
              <>
                {providerPanel}
                {diagnosticsPanel}
              </>
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
                        <h2>Session</h2>
                        <p>A paired browser uses an HttpOnly cookie. The owner token stays in this tab.</p>
                      </div>
                    </div>
                    <button className="btn small" type="button" onClick={signOut}>
                      Disconnect
                    </button>
                  </article>
                  <article className="panel">
                    <div className="panel-head">
                      <div>
                        <h2>About</h2>
                        <p>Frozen reference and runtime build.</p>
                      </div>
                    </div>
                    <span className="mono">design-v1.1 · v{health?.version ?? "0.1.0"}</span>
                  </article>
                </section>
                <AssistantSettingsPanel client={client as HubClient} />
                {diagnosticsPanel}
              </>
            ) : (
              <Placeholder view={view} onBack={() => navigate(DEFAULT_ROUTE)} />
            )}

          </div>
        </main>

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
                  id === "inbox" && attentionCount > 0
                    ? `${item.label}, ${attentionAria}`
                    : item.label
                }
              >
                <span className="bottom-mark" aria-hidden="true">
                  <Icon name={item.icon} size={18} />
                  {id === "inbox" && attentionCount > 0 ? (
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

  return (
    <div className="login-page">
      <button className="icon-btn login-theme" type="button" onClick={props.onToggleTheme} aria-label="Toggle theme">
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
  const [replyModels, setReplyModels] = useState<string[]>([]);
  const [transcriptionModels, setTranscriptionModels] = useState<string[]>([]);
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
  const [saving, setSaving] = useState<"reply" | "transcription">();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const next = await props.client.assistantSettings();
      setView(next);
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

  const save = async (target: "reply" | "transcription") => {
    setSaving(target);
    setError(undefined);
    setNotice(undefined);
    try {
      const value = target === "reply" ? reply : transcription;
      const next = await props.client.saveAssistantSettings({
        [target]: {
          enabled: value.enabled,
          baseUrl: value.baseUrl.trim(),
          model: value.model.trim(),
          timeoutMs: value.timeoutMs,
          ...(target === "reply"
            ? { disableThinking: reply.disableThinking }
            : {}),
          ...(value.apiKey.trim() ? { apiKey: value.apiKey.trim() } : {}),
        },
      });
      setView(next);
      setNotice(`${target === "reply" ? "Reply assistance" : "Voice transcription"} saved.`);
      if (target === "reply") setReply((current) => ({ ...current, apiKey: "" }));
      else setTranscription((current) => ({ ...current, apiKey: "" }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save settings");
    } finally {
      setSaving(undefined);
    }
  };

  const loadModels = async (target: "reply" | "transcription") => {
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await props.client.assistantModels(target);
      if (target === "reply") {
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

  return (
    <section className="grid-two settings-assistant">
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
              placeholder="https://host/llamacpp/v1"
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
          <button className="btn small" type="button" onClick={() => void loadModels("reply")}>
            Load models
          </button>
          <button className="btn primary small" type="button" disabled={saving === "reply"} onClick={() => void save("reply")}>
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
          <button className="btn small" type="button" onClick={() => void loadModels("transcription")}>
            Load models
          </button>
          <button className="btn primary small" type="button" disabled={saving === "transcription"} onClick={() => void save("transcription")}>
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
}) {
  const { key } = useHistoryLocation();
  const [items, setItems] = useState<Attention[]>(
    () => readRouteCache<Attention[]>(key, "inbox-items") ?? [],
  );
  const filter = ATTENTION_FILTERS.some(([value]) => value === props.filter)
    ? props.filter
    : "all";
  const [loading, setLoading] = useState(true);
  const [busyID, setBusyID] = useState<string>();
  const [error, setError] = useState<string>();

  const load = async (silent = false) => {
    if (!silent) setLoading(true);
    setError(undefined);
    try {
      const page = await props.client.attention();
      setItems(page.data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load attention");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    writeRouteCache(key, "inbox-items", items);
  }, [items, key]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(true), 15_000);
    return () => clearInterval(timer);
  }, [props.client]);

  const liveSeq =
    props.events.find(
      (event) =>
        event.type.startsWith("session.") ||
        event.type.startsWith("attention.") ||
        event.type === "resync",
    )?.seq ?? 0;
  useEffect(() => {
    if (!liveSeq) return;
    const timer = setTimeout(() => void load(true), 600);
    return () => clearTimeout(timer);
  }, [liveSeq]);

  const count = (value: string) => {
    if (value === "all") return items.length;
    if (value === "approval") {
      return items.filter((item) => item.type === "permission" || item.type === "approval").length;
    }
    return items.filter((item) => item.type === value).length;
  };

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

  return (
    <>
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
          {ATTENTION_FILTERS.map(([value, label]) => (
            <button
              className={`chip ${filter === value ? "active" : ""}`}
              type="button"
              key={value}
              onClick={() => props.onFilterChange(value)}
            >
              {label} {count(value)}
            </button>
          ))}
        </div>
        <button
          className="btn small"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="empty">Loading attention…</div>
      ) : visible.length === 0 ? (
        <div className="empty">Nothing needs you right now.</div>
      ) : (
        groups
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
                  item={item}
                  key={item.id}
                  busy={busyID === item.id}
                  detail={attentionDetailText(item)}
                  onAction={(action, input) => void act(item, action, input)}
                  onOpen={() => props.onOpen(item.sessionRef)}
                />
              ))}
            </section>
          ))
      )}
    </>
  );
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

function AttentionCard(props: {
  item: Attention;
  busy: boolean;
  inline?: boolean;
  detail?: string;
  onAction: (action: string, input?: Record<string, unknown>) => void;
  onOpen?: () => void;
}) {
  const item = props.item;
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      (item.fields ?? []).map((field) => [
        field.id,
        field.defaultValue ??
          (field.type === "boolean" ? false : field.type === "multiselect" ? [] : ""),
      ]),
    ),
  );
  const hasFields = (item.fields?.length ?? 0) > 0;
  const answerAction = item.actions.find((action) => action.id === "answer");
  const missingRequired = (item.fields ?? []).filter((field) => {
    if (!field.required) return false;
    const value = values[field.id];
    return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
  });
  const actionInput = () => (hasFields ? { fields: values } : {});

  return (
    <article className={`attention-card ${item.priority === "blocking" ? "blocking" : ""}`}>
      <div className="attention-top">
        <span className={`type-badge ${item.type}`}>{ATTENTION_LABELS[item.type]}</span>
        <span className="attention-provider">{providerLabel(item.sessionRef.split(":")[0] ?? "")}</span>
        <span className="attention-age">{relativeTime(item.createdAt)}</span>
      </div>
      <div className="attention-title">{item.title}</div>
      <div className="attention-summary">{item.summary}</div>
      {props.detail ? <div className="attention-detail">{props.detail}</div> : null}

      {hasFields ? (
        <div className="attention-fields">
          {item.fields?.map((field) => (
            <AttentionFieldInput
              field={field}
              key={field.id}
              value={values[field.id]}
              onValue={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
            />
          ))}
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
        {answerAction ? (
          <button
            className="btn primary small"
            type="button"
            disabled={props.busy || missingRequired.length > 0}
            onClick={() => props.onAction("answer", actionInput())}
          >
            {answerAction.label}
          </button>
        ) : null}
        {answerAction && missingRequired.length > 0 ? (
          <span className="attention-required">
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

function AttentionFieldInput(props: {
  field: NonNullable<Attention["fields"]>[number];
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
          onChange={(event) => props.onValue((event.currentTarget as HTMLInputElement).checked)}
        />
        <span>{field.label}</span>
        {field.description ? <small className="attention-help">{field.description}</small> : null}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <label className="attention-field">
        <span>{field.label}</span>
        <select
          value={typeof props.value === "string" ? props.value : ""}
          onChange={(event) => props.onValue((event.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">Choose…</option>
          {(field.options ?? []).map((option) => (
            <option value={option.value} key={option.value}>{option.label}</option>
          ))}
        </select>
        {field.description ? <small className="attention-help">{field.description}</small> : null}
      </label>
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

function SearchView(props: {
  client: HubClient;
  providers: Provider[];
  query: string;
  provider: string;
  status: SessionStatus | "all";
  onNavigate: (next: SearchState, options?: NavigateOptions) => void;
  onOpen: (ref: string) => void;
}) {
  const { key } = useHistoryLocation();
  const [draft, setDraft] = useState(props.query);
  const [results, setResults] = useState<Session[]>(
    () => readRouteCache<Session[]>(key, "search-results") ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const sentQuery = useRef(props.query);
  const { provider, status } = props;

  const trimmed = draft.trim();
  const hasFilters = provider !== "all" || status !== "all";

  useEffect(() => {
    writeRouteCache(key, "search-results", results);
  }, [key, results]);

  useEffect(() => {
    if (props.query === sentQuery.current) return;
    sentQuery.current = props.query;
    setDraft(props.query);
  }, [props.query]);

  useEffect(() => {
    if (draft === sentQuery.current) return;
    const timer = window.setTimeout(() => {
      sentQuery.current = draft;
      props.onNavigate({ query: draft, provider, status }, { replace: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [draft, provider, status, props.onNavigate]);

  const selectProvider = (value: string) => {
    sentQuery.current = draft;
    props.onNavigate({ query: draft, provider: value, status });
  };

  const selectStatus = (value: SessionStatus | "all") => {
    sentQuery.current = draft;
    props.onNavigate({ query: draft, provider, status: value });
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

  useEffect(() => {
    const request = ++requestRef.current;
    setError(undefined);

    if (!trimmed && !hasFilters) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      props.client
        .sessions({
          ...(trimmed ? { q: trimmed } : {}),
          ...(provider !== "all" ? { provider } : {}),
          ...(status !== "all" ? { status } : {}),
          limit: 100,
        })
        .then((page) => {
          if (request !== requestRef.current) return;
          setResults(page.data);
        })
        .catch((reason) => {
          if (request !== requestRef.current) return;
          setResults([]);
          setError(
            reason instanceof Error ? reason.message : "Unable to search sessions",
          );
        })
        .finally(() => {
          if (request !== requestRef.current) return;
          setLoading(false);
        });
    }, 300);

    return () => clearTimeout(timer);
  }, [props.client, trimmed, provider, status, hasFilters, attempt]);

  const resultSummary = loading
    ? "Searching sessions…"
    : `${results.length} session${results.length === 1 ? "" : "s"} matched`;

  return (
    <>
      <section className="panel search-panel">
        <label className="sr-only" htmlFor="session-search">
          Search sessions
        </label>
        <input
          id="session-search"
          ref={inputRef}
          className="search-input"
          type="search"
          value={draft}
          placeholder="Search sessions…"
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

      {!trimmed && !hasFilters ? (
        <div className="empty">
          Type a query or choose a provider or status filter to search sessions
          across providers.
        </div>
      ) : loading && results.length === 0 ? (
        <div className="empty">Searching sessions…</div>
      ) : !loading && results.length === 0 && !error ? (
        <div className="empty">
          No sessions match {trimmed ? `“${trimmed}”` : "these filters"}.
        </div>
      ) : results.length > 0 ? (
        <section className="panel search-results-panel" aria-busy={loading}>
          <div className="panel-head">
            <div>
              <h2>Results</h2>
              <p role="status">{resultSummary}</p>
            </div>
            <span className="mode-badge">Session metadata</span>
          </div>
          <div className={`session-list ${loading ? "search-loading" : ""}`}>
            {results.map((session) => (
              <button
                className={`session-list-item ${session.unread ? "unread" : ""}`}
                type="button"
                key={session.ref}
                onClick={() => props.onOpen(session.ref)}
                aria-label={searchResultLabel(session)}
              >
                <span className={`session-status-dot ${session.status}`} />
                <span className="session-list-main">
                  <strong>{session.title}</strong>
                  <span className="session-list-meta">
                    {providerLabel(session.providerID)}
                    {session.project || session.directory ? (
                      <> · {session.project ?? session.directory}</>
                    ) : null}
                    {session.agent ? <> · {session.agent}</> : null}
                  </span>
                </span>
                <span className="session-list-side">
                  {session.attention ? (
                    <span className={`type-badge ${session.attention.type}`}>
                      {ATTENTION_LABELS[session.attention.type]}
                    </span>
                  ) : null}
                  {session.unread ? <span className="sr-only">Unread</span> : null}
                  <span className="mono">{relativeTime(session.updatedAt)}</span>
                  <span className={`status-chip ${session.status}`}>
                    <i />
                    {session.status}
                  </span>
                </span>
              </button>
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

  const needle = query.trim().toLowerCase();
  const filtered = all.filter((session) => {
    if (provider !== "all" && session.providerID !== provider) return false;
    if (status !== "all" && session.status !== status) return false;
    if (!needle) return true;
    return searchResultLabel(session).toLowerCase().includes(needle);
  });

  const groups: Array<{ label: string; items: Session[] }> = [];
  for (const session of filtered) {
    const label = sidebarGroupLabel(session.updatedAt);
    const group = groups.find((candidate) => candidate.label === label);
    if (group) group.items.push(session);
    else groups.push({ label, items: [session] });
  }

  return (
    <aside className="chat-sidebar" aria-label="Session list">
      <div className="chat-sidebar-head">
        <span className="chat-sidebar-label">Sessions</span>
        <span className="chat-sidebar-count">{filtered.length}</span>
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
        ) : filtered.length === 0 ? (
          <div className="chat-sidebar-empty">No sessions match.</div>
        ) : (
          groups.map((group) => (
            <section className="chat-sidebar-group" key={group.label}>
              <div className="chat-sidebar-group-label">{group.label}</div>
              <div className="session-list">
                {group.items.map((session) => (
                  <button
                    className={`session-list-item ${
                      session.unread ? "unread" : ""
                    } ${session.ref === props.activeRef ? "active" : ""}`}
                    type="button"
                    key={session.ref}
                    aria-current={
                      session.ref === props.activeRef ? "page" : undefined
                    }
                    aria-label={searchResultLabel(session)}
                    onClick={() => props.onOpen(session.ref)}
                  >
                    <span className={`session-status-dot ${session.status}`} />
                    <span className="session-list-main">
                      <strong>{session.title}</strong>
                      <span className="session-list-meta">
                        {providerLabel(session.providerID)}
                        {session.project || session.directory ? (
                          <> · {session.project ?? session.directory}</>
                        ) : null}
                      </span>
                    </span>
                    <span className="session-list-side">
                      {session.attention ? (
                        <span className={`type-badge ${session.attention.type}`}>
                          {ATTENTION_LABELS[session.attention.type]}
                        </span>
                      ) : null}
                      <span className="mono">
                        {relativeTime(session.updatedAt)}
                      </span>
                    </span>
                  </button>
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

function searchResultLabel(session: Session): string {
  const cues = [
    session.unread ? "unread" : undefined,
    session.attention
      ? `${ATTENTION_LABELS[session.attention.type]} needs attention`
      : undefined,
  ].filter(Boolean);
  return [
    session.title,
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
  const { key } = useHistoryLocation();
  const cached = useRef(
    readRouteCache<{ sessions: Session[]; cursor: string | null }>(
      key,
      "sessions-list",
    ),
  );
  const [sessions, setSessions] = useState<Session[]>(
    () => cached.current?.sessions ?? [],
  );
  const [cursor, setCursor] = useState<string | null>(
    () => cached.current?.cursor ?? null,
  );
  const [loading, setLoading] = useState(!cached.current);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string>();

  const load = async (next?: string) => {
    if (next) setLoadingMore(true);
    else setLoading(true);
    setError(undefined);
    try {
      const page = await props.client.sessions({ limit: 50, cursor: next });
      setSessions((current) => {
        if (!next) return page.data;
        const seen = new Set(current.map((session) => session.ref));
        return [...current, ...page.data.filter((session) => !seen.has(session.ref))];
      });
      setCursor(page.cursor.next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load sessions");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (readRouteCache(key, "sessions-list")) return;
    void load();
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
    const timer = setTimeout(() => void load(), 500);
    return () => clearTimeout(timer);
  }, [liveSeq]);

  useEffect(() => {
    if (loading || error) return;
    writeRouteCache(key, "sessions-list", { sessions, cursor });
  }, [cursor, error, key, loading, sessions]);

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
            disabled={loading}
            onClick={() => void load()}
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
        <div className="alert" role="alert">
          {error}
          <button className="text-button" type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <div>
            <h2>All sessions</h2>
            <p>{sessions.length} sessions · newest first</p>
          </div>
          <span className="mode-badge">Read + write</span>
        </div>
        {loading && sessions.length === 0 ? (
          <div className="empty">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="empty">No sessions returned by the provider.</div>
        ) : (
          <div className="session-list">
            {sessions.map((session) => (
              <button
                className={`session-list-item ${session.unread ? "unread" : ""}`}
                type="button"
                key={session.ref}
                onClick={() => props.onOpen(session.ref)}
              >
                <span className={`session-status-dot ${session.status}`} />
                <span className="session-list-main">
                  <strong>{session.title}</strong>
                  <span className="session-list-meta">
                    {providerLabel(session.providerID)}
                    {session.project || session.directory ? (
                      <> · {session.project ?? session.directory}</>
                    ) : null}
                  </span>
                </span>
                <span className="session-list-side">
                  <span className="mono">{relativeTime(session.updatedAt)}</span>
                  <span className={`status-chip ${session.status}`}>
                    <i />
                    {session.status}
                  </span>
                </span>
              </button>
            ))}
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
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="panel-head">
        <div>
          <h3>{editing ? "Edit provider" : "Add provider"}</h3>
          <p>
            Stored in the hub config file. Credentials are write-only and never
            returned by the API.
          </p>
        </div>
        <button className="btn ghost small" type="button" onClick={props.onClose}>
          Close
        </button>
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span>Provider ID</span>
          <input
            value={id}
            disabled={Boolean(editing)}
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

  const submit = async () => {
    if (!providerID || !title.trim() || submitting) return;
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
      try {
        await props.client.sendMessage(session.ref, { text: prompt.trim() });
      } catch (reason) {
        setError(
          reason instanceof Error
            ? `Session created, but the first prompt failed: ${reason.message}`
            : "Session created, but the first prompt failed",
        );
      }
    }

    setSubmitting(false);
    props.onCreated(session.ref);
  };

  return (
    <section className="panel new-session-panel">
      <div className="panel-head">
        <div>
          <h2>New session</h2>
          <p>Create an OpenCode session and optionally send the first prompt.</p>
        </div>
        <button className="btn ghost small" type="button" onClick={props.onClose}>
          Close
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
                {(options?.models ?? []).map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}
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
            <button className="btn small" type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button className="btn primary small" type="submit" disabled={loading || submitting || !title.trim() || !providerID}>
              {submitting ? "Creating…" : "Create session"}
            </button>
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
  return "Ctrl/⌘ Enter to send";
}

function promptFailure(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Unable to send the prompt";
}

function SessionDetail(props: {
  client: HubClient;
  sessionRef: string;
  events: HubEvent[];
  providers: Provider[];
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
  onSessionChange: (session: Session | undefined) => void;
  onOpenSession: (ref: string) => void;
  onBack: () => void;
}) {
  const [session, setSession] = useState<Session>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [markingRead, setMarkingRead] = useState(false);
  const restoreScroll = useRef(hasSavedScroll("transcript"));
  const [atBottom, setAtBottom] = useState(() => !restoreScroll.current);
  const [inlineAttention, setInlineAttention] = useState<Attention[]>([]);
  const [attentionBusyID, setAttentionBusyID] = useState<string>();
  const [attentionError, setAttentionError] = useState<string>();
  const [selectionOptions, setSelectionOptions] = useState<ProviderOptions>();
  const [selectionSaving, setSelectionSaving] = useState(false);
  const [selectionError, setSelectionError] = useState<string>();
  const [agentValue, setAgentValue] = useState("");
  const [modelValue, setModelValue] = useState("");
  const [variantValue, setVariantValue] = useState("");
  const { text: draft, status: draftStatus, update: updateDraft, discard: discardDraft } =
    useSessionDraft(props.client, props.sessionRef);
  const [error, setError] = useState<string>();
  const [sendError, setSendError] = useState<string>();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(0);
  const [attachmentError, setAttachmentError] = useState<string>();
  const [branches, setBranches] = useState<BranchPoint[]>([]);
  const [branchBusy, setBranchBusy] = useState<string>();
  const [retryBusy, setRetryBusy] = useState<string>();
  const [branchError, setBranchError] = useState<string>();
  const [editingMessageID, setEditingMessageID] = useState<string>();
  const [editText, setEditText] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string>();
  const [dictation, setDictation] = useState<DictationState>({ phase: "idle" });
  const [dictationElapsedMs, setDictationElapsedMs] = useState(0);
  const [dictationEnabled, setDictationEnabled] = useState(false);
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
  const canEdit = Boolean(sessionProvider?.capabilities.fork);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const getScroller = () => transcriptRef.current;

  const nearBottom = () => {
    const scroller = getScroller();
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 240;
  };

  const isAtBottom = () => {
    const scroller = getScroller();
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  };

  const jumpToLatest = () => {
    const scroller = getScroller();
    if (!scroller) return;
    setAtBottom(true);
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  };

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
        if (!cancelled) setDictationEnabled(view.transcription.enabled);
      })
      .catch(() => {
        if (!cancelled) setDictationEnabled(false);
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
    setDictation({ phase: "idle" });
    setDictationElapsedMs(0);
    return () => cleanupDictation();
  }, [props.sessionRef, cleanupDictation]);

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

  const refreshLatest = useCallback(
    async (forceBottom = false, replace = false) => {
      const [nextSession, page] = await Promise.all([
        props.client.session(props.sessionRef),
        props.client.messages(props.sessionRef, {
          limit: MESSAGE_PAGE_SIZE,
          order: "desc",
        }),
      ]);
      const latest = [...page.data].reverse();
      const stick = (forceBottom || nearBottom()) && !restoreScroll.current;
      setSession(nextSession);
      setMessages((current) =>
        replace ? latest : mergeLatestPage(current, latest),
      );
      setOlderCursor((current) => (replace ? page.cursor.next : current ?? page.cursor.next));
      if (stick) pendingScroll.current = { mode: "bottom" };
    },
    [props.client, props.sessionRef],
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

  const retryMessage = async (messageId: string) => {
    if (retryBusy) return;
    setRetryBusy(messageId);
    setBranchError(undefined);
    try {
      await props.client.retryMessage(props.sessionRef, messageId);
      await refreshLatest(true, true);
      await refreshBranches();
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

  const switchBranch = async (point: BranchPoint, siblingId: string) => {
    if (branchBusy) return;
    setBranchBusy(point.messageId);
    setBranchError(undefined);
    try {
      await props.client.switchBranch(props.sessionRef, siblingId);
      await refreshLatest(true, true);
      await refreshBranches();
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

  const send = async () => {
    const text = draft.trim();
    const attachmentIDs = attachments.map((attachment) => attachment.id);
    if (
      (!text && attachmentIDs.length === 0) ||
      sending ||
      dictationBusy ||
      uploadingAttachments > 0
    ) {
      return;
    }
    setSending(true);
    setSendError(undefined);
    let optimistic: Message | undefined;
    try {
      const idempotencyKey = createID();
      const created = createOptimisticMessage({
        sessionRef: props.sessionRef,
        text,
        attachments,
        idempotencyKey,
      });
      optimistic = created;
      setMessages((current) => [...current, created]);
      setAttachments([]);
      pendingScroll.current = { mode: "bottom" };
      await discardDraft();
      await props.client.sendMessage(
        props.sessionRef,
        { text, ...(attachmentIDs.length > 0 ? { attachments: attachmentIDs } : {}) },
        { idempotencyKey },
      );
      setMessages((current) =>
        current.map((message) =>
          message.id === created.id
            ? updateOptimisticStatus(message, "sent")
            : message,
        ),
      );
      setSession((current) => (current ? { ...current, status: "running" } : current));
      window.setTimeout(() => {
        void refreshLatest(true).catch(() => undefined);
        void refreshBranches();
      }, 500);
    } catch (reason) {
      const message = promptFailure(reason);
      if (text && !draftRef.current.trim()) {
        // The draft was deleted before the request. Restore it so a reload
        // does not lose the failed message, unless the user already typed a
        // new draft.
        void props.client.saveDraft(props.sessionRef, text).catch(() => undefined);
      }
      if (optimistic) {
        const failedID = optimistic.id;
        setMessages((current) =>
          current.map((item) =>
            item.id === failedID
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
    setMessages((current) => current.filter((item) => item.id !== message.id));
    for (const id of payload?.attachmentIDs ?? []) {
      void props.client.deleteAttachment(id).catch(() => undefined);
    }
    if (!draftRef.current.trim()) {
      void props.client.deleteDraft(props.sessionRef).catch(() => undefined);
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
    setEditingMessageID(undefined);
    setEditText("");
    setEditError(undefined);
  };

  const saveEdit = async () => {
    if (!editingMessageID || editBusy || !editText.trim()) return;
    setEditBusy(true);
    setEditError(undefined);
    try {
      const forked = await props.client.forkSession(props.sessionRef, {
        before: editingMessageID,
      });
      await props.client.saveDraft(forked.ref, editText.trim());
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

  const uploadAttachments = async (files: FileList | null) => {
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

  useEffect(() => {
    if (!atBottom) return;
    const scroller = getScroller();
    if (!scroller) return;
    const frame = requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [inlineAttention.length, atBottom]);

  useEffect(() => {
    const scroller = getScroller();
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setAtBottom(isAtBottom());
      });
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [session]);

  useEffect(() => {
    const scroller = getScroller();
    if (!scroller) return;
    const observer = new ResizeObserver(() => {
      if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    });
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [session, atBottom]);

  useEffect(() => {
    let cancelled = false;
    pendingScroll.current = undefined;
    restoreScroll.current = hasSavedScroll("transcript");
    setSession(undefined);
    setMessages([]);
    setOlderCursor(null);
    setLoading(true);
    setError(undefined);
    setSendError(undefined);
    setInlineAttention([]);
    setAttentionBusyID(undefined);
    setAttentionError(undefined);
    setAtBottom(!restoreScroll.current);
    refreshLatest(true)
      .then(() => {
        if (!cancelled) {
          void props.client.markRead(props.sessionRef).catch(() => undefined);
        }
      })
      .catch((reason) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : "Unable to load the session");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          restoreScroll.current = false;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.sessionRef, refreshLatest]);

  useEffect(() => {
    const fresh = props.events.filter((event) => event.seq > processedSeq.current);
    if (fresh.length === 0) return;
    processedSeq.current = Math.max(
      processedSeq.current,
      ...fresh.map((event) => event.seq),
    );

    const upserts: Message[] = [];
    let needsRefresh = false;
    for (const event of fresh) {
      if (event.type === "resync") {
        needsRefresh = true;
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
      }
    }

    if (upserts.length > 0) {
      setMessages((current) => mergeMessageUpdates(current, upserts));
    }
    if (needsRefresh) {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = undefined;
        void refreshLatest().catch(() => undefined);
      }, 400);
    }
  }, [props.events, props.sessionRef, refreshLatest]);

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
  const errorAttention = inlineAttention.find((item) => item.type === "error");
  const providerError = [...messages]
    .reverse()
    .find((message) => message.metadata?.error)?.metadata?.error;
  const attentionDetail =
    errorAttention && providerError ? providerErrorMessage(providerError) : undefined;
  const hasBlockingAttention = inlineAttention.some((item) => item.priority === "blocking");
  const latestQuestion = latestQuestionText(messages);
  const transcriptItems = groupTranscript(messages);
  const composerHint =
    uploadingAttachments > 0
      ? "Uploading attachment…"
      : dictation.phase === "starting"
        ? "Starting dictation…"
      : dictation.phase === "recording"
        ? "Recording…"
        : dictation.phase === "transcribing"
          ? "Transcribing…"
          : draftStatus === "idle" && session?.status === "running"
            ? "Agent running · Ctrl/⌘ Enter to queue"
            : draftStatusLabel(draftStatus);
  const resource: ResourceContext = {
    baseUrl: sessionProvider?.baseUrl,
    providerID: session?.providerID,
    providerType: sessionProvider?.type,
    directory: session?.directory,
  };

  return (
    <div className={`chat-layout ${props.detailsOpen && session ? "details-open" : ""}`}>
      <div className="chat-main">
        {loading && !session ? (
          <div className="empty chat-loading">Loading session…</div>
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
                <button className="text-button" type="button" onClick={() => setError(undefined)}>
                  Dismiss
                </button>
              </div>
            ) : null}

            <section
              className="chat-panel"
              aria-label="Session transcript"
              ref={transcriptRef}
              tabIndex={0}
            >
              <header className="chat-doc-head">
                <div className="chat-doc-title">{session.title}</div>
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

              {messages.length === 0 ? (
                <div className="empty">No messages yet. Send the first prompt below.</div>
              ) : (
                transcriptItems.map((item) =>
                  item.kind === "date" ? (
                    <DateSeparator at={item.at} key={item.key} />
                  ) : item.kind === "message" ? (
                    <TranscriptMessage
                      message={item.message}
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
                      canRetry={Boolean(sessionProvider?.capabilities.retry)}
                      retryBusy={retryBusy === item.message.id}
                      onRetry={(messageId) => void retryMessage(messageId)}
                      onRetryOptimistic={(message) => void retryOptimistic(message)}
                      onDiscardOptimistic={discardOptimistic}
                      canEdit={canEdit}
                      onEdit={(message) => beginEdit(message)}
                      editing={editingMessageID === item.message.id}
                      editText={editText}
                      editBusy={editBusy}
                      editError={editError}
                      onEditTextChange={setEditText}
                      onSaveEdit={() => void saveEdit()}
                      onCancelEdit={cancelEdit}
                      suppressError={Boolean(errorAttention)}
                    />
                  ) : (
                    <AgentActivity
                      messages={item.messages}
                      key={item.key}
                      client={props.client}
                      resource={resource}
                    />
                  ),
                )
              )}

              {inlineAttention.length > 0 ? (
                <div className="chat-inline-attention" aria-label="Needs your input">
                  {inlineAttention.map((item) => (
                    <AttentionCard
                      item={item}
                      key={item.id}
                      busy={attentionBusyID === item.id}
                      inline
                      detail={
                        item.type === "error"
                          ? attentionDetail
                          : item.type === "question"
                            ? attentionDetailText(item) ?? latestQuestion
                            : undefined
                      }
                      onAction={(action, input) => void actOnAttention(item, action, input)}
                    />
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
            </section>

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

            <div className="chat-composer-wrap">
              {!atBottom ? (
                <button className="chat-jump" type="button" onClick={jumpToLatest}>
                  {hasBlockingAttention ? "Input needed" : "Jump to latest"}
                  <span aria-hidden="true">↓</span>
                </button>
              ) : null}
              <form
                className="chat-composer"
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
                          {formatFileSize(attachment.size)}
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
                <textarea
                  id="chat-composer-input"
                  name="message"
                  rows={2}
                  value={draft}
                  aria-label={`Reply to ${session.title}`}
                  aria-describedby="chat-composer-hint"
                  placeholder={`Reply to ${session.title}…`}
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
                <div className="chat-composer-bar">
                  {showSelection ? (
                    <div
                      className="composer-options"
                      title={
                        session.status === "running"
                          ? "Wait for the current run to finish"
                          : undefined
                      }
                    >
                      {agentChoices.length > 0 ? (
                        <label className="composer-option">
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
                        <label className="composer-option">
                          <span>Model</span>
                          <select
                            value={modelValue}
                            disabled={selectionDisabled}
                            aria-label="Model"
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
                            {modelChoices.map((model) => (
                              <option value={model.id} key={model.id}>
                                {model.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                      {variantChoices.length > 0 ? (
                        <label className="composer-option">
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
                        <span className="composer-option-status">Saving…</span>
                      ) : null}
                      {selectionError ? (
                        <span className="composer-option-status error">{selectionError}</span>
                      ) : null}
                    </div>
                  ) : null}
                  <span
                    id="chat-composer-hint"
                    className={`composer-hint ${draftStatus === "error" ? "error" : ""}`}
                  >
                    {composerHint}
                  </span>
                  <div className="composer-actions">
                    {attachSupported ? (
                      <button
                        className="composer-voice"
                        type="button"
                        disabled={uploadingAttachments > 0}
                        onClick={() => attachmentInputRef.current?.click()}
                      >
                        {uploadingAttachments > 0 ? "Uploading…" : "Attach"}
                      </button>
                    ) : null}
                    {dictationSupported ? (
                      <button
                        className={`composer-voice ${dictation.phase === "recording" ? "recording" : ""}`}
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
                        onClick={() => {
                          if (dictation.phase === "recording") stopDictation();
                          else void startDictation();
                        }}
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
                    {session.status === "running" ? (
                      <button
                        className="btn small"
                        type="button"
                        disabled={interrupting}
                        onClick={() => void interrupt()}
                      >
                        {interrupting ? "Interrupting…" : "Interrupt"}
                      </button>
                    ) : null}
                    <button
                      className="btn primary small composer-send"
                      type="submit"
                      aria-label={sending ? "Sending message" : "Send message"}
                      disabled={
                        sending ||
                        (!draft.trim() && attachments.length === 0) ||
                        dictationBusy ||
                        uploadingAttachments > 0
                      }
                    >
                      <span className="composer-send-label">
                        {sending ? "Sending…" : "Send"}
                      </span>
                      <svg
                        className="composer-send-icon"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path
                          d="M8 13V3M4 7l4-4 4 4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
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
            onClose={() => props.onDetailsOpenChange(false)}
            onMarkRead={() => void markRead()}
            onInterrupt={() => void interrupt()}
            onOpenSession={props.onOpenSession}
          />
        </>
      ) : null}
    </div>
  );
}

type TranscriptItem =
  | { kind: "message"; message: Message }
  | { kind: "activity"; messages: Message[]; key: string }
  | { kind: "date"; at: number; key: string };

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
        // Keep the disclosure mounted while new activity appends to the group.
        // Including the last message ID remounts and collapses it on every update.
        key: `activity:${activity[0]!.id}`,
      },
      activity[0]!.createdAt,
    );
    activity = [];
  };
  for (const message of messages) {
    if (isActivityMessage(message)) {
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
    message.parts.every(
      (part) => part.type === "reasoning" || part.type === "tool" || part.type === "unknown",
    )
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
  canEdit?: boolean;
  onEdit?: (message: Message) => void;
  editing?: boolean;
  editText?: string;
  editBusy?: boolean;
  editError?: string;
  onEditTextChange?: (value: string) => void;
  onSaveEdit?: () => void;
  onCancelEdit?: () => void;
  suppressError?: boolean;
}) {
  const message = props.message;
  const send = optimisticSend(message);
  const copyText =
    message.role === "assistant" && !message.streaming
      ? messageCopyText(message)
      : "";
  const editCopy = message.role === "user" ? messageCopyText(message) : "";
  const showEdit = Boolean(props.canEdit && editCopy && !send && !props.editing);
  return (
    <article className={`chat-message ${message.role}`}>
      <div className="chat-message-role">
        <span>{message.role === "user" ? "You" : "Agent"}</span>
        <time>{formatTime(message.createdAt)}</time>
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
              </div>
            ) : null}
            {message.parts.length === 0 && !message.metadata?.error ? (
              <div className="message-empty">No content</div>
            ) : message.parts.length === 0 && props.suppressError ? (
              <div className="message-empty">Provider error reported below.</div>
            ) : (
              message.parts.map((part, index) => (
                <MessagePartView
                  part={part}
                  key={index}
                  client={props.client}
                  resource={props.resource}
                />
              ))
            )}
          </>
        )}
      </div>
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

function AgentActivity(props: {
  messages: Message[];
  client: HubClient;
  resource: ResourceContext;
}) {
  const working = props.messages.some((message) => message.streaming);
  const failed = props.messages.some((message) =>
    message.parts.some((part) => part.type === "tool" && part.status === "error"),
  );
  const events = props.messages.reduce((total, message) => total + message.parts.length, 0);
  const stepLabel = `${props.messages.length} ${props.messages.length === 1 ? "step" : "steps"}`;
  const eventLabel = `${events} ${events === 1 ? "event" : "events"}`;
  return (
    <article className="chat-activity">
      <details className="message-aux chat-activity-details">
        <summary>
          <span className="message-aux-label">Agent activity</span>
          <span className="message-aux-meta">
            {stepLabel} · {eventLabel}
          </span>
          {failed ? <span className="tool-status error">error</span> : null}
          {working ? <span className="streaming-label">working</span> : null}
          <span className="message-aux-chevron" aria-hidden="true">
            <Icon name="chevron-right" size={14} />
          </span>
        </summary>
        <div className="chat-activity-body">
          {props.messages.map((message) => (
            <div className="activity-step" key={message.id}>
              <div className="activity-step-time">{formatTime(message.createdAt)}</div>
              <div className="chat-message-parts">
                {message.parts.map((part, index) => (
                  <MessagePartView
                    part={part}
                    key={index}
                    client={props.client}
                    resource={props.resource}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </article>
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
  onClose: () => void;
  onMarkRead: () => void;
  onInterrupt: () => void;
  onOpenSession: (ref: string) => void;
}) {
  const { session, provider } = props;
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [forking, setForking] = useState(false);
  const [forkError, setForkError] = useState<string>();
  const asideRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const providerUrl =
    safeExternalURL(session.nativeUrl) ?? safeExternalURL(provider?.baseUrl);
  const tokens = session.tokens;
  const totalTokens =
    tokens?.total ??
    (tokens?.input !== undefined || tokens?.output !== undefined
      ? (tokens.input ?? 0) + (tokens.output ?? 0)
      : undefined);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (window.matchMedia("(max-width: 1319px)").matches) {
      closeRef.current?.focus();
    }
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  useEffect(() => {
    if (!window.matchMedia("(max-width: 1319px)").matches) return;
    const aside = asideRef.current;
    if (!aside) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = aside.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    aside.addEventListener("keydown", onKeyDown);
    return () => aside.removeEventListener("keydown", onKeyDown);
  }, []);

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

  return (
    <aside
      className="chat-details"
      id="session-details"
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
          <div className="chat-details-label">State</div>
          <div className="detail">
            <span>Status</span>
            <span className={`status-chip detail-chip ${session.status}`}>
              <i />
              {statusLabel(session.status)}
            </span>
          </div>
          <Detail label="Created" value={formatDateTime(session.createdAt)} />
          <Detail label="Updated" value={formatDateTime(session.updatedAt)} />
        </section>

        {session.cost !== undefined || tokens ? (
          <section className="chat-details-section">
            <div className="chat-details-label">Usage</div>
            {session.cost !== undefined ? (
              <Detail label="Cost" value={`$${session.cost.toFixed(2)}`} />
            ) : null}
            {totalTokens !== undefined ? (
              <Detail label="Tokens" value={formatTokenSummary(tokens, totalTokens)} />
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
          {forkError ?? notice ?? ""}
        </span>
      </div>
    </aside>
  );
}

function Markdown(props: {
  text: string;
  client: HubClient;
  resource: ResourceContext;
}) {
  const html = useMemo(
    () =>
      renderMarkdown(props.text, props.resource),
    [
      props.text,
      props.resource.baseUrl,
      props.resource.providerID,
      props.resource.providerType,
      props.resource.directory,
    ],
  );
  const containerRef = useRef<HTMLDivElement | null>(null);
  const providerID = props.resource.providerID;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !providerID) return;
    let cancelled = false;
    const created: string[] = [];
    const images = Array.from(
      container.querySelectorAll<HTMLImageElement>("img[data-attachment-url]"),
    );

    for (const image of images) {
      const target = image.dataset.attachmentUrl;
      if (!target) continue;
      void props.client
        .attachment(providerID, target)
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          created.push(url);
          image.addEventListener(
            "error",
            () => {
              if (cancelled) return;
              const fallback = document.createElement("span");
              fallback.className = "message-image-missing";
              fallback.textContent = image.alt?.trim() || "Image unavailable";
              image.replaceWith(fallback);
            },
            { once: true },
          );
          image.src = url;
          image.removeAttribute("data-attachment-url");
        })
        .catch(() => {
          if (cancelled) return;
          const fallback = document.createElement("span");
          fallback.className = "message-image-missing";
          fallback.textContent = image.alt?.trim() || "Image unavailable";
          image.replaceWith(fallback);
        });
    }

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [html, props.client, providerID]);

  return (
    <div
      className="message-markdown"
      ref={containerRef}
      onClick={(event) => {
        const anchor = (event.target as HTMLElement).closest(
          "a[data-attachment-url]",
        );
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const target = anchor.dataset.attachmentUrl;
        if (!target || !providerID) return;
        event.preventDefault();
        void downloadAttachment(
          props.client,
          providerID,
          target,
          anchor.dataset.attachmentName ?? "attachment",
        ).catch(() => {
          const href = anchor.getAttribute("href");
          if (href) window.open(href, "_blank", "noopener,noreferrer");
        });
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function MessagePartView(props: {
  part: MessagePart;
  client: HubClient;
  resource: ResourceContext;
}) {
  const part = props.part;
  if (part.type === "text") {
    return (
      <Markdown
        text={part.text}
        client={props.client}
        resource={props.resource}
      />
    );
  }
  if (part.type === "reasoning") {
    return (
      <details className="message-aux message-reasoning">
        <summary>
          <span className="message-aux-label">Reasoning</span>
          <span className="message-aux-meta">{part.text.length.toLocaleString()} chars</span>
          <span className="message-aux-chevron" aria-hidden="true">
            <Icon name="chevron-right" size={14} />
          </span>
        </summary>
        <div className="message-aux-body">
          <Markdown
            text={part.text}
            client={props.client}
            resource={props.resource}
          />
        </div>
      </details>
    );
  }
  if (part.type === "tool") {
    return (
      <details className="message-aux message-tool">
        <summary>
          <span className="message-aux-label">{toolLabel(part.name)}</span>
          <span className={`tool-status ${part.status}`}>{part.status}</span>
          <span className="message-aux-chevron" aria-hidden="true">
            <Icon name="chevron-right" size={14} />
          </span>
        </summary>
        <div className="message-aux-body">
          {part.input !== undefined ? (
            <>
              <span className="tool-section-label">Input</span>
              <pre>{formatJson(part.input)}</pre>
            </>
          ) : null}
          {part.output !== undefined ? (
            <>
              <span className="tool-section-label">Output</span>
              <pre>{formatJson(part.output)}</pre>
            </>
          ) : null}
        </div>
      </details>
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

async function downloadAttachment(
  client: HubClient,
  providerID: string,
  url: string,
  name: string,
): Promise<void> {
  const blob = await client.attachment(providerID, url);
  saveBlob(blob, name);
}

function saveBlob(blob: Blob, name: string): void {
  const objectURL = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectURL;
  anchor.download = (name || "attachment").replace(/[\\/]/g, "_");
  anchor.rel = "noreferrer";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
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

const TOOL_LABELS: Record<string, string> = {
  bash: "Shell",
  shell: "Shell",
  execute: "Execute",
  edit: "Edit",
  write: "Write",
  read: "Read",
  grep: "Search files",
  glob: "Find files",
  task: "Task",
  webfetch: "Fetch",
  websearch: "Web search",
  apply_patch: "Patch",
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name.toLowerCase()] ?? name;
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

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection fallback for non-secure origins.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus({ preventScroll: true });
  textarea.select();
  textarea.setSelectionRange(0, text.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
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
        Back to Foundation
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function providerErrorMessage(value: unknown): string {
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  if (typeof value === "string" && value.trim()) return value;
  return "The provider reported an error.";
}
