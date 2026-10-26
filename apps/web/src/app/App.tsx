import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type {
  Attention,
  AttentionType,
  Diagnostics,
  Health,
  HubEvent,
  Message,
  MessagePart,
  Provider,
  ProviderOptions,
  Session,
  SessionStatus,
} from "@agent-hub/contracts";
import {
  HubClient,
  HubError,
  type ConnectionStatus,
} from "@agent-hub/client";
import { renderMarkdown } from "./markdown";

const TOKEN_KEY = "agent-hub-token";
const THEME_KEY = "agent-hub-theme";

type AuthState = "checking" | "signed-out" | "signed-in";
type View = "foundation" | "inbox" | "sessions" | "search" | "providers" | "settings";

const VIEW_META: Record<
  View,
  { label: string; mark: string; sub: string; phase: string; description: string }
> = {
  foundation: {
    label: "Foundation",
    mark: "F",
    sub: "Hub runtime · Phase 0",
    phase: "0",
    description: "Hub runtime, authentication, state, and the event stream.",
  },
  inbox: {
    label: "Inbox",
    mark: "I",
    sub: "Attention · Phase 3",
    phase: "3",
    description: "The unified approval, question, unread, and error inbox.",
  },
  sessions: {
    label: "Sessions",
    mark: "S",
    sub: "All providers · Phase 2",
    phase: "2",
    description: "The provider-backed session index, transcript, and composer.",
  },
  search: {
    label: "Search",
    mark: "/",
    sub: "Search · Phase 6",
    phase: "6",
    description: "Session, project, and message search across providers.",
  },
  providers: {
    label: "Providers",
    mark: "P",
    sub: "Provider health · Phase 0",
    phase: "0",
    description: "Configured endpoints, health, and capability discovery.",
  },
  settings: {
    label: "Settings",
    mark: "G",
    sub: "Runtime and preferences · Phase 0",
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

export function App() {
  const [theme, setTheme] = useState(
    document.documentElement.dataset.theme === "light" ? "light" : "dark",
  );
  const [view, setView] = useState<View>("foundation");
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) ?? "");
  const [auth, setAuth] = useState<AuthState>(token ? "checking" : "signed-out");
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
  const [selectedSessionRef, setSelectedSessionRef] = useState<string>();
  const lastSeq = useRef(0);
  const attentionTimer = useRef<ReturnType<typeof setTimeout>>();
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [view, selectedSessionRef]);

  useEffect(() => {
    if (auth !== "signed-in") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView("search");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [auth]);

  const selectView = (next: View) => {
    if (next === "sessions") setSelectedSessionRef(undefined);
    setView(next);
  };

  const openSession = (ref: string) => {
    setSelectedSessionRef(ref);
    setView("sessions");
  };

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
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
    if (!token) {
      setAuth("signed-out");
      return;
    }

    let cancelled = false;
    const hub = new HubClient({ token });
    setClient(hub);
    setAuth("checking");

    hub
      .authCheck()
      .then(async () => {
        if (cancelled) return;
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
          setEvents((current) => [event, ...current].slice(0, 12));
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
      <div class="login-page">
        <div class="login-card boot-card">
          <div class="brand-mark">AH</div>
          <h1>Agent Hub</h1>
          <p>Checking the hub connection…</p>
          <div class="loading-line" />
        </div>
      </div>
    );
  }

  const providerPanel = (
    <article class="panel">
      <div class="panel-head">
        <div>
          <h2>Providers</h2>
          <p>Configured endpoints, health, versions, and normalized capabilities.</p>
        </div>
        <button
          class="btn small"
          type="button"
          disabled={checkingProviders}
          onClick={() => client && void checkProviders(client)}
        >
          {checkingProviders ? "Checking…" : "Recheck"}
        </button>
      </div>
      <div class="provider-list">
        {providers.length === 0 ? (
          <div class="empty">No providers configured.</div>
        ) : (
          providers.map((provider) => (
            <div class="provider-row" key={provider.id}>
              <div class="provider-mark">{providerMark(provider.type)}</div>
              <div class="provider-main">
                <strong>{provider.name}</strong>
                <span class="mono">{provider.baseUrl}</span>
              </div>
              {import.meta.env.DEV && isFakeProvider(provider.baseUrl) ? (
                <span class="dev-badge">fake</span>
              ) : null}
              <span class={`status-chip ${provider.status}`}>
                <i />
                {provider.status}
              </span>
            </div>
          ))
        )}
      </div>
    </article>
  );

  const diagnosticsPanel = (
    <section class="panel diagnostics">
      <div class="panel-head">
        <div>
          <h2>Diagnostics</h2>
          <p>Safe operational state. No provider credentials or message bodies.</p>
        </div>
      </div>
      <div class="details-grid">
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
    <div class="app-shell">
      <aside class="rail" aria-label="Primary navigation">
        <div class="rail-logo" aria-label="Agent Hub">
          AH
        </div>
        <nav class="rail-nav">
          {RAIL_VIEWS.map((id) => {
            const item = VIEW_META[id];
            return (
              <button
                class={`rail-item ${view === id ? "active" : ""}`}
                type="button"
                aria-current={view === id ? "page" : undefined}
                onClick={() => selectView(id)}
                title={item.label}
                aria-label={
                  id === "inbox" && attentionCount > 0
                    ? `${item.label}, ${attentionAria}`
                    : item.label
                }
              >
                <span class="rail-mark">
                  {item.mark}
                  {id === "inbox" && attentionCount > 0 ? (
                    <span class="nav-badge">{badge}</span>
                  ) : null}
                </span>
                <span class="rail-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div class="rail-footer">
          <span class={`status-dot ${connection === "open" ? "online" : "offline"}`} />
          <span>{connection === "open" ? "Live" : "Offline"}</span>
        </div>
      </aside>

      <div class="main-column">
        <header class="topbar">
          <div class="topbar-title-block">
            <h1 class="topbar-title">{current.label}</h1>
            <span class="topbar-sub">{current.sub}</span>
          </div>
          <div class="topbar-spacer" />
          <span class={`status-chip ${connectionClass(connection)}`}>
            <i />
            {connectionLabel(connection)}
          </span>
          <button class="icon-btn" type="button" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button class="btn small" type="button" onClick={signOut}>
            Disconnect
          </button>
        </header>

        <main class="content" ref={contentRef}>
          <div class="page">
            {view === "foundation" ? (
              <>
                <section class="hero">
                  <div>
                    <p class="eyebrow">Agent Hub</p>
                    <h2>Runtime online</h2>
                    <p>
                      The hub API, authentication, durable state, event bus, and provider
                      adapters are connected. Sessions and attention are live; search and
                      deployment hardening are next.
                    </p>
                  </div>
                  <div class="hero-badge">
                    <span class="status-dot online" />
                    v{health?.version ?? "0.1.0"}
                  </div>
                </section>

                {error ? (
                  <div class="alert" role="alert">
                    {error}
                    <button class="text-button" type="button" onClick={() => setError(undefined)}>
                      Dismiss
                    </button>
                  </div>
                ) : null}

                <section class="status-grid" aria-label="Runtime status">
                  <article class="card">
                    <div class="card-label">Hub</div>
                    <strong class="card-value">{health ? "Connected" : "Waiting"}</strong>
                    <span class="card-meta">
                      Uptime {formatUptime(health?.uptimeMs ?? 0)} · seq {health?.eventSeq ?? 0}
                    </span>
                  </article>
                  <article class="card">
                    <div class="card-label">Event stream</div>
                    <strong class="card-value">{connectionLabel(connection)}</strong>
                    <span class="card-meta">
                      {events.length} received · cursor {lastSeq.current}
                    </span>
                  </article>
                  <article class="card">
                    <div class="card-label">Providers</div>
                    <strong class="card-value">
                      {providers.filter((provider) => provider.status === "online").length} /{" "}
                      {providers.length} online
                    </strong>
                    <span class="card-meta">
                      {checkingProviders ? "Checking health…" : "Dev harness"}
                    </span>
                  </article>
                  <article class="card">
                    <div class="card-label">State</div>
                    <strong class="card-value">{diagnostics?.storage.kind ?? "—"}</strong>
                    <span class="card-meta">Node {diagnostics?.node ?? "—"}</span>
                  </article>
                </section>

                <section class="grid-two">
                  {providerPanel}
                  <article class="panel">
                    <div class="panel-head">
                      <div>
                        <h2>Event stream</h2>
                        <p>Authenticated SSE with replay and heartbeat.</p>
                      </div>
                      <span class="mono">after={lastSeq.current}</span>
                    </div>
                    {events.length === 0 ? (
                      <div class="empty">
                        Connected. New hub events will appear here as the provider slices land.
                      </div>
                    ) : (
                      <div class="event-list">
                        {events.map((event) => (
                          <div class="event-row" key={`${event.seq}-${event.type}`}>
                            <span class="event-seq">#{event.seq}</span>
                            <span class="event-type">{event.type}</span>
                            <span class="event-time">{formatTime(event.at)}</span>
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
                onOpen={openSession}
              />
            ) : view === "sessions" ? (
              selectedSessionRef ? (
                <SessionDetail
                  key={selectedSessionRef}
                  client={client as HubClient}
                  sessionRef={selectedSessionRef}
                  events={events}
                  onBack={() => setSelectedSessionRef(undefined)}
                />
              ) : (
                <SessionsView
                  client={client as HubClient}
                  events={events}
                  providers={providers}
                  onOpen={openSession}
                />
              )
            ) : view === "search" ? (
              <SearchView
                client={client as HubClient}
                providers={providers}
                onOpen={openSession}
              />
            ) : view === "providers" ? (
              <>
                <section class="hero">
                  <div>
                    <p class="eyebrow">Providers</p>
                    <h2>Provider health</h2>
                    <p>
                      Configured provider endpoints, health, versions, and normalized
                      capabilities. Provider credentials remain on the hub.
                    </p>
                  </div>
                </section>
                {providerPanel}
                {diagnosticsPanel}
              </>
            ) : view === "settings" ? (
              <>
                <section class="grid-two">
                  <article class="panel">
                    <div class="panel-head">
                      <div>
                        <h2>Appearance</h2>
                        <p>Theme is stored locally in this browser.</p>
                      </div>
                    </div>
                    <button class="btn small" type="button" onClick={toggleTheme}>
                      Use {theme === "dark" ? "light" : "dark"} theme
                    </button>
                  </article>
                  <article class="panel">
                    <div class="panel-head">
                      <div>
                        <h2>Providers</h2>
                        <p>Provider connections move under Providers.</p>
                      </div>
                    </div>
                    <button class="btn small" type="button" onClick={() => selectView("providers")}>
                      Open providers
                    </button>
                  </article>
                  <article class="panel">
                    <div class="panel-head">
                      <div>
                        <h2>Session</h2>
                        <p>The hub token is held only for this tab.</p>
                      </div>
                    </div>
                    <button class="btn small" type="button" onClick={signOut}>
                      Disconnect
                    </button>
                  </article>
                  <article class="panel">
                    <div class="panel-head">
                      <div>
                        <h2>About</h2>
                        <p>Frozen reference and runtime build.</p>
                      </div>
                    </div>
                    <span class="mono">design-v1.1 · v{health?.version ?? "0.1.0"}</span>
                  </article>
                </section>
                {diagnosticsPanel}
              </>
            ) : (
              <Placeholder view={view} onBack={() => setView("foundation")} />
            )}

            <footer class="page-footer">
              <span>Design reference: design-v1.1</span>
              <span>{current.sub}</span>
            </footer>
          </div>
        </main>

        <nav class="bottom-nav" aria-label="Mobile navigation">
          {BOTTOM_VIEWS.map((id) => {
            const item = VIEW_META[id];
            return (
              <button
                class={`bottom-btn ${view === id ? "active" : ""}`}
                type="button"
                aria-current={view === id ? "page" : undefined}
                onClick={() => selectView(id)}
                aria-label={
                  id === "inbox" && attentionCount > 0
                    ? `${item.label}, ${attentionAria}`
                    : item.label
                }
              >
                <span class="bottom-mark">
                  {item.mark}
                  {id === "inbox" && attentionCount > 0 ? (
                    <span class="nav-badge">{badge}</span>
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

  return (
    <div class="login-page">
      <button class="icon-btn login-theme" type="button" onClick={props.onToggleTheme} aria-label="Toggle theme">
        {props.theme === "dark" ? "☀" : "☾"}
      </button>
      <div class="login-card">
        <div class="brand-mark">AH</div>
        <p class="eyebrow">Agent Hub</p>
        <h1>One workbench for your agents.</h1>
        <p class="login-copy">
          Enter the hub token. Provider credentials stay on the hub and never reach this client.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (value.trim()) void props.onSubmit(value.trim());
          }}
        >
          <label class="field-label" for="hub-token">
            Hub token
          </label>
          <input
            id="hub-token"
            class="token-input"
            type="password"
            autocomplete="off"
            spellcheck={false}
            placeholder="Paste your bearer token"
            value={value}
            onInput={(event) => setValue((event.currentTarget as HTMLInputElement).value)}
          />
          {props.error ? (
            <div class="form-error" role="alert">
              {props.error}
            </div>
          ) : null}
          <button class="btn primary login-submit" type="submit" disabled={props.busy || !value.trim()}>
            {props.busy ? "Connecting…" : "Connect to hub"}
          </button>
        </form>
        {import.meta.env.DEV && import.meta.env.VITE_DEV_TOKEN ? (
          <p class="dev-hint">
            Development token prefilled from <span class="mono">VITE_DEV_TOKEN</span>.
          </p>
        ) : null}
        <p class="login-footnote">
          Single-owner build. The token is held in this tab's session storage.
        </p>
      </div>
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

function InboxView(props: {
  client: HubClient;
  events: HubEvent[];
  onOpen: (ref: string) => void;
}) {
  const [items, setItems] = useState<Attention[]>([]);
  const [filter, setFilter] = useState("all");
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
    void load();
    const timer = setInterval(() => void load(true), 15_000);
    return () => clearInterval(timer);
  }, [props.client]);

  const liveSeq = props.events[0]?.seq ?? 0;
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
      <section class="hero">
        <div>
          <p class="eyebrow">Attention · Phase 3</p>
          <h2>What needs you now</h2>
          <p>
            Approvals, questions, unread sessions, and failures. Actions are sent
            through the provider and never auto-approved.
          </p>
        </div>
        <button class="btn small" type="button" disabled={loading} onClick={() => void load()}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </section>

      {error ? (
        <div class="alert" role="alert">
          {error}
          <button class="text-button" type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      <div class="inbox-tabs">
        {ATTENTION_FILTERS.map(([value, label]) => (
          <button
            class={`chip ${filter === value ? "active" : ""}`}
            type="button"
            onClick={() => setFilter(value)}
          >
            {label} {count(value)}
          </button>
        ))}
      </div>

      {loading && items.length === 0 ? (
        <div class="empty">Loading attention…</div>
      ) : visible.length === 0 ? (
        <div class="empty">Nothing needs you right now.</div>
      ) : (
        groups
          .filter(([, groupItems]) => groupItems.length > 0)
          .map(([label, groupItems]) => (
            <section class="inbox-group" key={label}>
              <div class="inbox-group-head">
                <span>{label}</span>
                <span class="line" />
                <span>{groupItems.length}</span>
              </div>
              {groupItems.map((item) => (
                <AttentionCard
                  item={item}
                  key={item.id}
                  busy={busyID === item.id}
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

function AttentionCard(props: {
  item: Attention;
  busy: boolean;
  onAction: (action: string, input?: Record<string, unknown>) => void;
  onOpen: () => void;
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
    <article class={`attention-card ${item.priority === "blocking" ? "blocking" : ""}`}>
      <div class="attention-top">
        <span class={`type-badge ${item.type}`}>{ATTENTION_LABELS[item.type]}</span>
        <span class="attention-provider">{providerLabel(item.sessionRef.split(":")[0] ?? "")}</span>
        <span class="attention-age">{relativeTime(item.createdAt)}</span>
      </div>
      <div class="attention-title">{item.title}</div>
      <div class="attention-summary">{item.summary}</div>

      {hasFields ? (
        <div class="attention-fields">
          {item.fields?.map((field) => (
            <AttentionFieldInput
              field={field}
              value={values[field.id]}
              onValue={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
            />
          ))}
        </div>
      ) : null}

      <div class="attention-actions">
        {item.actions
          .filter((action) => action.id !== "answer")
          .map((action) => (
            <button
              class={`btn small ${action.style === "primary" ? "primary" : action.style === "danger" ? "danger" : ""}`}
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
            class="btn primary small"
            type="button"
            disabled={props.busy || missingRequired.length > 0}
            onClick={() => props.onAction("answer", actionInput())}
          >
            {answerAction.label}
          </button>
        ) : null}
        {answerAction && missingRequired.length > 0 ? (
          <span class="attention-required">
            Complete {missingRequired.map((field) => field.label).join(", ")}
          </span>
        ) : null}
        <button class="attention-open" type="button" onClick={props.onOpen}>
          Open session
        </button>
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
      <label class="attention-check">
        <input
          type="checkbox"
          checked={Boolean(props.value)}
          onInput={(event) => props.onValue((event.currentTarget as HTMLInputElement).checked)}
        />
        <span>{field.label}</span>
        {field.description ? <small class="attention-help">{field.description}</small> : null}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <label class="attention-field">
        <span>{field.label}</span>
        <select
          value={typeof props.value === "string" ? props.value : ""}
          onInput={(event) => props.onValue((event.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">Choose…</option>
          {(field.options ?? []).map((option) => (
            <option value={option.value}>{option.label}</option>
          ))}
        </select>
        {field.description ? <small class="attention-help">{field.description}</small> : null}
      </label>
    );
  }
  if (field.type === "multiselect") {
    const selected = Array.isArray(props.value) ? (props.value as string[]) : [];
    return (
      <fieldset class="attention-field attention-multi">
        <legend>{field.label}</legend>
        {(field.options ?? []).map((option) => (
          <label class="attention-check" key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onInput={(event) => {
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
        {field.description ? <small class="attention-help">{field.description}</small> : null}
      </fieldset>
    );
  }
  if (field.type === "textarea") {
    return (
      <label class="attention-field attention-field-wide">
        <span>{field.label}</span>
        <textarea
          rows={3}
          value={typeof props.value === "string" ? props.value : ""}
          placeholder={field.placeholder}
          onInput={(event) => props.onValue((event.currentTarget as HTMLTextAreaElement).value)}
        />
        {field.description ? <small class="attention-help">{field.description}</small> : null}
      </label>
    );
  }
  return (
    <label class={`attention-field ${field.type === "number" ? "" : "attention-field-wide"}`}>
      <span>{field.label}</span>
      <input
        type={field.type === "number" ? "number" : "text"}
        value={typeof props.value === "string" || typeof props.value === "number" ? props.value : ""}
        placeholder={field.placeholder}
        onInput={(event) => {
          const value = (event.currentTarget as HTMLInputElement).value;
          props.onValue(
            field.type === "number" ? (value === "" ? "" : Number(value)) : value,
          );
        }}
      />
      {field.description ? <small class="attention-help">{field.description}</small> : null}
    </label>
  );
}

function SearchView(props: {
  client: HubClient;
  providers: Provider[];
  onOpen: (ref: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState<SessionStatus | "all">("all");
  const [results, setResults] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);

  const trimmed = query.trim();
  const hasFilters = provider !== "all" || status !== "all";

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
      <section class="hero">
        <div>
          <p class="eyebrow">Search · Phase 6</p>
          <h2>Search sessions</h2>
          <p>
            Find sessions across every provider by title, project, directory, or
            agent. Message content is not searched yet.
          </p>
        </div>
      </section>

      <section class="panel search-panel">
        <label class="sr-only" for="session-search">
          Search sessions
        </label>
        <input
          id="session-search"
          ref={inputRef}
          class="search-input"
          type="search"
          value={query}
          placeholder="Search sessions…"
          autocomplete="off"
          spellcheck={false}
          onInput={(event) =>
            setQuery((event.currentTarget as HTMLInputElement).value)
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setQuery("");
            }
          }}
        />

        <div class="search-filters" role="group" aria-label="Provider filter">
          <span class="search-filter-label">Provider</span>
          <button
            class={`chip ${provider === "all" ? "active" : ""}`}
            type="button"
            aria-pressed={provider === "all"}
            onClick={() => setProvider("all")}
          >
            All
          </button>
          {props.providers.map((item) => (
            <button
              class={`chip ${provider === item.id ? "active" : ""}`}
              type="button"
              key={item.id}
              aria-pressed={provider === item.id}
              onClick={() => setProvider(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>

        <div class="search-filters" role="group" aria-label="Status filter">
          <span class="search-filter-label">Status</span>
          <button
            class={`chip ${status === "all" ? "active" : ""}`}
            type="button"
            aria-pressed={status === "all"}
            onClick={() => setStatus("all")}
          >
            Any
          </button>
          {(["running", "idle", "error", "offline"] as const).map((value) => (
            <button
              class={`chip ${status === value ? "active" : ""}`}
              type="button"
              key={value}
              aria-pressed={status === value}
              onClick={() => setStatus(value)}
            >
              {statusLabel(value)}
            </button>
          ))}
        </div>
      </section>

      {error ? (
        <div class="alert" role="alert">
          {error}
          <button
            class="text-button"
            type="button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry
          </button>
        </div>
      ) : null}

      {!trimmed && !hasFilters ? (
        <div class="empty">
          Type a query or choose a provider or status filter to search the hub
          session cache.
        </div>
      ) : loading && results.length === 0 ? (
        <div class="empty">Searching sessions…</div>
      ) : !loading && results.length === 0 && !error ? (
        <div class="empty">
          No sessions match {trimmed ? `“${trimmed}”` : "these filters"}.
        </div>
      ) : results.length > 0 ? (
        <section class="panel search-results-panel" aria-busy={loading}>
          <div class="panel-head">
            <div>
              <h2>Results</h2>
              <p role="status">{resultSummary}</p>
            </div>
            <span class="mode-badge">Session metadata</span>
          </div>
          <div class={`session-list ${loading ? "search-loading" : ""}`}>
            {results.map((session) => (
              <button
                class={`session-list-item ${session.unread ? "unread" : ""}`}
                type="button"
                key={session.ref}
                onClick={() => props.onOpen(session.ref)}
                aria-label={searchResultLabel(session)}
              >
                <span class={`session-status-dot ${session.status}`} />
                <span class="session-list-main">
                  <strong>{session.title}</strong>
                  <span class="session-list-meta">
                    {providerLabel(session.providerID)}
                    {session.project || session.directory ? (
                      <> · {session.project ?? session.directory}</>
                    ) : null}
                    {session.agent ? <> · {session.agent}</> : null}
                  </span>
                </span>
                <span class="session-list-side">
                  {session.attention ? (
                    <span class={`type-badge ${session.attention.type}`}>
                      {ATTENTION_LABELS[session.attention.type]}
                    </span>
                  ) : null}
                  {session.unread ? <span class="sr-only">Unread</span> : null}
                  <span class="mono">{relativeTime(session.updatedAt)}</span>
                  <span class={`status-chip ${session.status}`}>
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
  onOpen: (ref: string) => void;
}) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
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
    void load();
  }, [props.client]);

  const liveSeq = props.events[0]?.seq ?? 0;
  useEffect(() => {
    if (!liveSeq) return;
    const timer = setTimeout(() => void load(), 500);
    return () => clearTimeout(timer);
  }, [liveSeq]);

  return (
    <>
      <section class="hero">
        <div>
          <p class="eyebrow">Phase 2</p>
          <h2>All sessions</h2>
          <p>
            Sessions from every connected provider, with a live transcript and
            follow-up composer. The separate inbox handles unread work and failures.
          </p>
        </div>
        <div class="hero-actions">
          <button
            class="btn small"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <button
            class="btn primary small"
            type="button"
            disabled={props.providers.every((provider) => !provider.capabilities.create)}
            onClick={() => setShowNew(true)}
          >
            New session
          </button>
        </div>
      </section>

      {showNew ? (
        <NewSessionForm
          client={props.client}
          providers={props.providers}
          onClose={() => setShowNew(false)}
          onCreated={(ref) => {
            setShowNew(false);
            props.onOpen(ref);
          }}
        />
      ) : null}

      {error ? (
        <div class="alert" role="alert">
          {error}
          <button class="text-button" type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>All sessions</h2>
            <p>{sessions.length} sessions · newest first</p>
          </div>
          <span class="mode-badge">Read + write · Phase 2</span>
        </div>
        {loading && sessions.length === 0 ? (
          <div class="empty">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div class="empty">No sessions returned by the provider.</div>
        ) : (
          <div class="session-list">
            {sessions.map((session) => (
              <button
                class={`session-list-item ${session.unread ? "unread" : ""}`}
                type="button"
                key={session.ref}
                onClick={() => props.onOpen(session.ref)}
              >
                <span class={`session-status-dot ${session.status}`} />
                <span class="session-list-main">
                  <strong>{session.title}</strong>
                  <span class="session-list-meta">
                    {providerLabel(session.providerID)}
                    {session.project || session.directory ? (
                      <> · {session.project ?? session.directory}</>
                    ) : null}
                  </span>
                </span>
                <span class="session-list-side">
                  <span class="mono">{relativeTime(session.updatedAt)}</span>
                  <span class={`status-chip ${session.status}`}>
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
            class="btn small load-more"
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
    <section class="panel new-session-panel">
      <div class="panel-head">
        <div>
          <h2>New session</h2>
          <p>Create an OpenCode session and optionally send the first prompt.</p>
        </div>
        <button class="btn ghost small" type="button" onClick={props.onClose}>
          Close
        </button>
      </div>

      {creatable.length === 0 ? (
        <div class="empty">No configured provider supports session creation.</div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div class="form-grid">
            <label class="form-field">
              <span>Provider</span>
              <select value={providerID} onInput={(event) => setProviderID((event.currentTarget as HTMLSelectElement).value)}>
                {creatable.map((provider) => (
                  <option value={provider.id}>{provider.name}</option>
                ))}
              </select>
            </label>
            <label class="form-field">
              <span>Title</span>
              <input
                value={title}
                placeholder="Investigate auth race"
                onInput={(event) => setTitle((event.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <label class="form-field span-2">
              <span>Project directory</span>
              <input
                value={directory}
                list="new-session-directories"
                placeholder="/home/me/agent-hub"
                onInput={(event) => setDirectory((event.currentTarget as HTMLInputElement).value)}
              />
              <datalist id="new-session-directories">
                {(options?.directories ?? []).map((item) => <option value={item} />)}
              </datalist>
            </label>
            <label class="form-field">
              <span>Agent</span>
              <select value={agent} disabled={loading} onInput={(event) => setAgent((event.currentTarget as HTMLSelectElement).value)}>
                {(options?.agents ?? []).map((item) => <option value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label class="form-field">
              <span>Model</span>
              <select value={model} disabled={loading} onInput={(event) => setModel((event.currentTarget as HTMLSelectElement).value)}>
                {(options?.models ?? []).map((item) => <option value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <label class="form-field span-2">
              <span>First prompt</span>
              <textarea
                rows={3}
                value={prompt}
                placeholder="Start by reading the auth middleware."
                onInput={(event) => setPrompt((event.currentTarget as HTMLTextAreaElement).value)}
              />
            </label>
          </div>

          {loading ? <div class="form-note">Loading provider options…</div> : null}
          {error ? <div class="form-error" role="alert">{error}</div> : null}

          <div class="form-actions">
            <button class="btn small" type="button" onClick={props.onClose}>
              Cancel
            </button>
            <button class="btn primary small" type="submit" disabled={loading || submitting || !title.trim() || !providerID}>
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

type DraftStatus = "idle" | "saving" | "saved" | "error";

function useSessionDraft(client: HubClient, sessionRef: string) {
  const [text, setTextState] = useState("");
  const [status, setStatus] = useState<DraftStatus>("idle");
  const textRef = useRef("");
  const revisionRef = useRef(0);
  const lastSavedRef = useRef<string | null>(null);
  const activeRef = useRef(sessionRef);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const statusTimerRef = useRef<ReturnType<typeof setTimeout>>();
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

function SessionDetail(props: {
  client: HubClient;
  sessionRef: string;
  events: HubEvent[];
  onBack: () => void;
}) {
  const [session, setSession] = useState<Session>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const { text: draft, status: draftStatus, update: updateDraft, discard: discardDraft } =
    useSessionDraft(props.client, props.sessionRef);
  const [error, setError] = useState<string>();
  const [sendError, setSendError] = useState<string>();
  const transcriptRef = useRef<HTMLElement | null>(null);
  const pendingScroll = useRef<PendingScroll>();
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const getScroller = () =>
    (transcriptRef.current?.closest(".content") as HTMLElement | null) ?? null;

  const nearBottom = () => {
    const scroller = getScroller();
    if (!scroller) return true;
    return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 240;
  };

  const refreshLatest = useCallback(
    async (forceBottom = false) => {
      const [nextSession, page] = await Promise.all([
        props.client.session(props.sessionRef),
        props.client.messages(props.sessionRef, {
          limit: MESSAGE_PAGE_SIZE,
          order: "desc",
        }),
      ]);
      const latest = [...page.data].reverse();
      const stick = forceBottom || nearBottom();
      setSession(nextSession);
      setMessages((current) => {
        if (current.length === 0) return latest;
        const latestByID = new Map(latest.map((message) => [message.id, message]));
        const merged = current.map((message) => latestByID.get(message.id) ?? message);
        const seen = new Set(merged.map((message) => message.id));
        for (const message of latest) {
          if (seen.has(message.id)) continue;
          seen.add(message.id);
          merged.push(message);
        }
        return merged;
      });
      setOlderCursor((current) => current ?? page.cursor.next);
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

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(undefined);
    try {
      await props.client.sendMessage(props.sessionRef, { text });
      await discardDraft();
      setSession((current) => (current ? { ...current, status: "running" } : current));
      window.setTimeout(() => void refreshLatest(true).catch(() => undefined), 500);
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "Unable to send the prompt");
    } finally {
      setSending(false);
    }
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

  useEffect(() => {
    let cancelled = false;
    pendingScroll.current = undefined;
    setSession(undefined);
    setMessages([]);
    setOlderCursor(null);
    setLoading(true);
    setError(undefined);
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
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [props.client, props.sessionRef, refreshLatest]);

  const liveSeq =
    props.events.find((event) => event.sessionRef === props.sessionRef)?.seq ?? 0;
  useEffect(() => {
    if (!liveSeq) return;
    const timer = setTimeout(() => {
      void refreshLatest().catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [liveSeq, refreshLatest]);

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

  return (
    <>
      <div class="chat-view-head">
        <button class="btn ghost small" type="button" onClick={props.onBack}>
          ← Sessions
        </button>
        <div class="chat-view-title-block">
          <span class="chat-view-title">{session?.title ?? "Session"}</span>
          {session ? (
            <span class="chat-view-sub">
              {providerLabel(session.providerID)} · {session.status}
            </span>
          ) : null}
        </div>
        <div class="chat-head-actions">
          <span class="mode-badge">Writable · Phase 2</span>
          {session?.status === "running" ? (
            <button
              class="btn small"
              type="button"
              disabled={interrupting}
              onClick={() => void interrupt()}
            >
              {interrupting ? "Interrupting…" : "Interrupt"}
            </button>
          ) : null}
        </div>
      </div>

      {loading && !session ? (
        <div class="empty">Loading session…</div>
      ) : error && !session ? (
        <div class="alert" role="alert">
          {error}
          <button class="text-button" type="button" onClick={props.onBack}>
            Back
          </button>
        </div>
      ) : session ? (
        <>
          <section class="hero chat-hero">
            <div>
              <p class="eyebrow">Session</p>
              <h2>{session.title}</h2>
              <div class="chat-meta">
                <span>{providerLabel(session.providerID)}</span>
                {session.project || session.directory ? (
                  <>
                    <span>·</span>
                    <span>{session.project ?? session.directory}</span>
                  </>
                ) : null}
                {session.agent ? (
                  <>
                    <span>·</span>
                    <span>{session.agent}</span>
                  </>
                ) : null}
                {session.model ? (
                  <>
                    <span>·</span>
                    <span class="mono">{session.model}</span>
                  </>
                ) : null}
                <span class={`status-chip ${session.status}`}>
                  <i />
                  {session.status}
                </span>
              </div>
            </div>
          </section>

          {error ? (
            <div class="alert" role="alert">
              {error}
            </div>
          ) : null}

          {sendError ? (
            <div class="alert" role="alert">
              {sendError}
            </div>
          ) : null}

          <section class="chat-panel" aria-label="Session transcript" ref={transcriptRef}>
            {olderCursor ? (
              <div class="chat-history-control">
                <button
                  class="btn small"
                  type="button"
                  disabled={loadingOlder}
                  onClick={() => void loadOlder()}
                >
                  {loadingOlder ? "Loading older…" : "Load older messages"}
                </button>
              </div>
            ) : messages.length > 0 ? (
              <div class="chat-history-control">
                <span class="chat-history-note">Beginning of session</span>
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div class="empty">No messages returned by the provider.</div>
            ) : (
              groupTranscript(messages).map((item) =>
                item.kind === "message" ? (
                  <TranscriptMessage message={item.message} key={item.message.id} />
                ) : (
                  <AgentActivity messages={item.messages} key={item.key} />
                ),
              )
            )}
          </section>

          <form
            class="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              rows={2}
              value={draft}
              placeholder={`Reply to ${session.title}…`}
              onInput={(event) => updateDraft((event.currentTarget as HTMLTextAreaElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div class="chat-composer-bar">
              <span class={`composer-hint ${draftStatus === "error" ? "error" : ""}`}>
                {draftStatusLabel(draftStatus)}
              </span>
              <button
                class="btn primary small"
                type="submit"
                disabled={sending || !draft.trim()}
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </>
      ) : null}
    </>
  );
}

type TranscriptItem =
  | { kind: "message"; message: Message }
  | { kind: "activity"; messages: Message[]; key: string };

function groupTranscript(messages: Message[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  let activity: Message[] = [];
  const flush = () => {
    if (activity.length === 0) return;
    items.push({
      kind: "activity",
      messages: activity,
      key: `activity:${activity[0]!.id}:${activity[activity.length - 1]!.id}`,
    });
    activity = [];
  };
  for (const message of messages) {
    if (isActivityMessage(message)) {
      activity.push(message);
    } else {
      flush();
      items.push({ kind: "message", message });
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

function TranscriptMessage(props: { message: Message }) {
  const message = props.message;
  return (
    <article class={`chat-message ${message.role}`}>
      <div class="chat-message-role">
        <span>{message.role}</span>
        <time>{formatTime(message.createdAt)}</time>
        {message.streaming ? <span class="streaming-label">streaming</span> : null}
      </div>
      <div class="chat-message-parts">
        {message.metadata?.error ? (
          <div class="form-error" role="alert">
            Provider error: {formatJson(message.metadata.error)}
          </div>
        ) : null}
        {message.parts.length === 0 && !message.metadata?.error ? (
          <div class="message-empty">No content</div>
        ) : (
          message.parts.map((part, index) => (
            <MessagePartView part={part} key={index} />
          ))
        )}
      </div>
    </article>
  );
}

function AgentActivity(props: { messages: Message[] }) {
  const working = props.messages.some((message) => message.streaming);
  const failed = props.messages.some((message) =>
    message.parts.some((part) => part.type === "tool" && part.status === "error"),
  );
  const events = props.messages.reduce((total, message) => total + message.parts.length, 0);
  return (
    <article class="chat-activity">
      <details class="message-aux chat-activity-details">
        <summary>
          <span class="message-aux-label">Agent activity</span>
          <span class="message-aux-meta">
            {props.messages.length} steps · {events} events
          </span>
          {failed ? <span class="tool-status error">error</span> : null}
          {working ? <span class="streaming-label">working</span> : null}
        </summary>
        <div class="chat-activity-body">
          {props.messages.map((message) => (
            <div class="activity-step" key={message.id}>
              <div class="activity-step-time">{formatTime(message.createdAt)}</div>
              <div class="chat-message-parts">
                {message.parts.map((part, index) => (
                  <MessagePartView part={part} key={index} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>
    </article>
  );
}

function Markdown(props: { text: string }) {
  const html = useMemo(() => renderMarkdown(props.text), [props.text]);
  return (
    <div
      class="message-markdown"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function MessagePartView(props: { part: MessagePart }) {
  const part = props.part;
  if (part.type === "text") {
    return <Markdown text={part.text} />;
  }
  if (part.type === "reasoning") {
    return (
      <details class="message-aux message-reasoning">
        <summary>
          <span class="message-aux-label">Reasoning</span>
          <span class="message-aux-meta">{part.text.length.toLocaleString()} chars</span>
        </summary>
        <div class="message-aux-body">
          <Markdown text={part.text} />
        </div>
      </details>
    );
  }
  if (part.type === "tool") {
    return (
      <details class="message-aux message-tool">
        <summary>
          <span class="message-aux-label">{toolLabel(part.name)}</span>
          <span class={`tool-status ${part.status}`}>{part.status}</span>
        </summary>
        <div class="message-aux-body">
          {part.input !== undefined ? (
            <>
              <span class="tool-section-label">Input</span>
              <pre>{formatJson(part.input)}</pre>
            </>
          ) : null}
          {part.output !== undefined ? (
            <>
              <span class="tool-section-label">Output</span>
              <pre>{formatJson(part.output)}</pre>
            </>
          ) : null}
        </div>
      </details>
    );
  }
  if (part.type === "file") {
    const href = safeExternalURL(part.url);
    return (
      <div class="message-file">
        <span class="message-file-name">{part.name}</span>
        {part.mimeType ? <span class="message-file-meta">{part.mimeType}</span> : null}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            Open
          </a>
        ) : null}
      </div>
    );
  }
  return (
    <details class="message-aux message-unknown">
      <summary>
        <span class="message-aux-label">Unsupported content</span>
      </summary>
      <div class="message-aux-body">
        <pre>{formatJson(part.raw)}</pre>
      </div>
    </details>
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
    <section class="hero placeholder">
      <div>
        <p class="eyebrow">Phase {item.phase}</p>
        <h2>{item.label} is next</h2>
        <p>{item.description} The Foundation shell is live; this screen will be wired to the hub in its phase.</p>
      </div>
      <button class="btn small" type="button" onClick={props.onBack}>
        Back to Foundation
      </button>
    </section>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <div class="detail">
      <span>{props.label}</span>
      <strong class="mono">{props.value}</strong>
    </div>
  );
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
    second: "2-digit",
  });
}
