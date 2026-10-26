import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type {
  Diagnostics,
  Health,
  HubEvent,
  Message,
  MessagePart,
  Provider,
  ProviderOptions,
  Session,
} from "@agent-hub/contracts";
import {
  HubClient,
  HubError,
  type ConnectionStatus,
} from "@agent-hub/client";

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
    sub: "OpenCode read/write · Phase 2",
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
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const [error, setError] = useState<string>();
  const [loginError, setLoginError] = useState<string>();
  const [loginBusy, setLoginBusy] = useState(false);
  const [selectedSessionRef, setSelectedSessionRef] = useState<string>();
  const lastSeq = useRef(0);
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [view, selectedSessionRef]);

  const selectView = (next: View) => {
    if (next === "sessions") setSelectedSessionRef(undefined);
    setView(next);
  };

  const signOut = useCallback(() => {
    sessionStorage.removeItem(TOKEN_KEY);
    setToken("");
    setClient(null);
    setAuth("signed-out");
    setHealth(undefined);
    setDiagnostics(undefined);
    setProviders([]);
    setEvents([]);
    setError(undefined);
  }, []);

  const loadSnapshot = useCallback(async (hub: HubClient) => {
    const [nextHealth, nextProviders, nextDiagnostics] = await Promise.all([
      hub.health(),
      hub.providers(),
      hub.diagnostics(),
    ]);
    setHealth(nextHealth);
    setProviders(nextProviders);
    setDiagnostics(nextDiagnostics);
    return { health: nextHealth, providers: nextProviders, diagnostics: nextDiagnostics };
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
        },
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setConnection("closed");
        if (reason instanceof HubError && reason.status === 401) signOut();
        else setError(reason instanceof Error ? reason.message : "Event stream failed");
      });

    return () => controller.abort();
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
          <p>Configured endpoints and health checks. Adapters arrive in Phase 1.</p>
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
              >
                <span class="rail-mark">{item.mark}</span>
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
                      The hub API, authentication, durable state, event bus, and
                      development provider harness are connected. Product screens arrive
                      in the next slice.
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
            ) : view === "sessions" ? (
              selectedSessionRef ? (
                <SessionDetail
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
                  onOpen={setSelectedSessionRef}
                />
              )
            ) : view === "providers" ? (
              <>
                <section class="hero">
                  <div>
                    <p class="eyebrow">Phase 0</p>
                    <h2>Provider health</h2>
                    <p>
                      These are the configured provider endpoints. The health checks are
                      live; sessions, messages, and capabilities are the next slice.
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
                    <span class="mono">design-v1 · v{health?.version ?? "0.1.0"}</span>
                  </article>
                </section>
                {diagnosticsPanel}
              </>
            ) : (
              <Placeholder view={view} onBack={() => setView("foundation")} />
            )}

            <footer class="page-footer">
              <span>Design reference: design-v1</span>
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
              >
                <span class="bottom-mark">{item.mark}</span>
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
          <h2>OpenCode sessions</h2>
          <p>
            Live session index, transcript, and follow-up composer. New-session
            creation and attention arrive in the next slices.
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
                    {providerLabel(session.providerID)} · {session.project ?? session.directory ?? "unknown project"}
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

function SessionDetail(props: {
  client: HubClient;
  sessionRef: string;
  events: HubEvent[];
  onBack: () => void;
}) {
  const [session, setSession] = useState<Session>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [interrupting, setInterrupting] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string>();
  const [sendError, setSendError] = useState<string>();

  const refresh = async () => {
    const [nextSession, page] = await Promise.all([
      props.client.session(props.sessionRef),
      props.client.messages(props.sessionRef, { limit: 100, order: "asc" }),
    ]);
    setSession(nextSession);
    setMessages(page.data);
    setCursor(page.cursor.next);
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(undefined);
    try {
      await props.client.sendMessage(props.sessionRef, { text });
      setDraft("");
      setSession((current) => (current ? { ...current, status: "running" } : current));
      window.setTimeout(() => void refresh().catch(() => undefined), 500);
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
      await refresh();
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "Unable to interrupt");
    } finally {
      setInterrupting(false);
    }
  };

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await props.client.messages(props.sessionRef, { cursor, limit: 50 });
      setMessages((current) => [...current, ...page.data]);
      setCursor(page.cursor.next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load more messages");
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    refresh()
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
  }, [props.client, props.sessionRef]);

  const liveSeq =
    props.events.find((event) => event.sessionRef === props.sessionRef)?.seq ?? 0;
  useEffect(() => {
    if (!liveSeq) return;
    const timer = setTimeout(() => {
      void refresh().catch(() => undefined);
    }, 600);
    return () => clearTimeout(timer);
  }, [liveSeq, props.client, props.sessionRef]);

  return (
    <>
      <div class="chat-view-head">
        <button class="btn ghost small" type="button" onClick={props.onBack}>
          ← Sessions
        </button>
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
                <span>·</span>
                <span>{session.project ?? session.directory ?? "unknown project"}</span>
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

          <section class="chat-panel" aria-label="Session transcript">
            {messages.length === 0 ? (
              <div class="empty">No messages returned by the provider.</div>
            ) : (
              messages.map((message) => (
                <article class={`chat-message ${message.role}`} key={message.id}>
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
                    {message.parts.map((part, index) => (
                      <MessagePartView part={part} key={index} />
                    ))}
                  </div>
                </article>
              ))
            )}
            {cursor ? (
              <button
                class="btn small load-more"
                type="button"
                disabled={loadingMore}
                onClick={() => void loadMore()}
              >
                {loadingMore ? "Loading…" : "Load more messages"}
              </button>
            ) : null}
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
              onInput={(event) => setDraft((event.currentTarget as HTMLTextAreaElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div class="chat-composer-bar">
              <span class="composer-hint">Ctrl/⌘ Enter to send</span>
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

function MessagePartView(props: { part: MessagePart }) {
  const part = props.part;
  if (part.type === "text") {
    return <div class="message-text">{part.text}</div>;
  }
  if (part.type === "reasoning") {
    return (
      <details class="message-reasoning">
        <summary>Reasoning</summary>
        <pre>{part.text}</pre>
      </details>
    );
  }
  if (part.type === "tool") {
    return (
      <details class="message-tool">
        <summary>
          <span class="mono">{part.name}</span>
          <span class={`tool-status ${part.status}`}>{part.status}</span>
        </summary>
        {part.input !== undefined ? (
          <pre>{formatJson(part.input)}</pre>
        ) : null}
        {part.output !== undefined ? (
          <pre>{formatJson(part.output)}</pre>
        ) : null}
      </details>
    );
  }
  return null;
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
