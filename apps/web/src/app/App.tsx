import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AssistantView,
  Attention,
  AttentionType,
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
import { renderMarkdown } from "./markdown";

const TOKEN_KEY = "oktoso-token";
const THEME_KEY = "oktoso-theme";
const SESSION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
  const [auth, setAuth] = useState<AuthState>("checking");
  const [client, setClient] = useState<HubClient | null>(null);
  const [health, setHealth] = useState<Health>();
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerEditor, setProviderEditor] = useState<
    { mode: "add" | "edit"; provider?: Provider } | undefined
  >();
  const [attentionCount, setAttentionCount] = useState(0);
  const [connection, setConnection] = useState<ConnectionStatus>("connecting");
  const [events, setEvents] = useState<HubEvent[]>([]);
  const [checkingProviders, setCheckingProviders] = useState(false);
  const [error, setError] = useState<string>();
  const [loginError, setLoginError] = useState<string>();
  const [loginBusy, setLoginBusy] = useState(false);
  const signingOut = useRef(false);
  const didRefresh = useRef(false);
  const [selectedSessionRef, setSelectedSessionRef] = useState<string>();
  const lastSeq = useRef(0);
  const attentionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    setProviderEditor(undefined);
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
            onClick={() => setProviderEditor({ mode: "add" })}
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
                onClick={() => setProviderEditor({ mode: "edit", provider })}
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
          onClose={() => setProviderEditor(undefined)}
          onSaved={(saved) => {
            setProviders((current) => {
              const index = current.findIndex((item) => item.id === saved.id);
              if (index < 0) return [...current, saved];
              return current.map((item) => (item.id === saved.id ? saved : item));
            });
            setProviderEditor(undefined);
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
    <div className="app-shell">
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
                <span className="rail-mark">
                  {item.mark}
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
          <div className="topbar-title-block">
            <h1 className="topbar-title">{current.label}</h1>
            <span className="topbar-sub">{current.sub}</span>
          </div>
          <div className="topbar-spacer" />
          <span className={`status-chip ${connectionClass(connection)}`}>
            <i />
            {connectionLabel(connection)}
          </span>
          <button className="icon-btn" type="button" onClick={toggleTheme} aria-label="Toggle theme">
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <button className="btn small" type="button" onClick={signOut}>
            Disconnect
          </button>
        </header>

        <main className="content" ref={contentRef}>
          <div className="page">
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
                      {checkingProviders ? "Checking health…" : "Dev harness"}
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
                <section className="hero">
                  <div>
                    <p className="eyebrow">Providers</p>
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
              <Placeholder view={view} onBack={() => setView("foundation")} />
            )}

            <footer className="page-footer">
              <span>Design reference: design-v1.1</span>
              <span>{current.sub}</span>
            </footer>
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
                <span className="bottom-mark">
                  {item.mark}
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
        {props.theme === "dark" ? "☀" : "☾"}
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
            <p>Optional speech-to-text path for G2 and future wearable microphone input.</p>
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
      <section className="hero">
        <div>
          <p className="eyebrow">Attention · Phase 3</p>
          <h2>What needs you now</h2>
          <p>
            Approvals, questions, unread sessions, and failures. Actions are sent
            through the provider and never auto-approved.
          </p>
        </div>
        <button className="btn small" type="button" disabled={loading} onClick={() => void load()}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </section>

      {error ? (
        <div className="alert" role="alert">
          {error}
          <button className="text-button" type="button" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      <div className="inbox-tabs">
        {ATTENTION_FILTERS.map(([value, label]) => (
          <button
            className={`chip ${filter === value ? "active" : ""}`}
            type="button"
            key={value}
            onClick={() => setFilter(value)}
          >
            {label} {count(value)}
          </button>
        ))}
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
    <article className={`attention-card ${item.priority === "blocking" ? "blocking" : ""}`}>
      <div className="attention-top">
        <span className={`type-badge ${item.type}`}>{ATTENTION_LABELS[item.type]}</span>
        <span className="attention-provider">{providerLabel(item.sessionRef.split(":")[0] ?? "")}</span>
        <span className="attention-age">{relativeTime(item.createdAt)}</span>
      </div>
      <div className="attention-title">{item.title}</div>
      <div className="attention-summary">{item.summary}</div>

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
        <button className="attention-open" type="button" onClick={props.onOpen}>
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
      <section className="hero">
        <div>
          <p className="eyebrow">Search · Phase 6</p>
          <h2>Search sessions</h2>
          <p>
            Find sessions across every provider by title, project, directory, or
            agent. Message content is not searched yet.
          </p>
        </div>
      </section>

      <section className="panel search-panel">
        <label className="sr-only" htmlFor="session-search">
          Search sessions
        </label>
        <input
          id="session-search"
          ref={inputRef}
          className="search-input"
          type="search"
          value={query}
          placeholder="Search sessions…"
          autoComplete="off"
          spellCheck={false}
          onChange={(event) =>
            setQuery((event.currentTarget as HTMLInputElement).value)
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              setQuery("");
            }
          }}
        />

        <div className="search-filters" role="group" aria-label="Provider filter">
          <span className="search-filter-label">Provider</span>
          <button
            className={`chip ${provider === "all" ? "active" : ""}`}
            type="button"
            aria-pressed={provider === "all"}
            onClick={() => setProvider("all")}
          >
            All
          </button>
          {props.providers.map((item) => (
            <button
              className={`chip ${provider === item.id ? "active" : ""}`}
              type="button"
              key={item.id}
              aria-pressed={provider === item.id}
              onClick={() => setProvider(item.id)}
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
            onClick={() => setStatus("all")}
          >
            Any
          </button>
          {(["running", "idle", "error", "offline"] as const).map((value) => (
            <button
              className={`chip ${status === value ? "active" : ""}`}
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
          Type a query or choose a provider or status filter to search the hub
          session cache.
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

  const liveSeq =
    props.events.find(
      (event) =>
        event.type.startsWith("session.") || event.type === "resync",
    )?.seq ?? 0;
  useEffect(() => {
    if (!liveSeq) return;
    const timer = setTimeout(() => void load(), 500);
    return () => clearTimeout(timer);
  }, [liveSeq]);

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">Phase 2</p>
          <h2>All sessions</h2>
          <p>
            Sessions from every connected provider, with a live transcript and
            follow-up composer. The separate inbox handles unread work and failures.
          </p>
        </div>
        <div className="hero-actions">
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
          <span className="mode-badge">Read + write · Phase 2</span>
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

type DraftStatus = "idle" | "saving" | "saved" | "error";

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
  const pendingScroll = useRef<PendingScroll | undefined>(undefined);
  const messagesRef = useRef<Message[]>([]);
  const processedSeq = useRef(props.events[0]?.seq ?? 0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
      setMessages((current) => mergeMessages(current, latest));
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
      setMessages((current) => mergeMessages(current, upserts));
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

  return (
    <>
      <div className="chat-view-head">
        <button className="btn ghost small" type="button" onClick={props.onBack}>
          ← Sessions
        </button>
        <div className="chat-view-title-block">
          <span className="chat-view-title">{session?.title ?? "Session"}</span>
          {session ? (
            <span className="chat-view-sub">
              {providerLabel(session.providerID)} · {session.status}
            </span>
          ) : null}
        </div>
        <div className="chat-head-actions">
          <span className="mode-badge">Writable · Phase 2</span>
          {session?.status === "running" ? (
            <button
              className="btn small"
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
        <div className="empty">Loading session…</div>
      ) : error && !session ? (
        <div className="alert" role="alert">
          {error}
          <button className="text-button" type="button" onClick={props.onBack}>
            Back
          </button>
        </div>
      ) : session ? (
        <>
          <section className="hero chat-hero">
            <div>
              <p className="eyebrow">Session</p>
              <h2>{session.title}</h2>
              <div className="chat-meta">
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
                    <span className="mono">{session.model}</span>
                  </>
                ) : null}
                <span className={`status-chip ${session.status}`}>
                  <i />
                  {session.status}
                </span>
              </div>
            </div>
          </section>

          {error ? (
            <div className="alert" role="alert">
              {error}
            </div>
          ) : null}

          {sendError ? (
            <div className="alert" role="alert">
              {sendError}
            </div>
          ) : null}

          <section className="chat-panel" aria-label="Session transcript" ref={transcriptRef}>
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
            ) : messages.length > 0 ? (
              <div className="chat-history-control">
                <span className="chat-history-note">Beginning of session</span>
              </div>
            ) : null}

            {messages.length === 0 ? (
              <div className="empty">No messages returned by the provider.</div>
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
            className="chat-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <textarea
              rows={2}
              value={draft}
              placeholder={`Reply to ${session.title}…`}
              onChange={(event) => updateDraft((event.currentTarget as HTMLTextAreaElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className="chat-composer-bar">
              <span className={`composer-hint ${draftStatus === "error" ? "error" : ""}`}>
                {draftStatusLabel(draftStatus)}
              </span>
              <button
                className="btn primary small"
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

function mergeMessages(current: Message[], incoming: Message[]): Message[] {
  if (incoming.length === 0) return current;
  const byID = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byID.set(message.id, message);
  return [...byID.values()].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id),
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
    <article className={`chat-message ${message.role}`}>
      <div className="chat-message-role">
        <span>{message.role}</span>
        <time>{formatTime(message.createdAt)}</time>
        {message.streaming ? <span className="streaming-label">streaming</span> : null}
      </div>
      <div className="chat-message-parts">
        {message.metadata?.error ? (
          <div className="form-error" role="alert">
            Provider error: {formatJson(message.metadata.error)}
          </div>
        ) : null}
        {message.parts.length === 0 && !message.metadata?.error ? (
          <div className="message-empty">No content</div>
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
    <article className="chat-activity">
      <details className="message-aux chat-activity-details">
        <summary>
          <span className="message-aux-label">Agent activity</span>
          <span className="message-aux-meta">
            {props.messages.length} steps · {events} events
          </span>
          {failed ? <span className="tool-status error">error</span> : null}
          {working ? <span className="streaming-label">working</span> : null}
        </summary>
        <div className="chat-activity-body">
          {props.messages.map((message) => (
            <div className="activity-step" key={message.id}>
              <div className="activity-step-time">{formatTime(message.createdAt)}</div>
              <div className="chat-message-parts">
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
      className="message-markdown"
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
      <details className="message-aux message-reasoning">
        <summary>
          <span className="message-aux-label">Reasoning</span>
          <span className="message-aux-meta">{part.text.length.toLocaleString()} chars</span>
        </summary>
        <div className="message-aux-body">
          <Markdown text={part.text} />
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
    const href = safeExternalURL(part.url);
    return (
      <div className="message-file">
        <span className="message-file-name">{part.name}</span>
        {part.mimeType ? <span className="message-file-meta">{part.mimeType}</span> : null}
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">
            Open
          </a>
        ) : null}
      </div>
    );
  }
  return (
    <details className="message-aux message-unknown">
      <summary>
        <span className="message-aux-label">Unsupported content</span>
      </summary>
      <div className="message-aux-body">
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
    <section className="hero placeholder">
      <div>
        <p className="eyebrow">Phase {item.phase}</p>
        <h2>{item.label} is next</h2>
        <p>{item.description} The Foundation shell is live; this screen will be wired to the hub in its phase.</p>
      </div>
      <button className="btn small" type="button" onClick={props.onBack}>
        Back to Foundation
      </button>
    </section>
  );
}

function Detail(props: { label: string; value: string }) {
  return (
    <div className="detail">
      <span>{props.label}</span>
      <strong className="mono">{props.value}</strong>
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
