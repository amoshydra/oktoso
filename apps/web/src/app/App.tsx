import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type {
  Diagnostics,
  Health,
  HubEvent,
  Provider,
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
    sub: "Session index · Phase 1",
    phase: "1",
    description: "The provider-backed session index and read-only chat.",
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
  const lastSeq = useRef(0);
  const contentRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [view]);

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
                onClick={() => setView(id)}
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
                    <button class="btn small" type="button" onClick={() => setView("providers")}>
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
                onClick={() => setView(id)}
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
