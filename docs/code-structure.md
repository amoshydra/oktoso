# Agent Hub — Implementation Plan and Code Structure

Status: proposed implementation shape. Milestones and acceptance criteria live in [`plan.md`](plan.md); architecture lives in [`design.md`](design.md); UI rules live in [`ui-ia.md`](ui-ia.md) and [`visual-audit.md`](visual-audit.md).

The prototype is the visual reference. It is not the production client source. The production app should extract its tokens and patterns, then rebuild the behavior against the real API.

## 1. What is still missing

The architecture covers the provider model and API, but implementation needs these systems before the UI can become real:

| System | Why it is needed |
|---|---|
| Generated contract layer | Runtime validation, TypeScript types, and OpenAPI must not drift |
| Config and secret resolution | Provider URLs and credentials must be validated without leaking |
| Hub auth and client login | Every API call and SSE stream needs an owner/session credential, sent as Bearer or the paired HttpOnly cookie |
| Storage abstraction | Read markers, attention state, drafts, idempotency, sequence number |
| Resumable event bus | Reconnect without losing or duplicating state |
| Provider sync runtime | Health, polling, streaming, backoff, and cache ownership |
| Provider options | New-session UI needs agents, models, directories, and defaults |
| Attention engine | Dedupe, priority, actions, resolution, and optimistic UI |
| Read-state service | Unread must survive restarts and sync across clients |
| In-process send jobs | Open WebUI and Hermes streams need lifecycle beyond one request |
| Fake provider servers | Development and CI cannot depend on live provider instances |
| Client core | Shared API, SSE, retries, and reconciliation for every client |
| Web data layer | Query cache, mutations, and live event reconciliation |
| Diagnostics | Provider health, sync lag, event backlog, storage state |
| Build and deployment | Single Node bundle, static web assets, Termux/systemd/Docker |
| CI and visual tests | Contract, provider, SSE, and responsive regressions |

These are the difference between a working prototype and a hub that can be operated every day.

## 2. Decisions to lock before scaffolding

Recommended defaults:

| Decision | Recommendation | Why |
|---|---|---|
| Server HTTP layer | Hono on Node 24 | Small, typed, streaming-friendly, pure JavaScript |
| Contract source | Zod schemas in `packages/contracts`; generate OpenAPI | One source for validation, types, and the Rust-facing contract |
| Persistence | JSON state store first, behind `StateStore`; optional `node:sqlite` adapter later | Portable, no native modules, enough for single-owner state |
| Web client | React + Vite + TypeScript | Mature ecosystem, broad chat/UI libraries, future WebXR reuse |
| Web server state | TanStack Query's React adapter (planned) | Cache, pagination, mutations, and invalidation are already solved |
| Local web state | React state (`useState` / `useReducer`) | Selected session, filters, sheets, and transient UI |
| SSE client | `fetch()` streaming, not `EventSource` | `EventSource` cannot send the `Authorization` header |
| Provider style | Provider adapters behind one interface; capabilities decide UI | No provider-specific logic in the web client |
| Test runtime | Vitest for unit/integration, Playwright for web/visual | Fast tests plus a real browser matrix |
| Deployment | One Node process serving API and built web assets | Same origin, no CORS by default, easy Termux deployment |

If node:http or SQLite-first is preferred, change it now. The package boundaries below survive either choice.

Why these two:

- **Hono** is chosen for routing, middleware, streaming/SSE, and tests through `app.request`, while staying small and Web-Standards based. It is not a performance claim over raw `node:http`; it removes plumbing we would otherwise own.
- **React** is chosen for ecosystem compatibility, especially chat runtimes such as assistant-ui and TanStack Query. The web client accepts the larger bundle because it is a self-hosted operator surface, not a bundle-sensitive embed. React is not a constraint on the API; the hub and client contract survive a framework change.

Both are implementation choices, not part of the client contract. The OpenAPI/SSE boundary is what matters. React was adopted before any candidate chat runtime; assistant-ui and TanStack Query are options, not current dependencies.

Runtime policy: Node 24 is the minimum supported floor. CI also runs Node 26, which becomes Active LTS on 2026-10-28. Do not target Node 22; it is in Maintenance LTS and reaches end of life in April 2027. Node 24 remains supported through April 2028, which is the safer Termux baseline while 26 packaging catches up.

The contract is generated from the Zod schemas and checked into `docs/openapi.yaml`. Do not edit the YAML by hand; run `pnpm openapi:generate` after schema changes and `pnpm openapi:check` in CI.

## 3. Repository tree

```text
agent-hub/
  apps/
    web/
      src/
        main.tsx
        app/
          App.tsx
          router.tsx
          shell/
            AppShell.tsx
            Rail.tsx
            Topbar.tsx
            BottomNav.tsx
        routes/
          InboxRoute.tsx
          SessionsRoute.tsx
          ChatRoute.tsx
          ProvidersRoute.tsx
          SettingsRoute.tsx
          SearchRoute.tsx
          LoginRoute.tsx
        features/
          inbox/
          sessions/
          chat/
          attention/
          providers/
          settings/
          search/
        data/
          query-keys.ts
          queries.ts
          mutations.ts
          event-sync.ts
        lib/
          auth.ts
          format.ts
          qr-scanner.ts
        styles/
        pwa/
      index.html
      vite.config.ts
      package.json

  packages/
    contracts/
      src/
        common.ts
        sessions.ts
        messages.ts
        attention.ts
        providers.ts
        events.ts
        errors.ts
        options.ts
        openapi.ts
        index.ts
      test/
      package.json

    providers/
      src/
        types.ts
        errors.ts
        http/
          client.ts
          sse.ts
        opencode/
          adapter.ts
          client.ts
          normalize.ts
          events.ts
          permissions.ts
        openwebui/
          adapter.ts
          client.ts
          normalize.ts
          tree.ts
          stream.ts
        hermes/
          adapter.ts
          api-client.ts
          tui-gateway.ts
          normalize.ts
        registry.ts
        index.ts
      test/
        fixtures/
      package.json

    storage/
      src/
        state.ts
        state-store.ts
        json-store.ts
        memory-store.ts
        atomic-file.ts
        migrations/
        index.ts
      test/
      package.json

    hub/
      src/
        main.ts
        app.ts
        config/
          schema.ts
          load.ts
          env.ts
        domain/
          ids.ts
          errors.ts
          session.ts
          attention.ts
          event.ts
        auth/
          session.ts
          pairing.ts
          service.ts
          cookies.ts
        cli/
          args.ts
          hub-status.ts
          log-file.ts
          pairing-panel.ts
          terminal.ts
          tui.ts
          types.ts
          urls.ts
        services/
          provider-registry.ts
          sync-service.ts
          session-service.ts
          message-service.ts
          send-job.ts
          attention-service.ts
          read-service.ts
          options-service.ts
          search-service.ts
          event-bus.ts
          idempotency.ts
          diagnostics-service.ts
        http/
          middleware/
            auth.ts
            errors.ts
            request-id.ts
            security.ts
          auth-cookie.ts
          origin.ts
          routes/
            auth.ts
            pair.ts
            health.ts
            providers.ts
            sessions.ts
            attention.ts
            events.ts
            search.ts
            diagnostics.ts
          presenters.ts
        lib/
          logger.ts
          redact.ts
          pairing-prompt.ts
          clock.ts
          sse.ts
        test/
      package.json

    client/
      src/
        hub-client.ts
        event-stream.ts
        sse-parser.ts
        errors.ts
        query-keys.ts
        index.ts
      test/
      package.json

    ui/
      src/
        tokens.css
        base.css
        components/
          Button.tsx
          Badge.tsx
          Card.tsx
          Sheet.tsx
          Field.tsx
          EmptyState.tsx
        icons.tsx
        index.ts
      package.json

    testing/
      src/
        fake-provider.ts
        builders.ts
        fixtures.ts
      package.json

  tools/
    fake-providers/
      server.ts
      fixtures/
    seed/
      seed.ts

  tests/
    contract/
    integration/
    e2e/
    visual/
    load/

  scripts/
    generate-openapi.ts
    dev.ts
    build.ts

  docs/
  AGENTS.md
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  vitest.config.ts
  playwright.config.ts
  eslint.config.js
  hub.config.example.json
  Dockerfile
  .github/workflows/ci.yml
```

`packages/testing` is a development-only package. It contains in-process fake adapters, state builders, and fixtures. It is never imported by the hub runtime or the web bundle. `tools/fake-providers` wraps those fixtures as HTTP servers for `pnpm dev` and E2E scenarios.

Package names:

| Path | Package |
|---|---|
| `packages/contracts` | `@agent-hub/contracts` |
| `packages/providers` | `@agent-hub/providers` |
| `packages/storage` | `@agent-hub/storage` |
| `packages/hub` | `@agent-hub/hub` |
| `packages/client` | `@agent-hub/client` |
| `packages/ui` | `@agent-hub/ui` |
| `packages/testing` | `@agent-hub/testing` |
| `apps/web` | `@agent-hub/web` |

This refines the Milestone 1 sketch: the old `packages/shared` is split into `packages/contracts` for the wire/domain contract and the service layer inside `packages/hub`. It is not kept as a catch-all.

## 4. Dependency rules

```text
contracts
  ├── providers   (adapter types, wire shapes)
  ├── storage     (hub-owned state shapes)
  ├── client      (API types and error shapes)
  └── hub         (domain and HTTP shapes)

providers ──┐
storage ────┼──> hub ──> Node process
client ─────┴──> web
ui ─────────────> web
```

Rules:

- `packages/contracts` has no Node, browser, Hono, or database imports.
- `packages/providers` never imports `hub`, Hono, storage, or UI.
- `packages/storage` never imports providers or HTTP code.
- `packages/hub` is the only place that knows Hono, process lifecycle, and the provider registry.
- `packages/client` has no DOM and no React. It works in web, VR, and a device shell.
- `packages/ui` owns visual tokens and primitives. It does not fetch data.
- `apps/web` composes client, UI, and route state. It never calls a provider directly.
- No package imports from `docs/prototypes`.

This keeps the Rust port boundary clean: replace `hub`, `providers`, and `storage`; keep contracts and clients.

## 5. Runtime systems

### 5.1 Composition root

`packages/hub/src/main.ts` should do only this:

1. Load and validate config.
2. Resolve environment secrets.
3. Create the store, event bus, provider registry, and services.
4. Build the Hono app with `createApp(deps)`.
5. Start listening, serve the built web assets, and add SPA fallback for web routes.
6. Install graceful shutdown: stop accepting requests, close provider streams, flush state, stop the process.

`createApp(deps)` is exported so tests can run routes without a network listener.

### 5.2 Provider adapter contract

Extend the existing interface with the missing read and options surfaces:

```ts
interface ProviderAdapter {
  readonly id: string;
  readonly type: string;
  readonly capabilities: ProviderCapabilities;

  health(signal: AbortSignal): Promise<ProviderHealth>;
  listSessions(query: SessionQuery, signal: AbortSignal): Promise<SessionPage>;
  getSession(ref: string, signal: AbortSignal): Promise<Session>;
  getMessages(ref: string, query: MessageQuery, signal: AbortSignal): Promise<MessagePage>;
  sendMessage(ref: string, input: SendInput, signal: AbortSignal): Promise<SendResult>;
  createSession(input: CreateSessionInput, signal: AbortSignal): Promise<Session>;

  interrupt?(ref: string, signal: AbortSignal): Promise<void>;
  listAttention?(signal: AbortSignal): Promise<Attention[]>;
  actOnAttention?(id: string, action: AttentionAction, signal: AbortSignal): Promise<void>;
  getOptions?(signal: AbortSignal): Promise<ProviderOptions>;
  markRead?(ref: string, signal: AbortSignal): Promise<void>;
  subscribe?(onEvent: (event: ProviderEvent) => void, signal: AbortSignal): Promise<() => void>;
}
```

Every adapter owns:

- auth header construction;
- provider request and response mapping;
- provider error normalization;
- provider event normalization;
- capability declaration;
- provider-specific quirks.

Every adapter is forbidden from:

- writing hub events directly;
- reading hub storage;
- formatting UI strings;
- logging credentials or message bodies.

### 5.3 Provider sync runtime

One `ProviderRuntime` per configured provider:

```text
unknown
  └─ check ──> online | auth-error | offline
                 │
                 ├─ list sessions
                 ├─ subscribe (if supported)
                 ├─ poll (fallback)
                 └─ backoff with jitter
```

Responsibilities:

- health checks with per-provider timeouts;
- list sessions with bounded concurrency;
- maintain a provider cursor and last successful sync;
- subscribe to OpenCode SSE and Hermes event surfaces;
- poll Open WebUI and providers without a stream;
- deduplicate events by provider event ID;
- apply reconnect backoff and jitter;
- expose `lastSyncAt`, `lastError`, `nextRetryAt`, and health.

Session and message caches are in memory, bounded, and TTL-based. They are not a replacement for provider history. On restart, the hub re-fetches the provider state and emits a resync boundary.

### 5.4 Session and message services

- `SessionService` owns the merged session index across providers.
- `MessageService` owns per-session message pages.
- `SendJobService` owns long-running provider sends, streaming parts, cancellation, and write-back. Jobs are in-process for the first release. On restart, an interrupted job is marked incomplete and the provider remains canonical.
- Both are write-through to memory caches and emit domain events.
- List requests merge provider pages by `updatedAt`; the hub cursor contains per-provider cursors and the last sort key.
- Message cursors are provider cursors wrapped in an opaque hub cursor.
- Single-flight prevents duplicate provider fetches.

### 5.5 Attention engine

`AttentionService` is a domain service, not an inbox component.

Responsibilities:

- normalize permission, approval, question, unread, and error states;
- deduplicate by stable attention ID;
- apply priority: blocking, high, normal;
- load pending provider attention on startup and reconnect;
- reconcile resolved items during sync;
- lock actions so a double approve cannot fire twice;
- persist acknowledgements and snooze state;
- emit `attention.created`, `attention.updated`, and `attention.resolved`;
- update read markers and call provider `markRead` when supported.

Attention IDs must be stable and URL-safe. Keep the native request ID in the payload for debugging. Support simple field schemas for questions and forms; if a form cannot be represented, expose `openInProviderUrl` instead of pretending the hub can render it.

### 5.6 Read state

- `POST /api/v1/sessions/{ref}/read` updates a hub marker immediately.
- If the provider supports mark-viewed, call it asynchronously and reconcile.
- Read state survives restart.
- The hub emits a `session.read` event so other clients clear unread without polling.
- Provider-native unread timestamps remain authoritative when available.

### 5.7 Event bus and SSE

`EventBus` assigns a monotonic sequence, appends to a bounded ring buffer, and fans out to authenticated SSE clients.

- Persist the last sequence number.
- Keep the replay buffer in memory only.
- If a client's `after` cursor is older than the buffer, emit `resync` and let the client refetch snapshots.
- Heartbeat with a comment every 15 seconds.
- Send `retry:` once at connection start.
- Bound each subscriber queue. A slow client gets `resync` and is disconnected.
- Coalesce high-volume message snapshots for a short frame (for example 50ms) before fan-out.
- The browser uses `fetch()` with `Authorization` or the paired session cookie, and an `AbortController`, not `EventSource`.
- A session token must never travel in an SSE URL. The one-time pairing code is the only credential that may appear in a URL.

Transport:

```http
GET /api/v1/events?after=1042
Authorization: Bearer <owner-or-session-token>
Accept: text/event-stream
```

or, for a paired browser:

```http
GET /api/v1/events?after=1042
Cookie: agent_hub_session_8787=<session-token>
Accept: text/event-stream
```

On reconnect, the client sends the last sequence it applied. If it receives `resync`, it refetches sessions, attention, and the currently open messages.

### 5.8 Storage

`StateStore` owns only hub-owned state:

```ts
interface HubState {
  schemaVersion: number;
  lastSeq: number;
  readMarkers: Record<string, { readAt: number; updatedAt: number }>;
  attention: Record<string, { acknowledgedAt?: number; snoozedUntil?: number }>;
  drafts: Record<string, { text: string; updatedAt: number }>;
  idempotency: Record<string, { response: unknown; expiresAt: number }>;
}
```

JSON implementation:

- Write a temp file, `fsync`, then rename.
- Serialize writes through one promise queue.
- Load and validate on startup.
- Store with `0600`; data directory with `0700`.
- Keep a schema version and explicit migrations.
- Use `MemoryStateStore` in tests.

SQLite is an optional adapter behind the same interface when `node:sqlite` is available. Do not add a native SQLite dependency.

Do not persist provider message history, full session lists, or credentials.

### 5.9 Search

Session search ships first:

- in-memory index over title, project, directory, provider, and agent;
- rebuild incrementally on session updates;
- `GET /api/v1/search?q=&scope=sessions`;
- message search stays provider-specific or a later local index.

### 5.10 Options for new sessions

The UI needs more than provider IDs. Add:

```http
GET /api/v1/providers/{providerID}/options
```

Response:

```json
{
  "agents": [{ "id": "build", "label": "build" }],
  "models": [{ "id": "claude-sonnet", "label": "Claude Sonnet" }],
  "directories": ["/home/me/agent-hub"],
  "defaults": {
    "agent": "build",
    "model": "claude-sonnet",
    "directory": "/home/me/agent-hub"
  }
}
```

Cache options for a few minutes. Fall back to configured defaults when a provider cannot enumerate. Do not accept arbitrary provider URLs or filesystem scans from clients.

### 5.11 Failure semantics

| Failure | Behavior |
|---|---|
| Provider offline | Cached data remains visible with stale/offline state; mutations fail with `provider_offline`; backoff health checks |
| Provider auth error | Provider is marked `auth-error`; no retry storm; configuration must be fixed |
| Provider rate limit | Keep cached data; back off and surface `rate_limited`; do not create fake attention |
| SSE gap or restart | Emit `resync`; clients refetch sessions, attention, and open messages |
| Double attention action | Action lock plus idempotency key; provider is the final authority |
| Hub restart mid-send | Mark the local job interrupted; sync provider state; never pretend the hub finished |
| JSON state corrupt | Fail startup with a clear path to the backup; never silently reset read/attention state |
| Options unavailable | Use configured defaults and hide unsupported fields |
| Credential invalid | Return `401`; web clears the session and returns to login |
| Pairing link preview | `GET /pair/<code>` renders the page without consuming; previews are safe |
| Pairing code invalid or reused | The page shows the expired state; `POST /pair/<code>` or the JSON exchange returns `401` |
| Pairing code expired | Codes expire after five minutes; an expired POST is consumed and rejected |
| Session near expiry | A cookie session within seven days of expiry rotates to a fresh 30-day cookie; bearer clients call the refresh endpoint |
| Owner token rotated | Every paired session returns `401`; clients must pair again |
| Cookie mutation from another origin | Return `403`; require same-origin `Origin` or `Sec-Fetch-Site` |
| Slow SSE client | Send `resync`, close the subscriber, let the client reconnect |

### 5.12 Observability and security

- Use structured JSON logs with request ID, provider ID, route, status, and duration.
- Redact authorization, tokens, cookies, pairing codes, passwords, message bodies, and form payloads from logs.
- Public `GET /api/v1/health` returns liveness only.
- Authenticated `GET /api/v1/diagnostics` returns provider health, last sync, retry time, event backlog, subscriber count, storage kind, uptime, and version.
- Bearer and session comparisons use constant-time comparison.
- Pairing codes are 128-bit URL-safe random values, single-use, valid for five minutes, kept in memory with a 1000-entry cap, and redacted from logs.
- `GET /pair/<code>` renders a confirmation page without consuming the code, so chat link previews are safe. `POST /pair/<code>` consumes it, sets the cookie, and returns `303 /`. The machine exchange is `POST /api/v1/auth/connect` with a JSON body; form posts and GET requests cannot redeem a code.
- The first start that creates a config opens a TUI setup panel; plain and non-TTY modes print one pairing link after the server is listening. Later starts print only the pairing command. A foreground terminal watches for `p`/`pair` lines and issues a fresh link without restarting. The expired-link page sends an already-paired browser to `/`.
- When stdout is a TTY and a LAN URL exists, the terminal prints a **Scan to pair** QR code. The web login can scan it with the Barcode Detection API on secure-context browsers; the phone camera app is the fallback.
- The owner token is the only credential that can mint pairing codes. A paired session cannot create another pairing code.
- Session tokens are stateless: `<expiry>.<HMAC-SHA256(HMAC-SHA256(ownerToken, "agent-hub-session-v1"), expiry)>`. They last 30 days; rotating the owner token revokes all of them.
- A cookie session within seven days of expiry rotates to a fresh 30-day token on an authenticated request. Bearer clients call `POST /api/v1/auth/refresh`. Old stateless tokens remain valid until their original expiry. There is no absolute refresh cap or per-device revoke; rotating the owner token invalidates all.
- The browser session cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, port-scoped, and `Secure` when the request is HTTPS or `X-Forwarded-Proto: https`.
- In TUI mode, structured logs go to the platform log directory (`$XDG_STATE_HOME/agent-hub/logs` on Linux/Termux, `~/Library/Logs/Agent Hub` on macOS, `%LOCALAPPDATA%\AgentHub\Logs` on Windows). Keep `hub.log` and `hub.log.prev`; rotate at 25 MiB. Plain mode uses stderr; JSON mode uses stdout; non-TTY services do not create a file unless `--log-file` is explicit.
- Cookie-authenticated mutations require a same-origin `Origin` header, falling back to `Sec-Fetch-Site`. Credentialed CORS uses an explicit origin list, never `*`.
- Body size limits, URL limits, request timeouts, and provider timeouts are mandatory.
- CORS defaults to same-origin; development origin is explicit.
- Serve CSP, frame-ancestors, nosniff, and referrer-policy headers.
- Hub never accepts provider credentials from a client.
- No session token in URLs, logs, HTML, or localStorage by default. The one-time pairing code may appear in `/pair/<code>`; the confirmation page does not consume it, and the machine exchange uses a POST body.

### 5.13 Data flow

Read:

```text
web -> hub route -> session/message service -> cache -> adapter -> provider
```

Event:

```text
provider stream/poll -> adapter normalization -> sync service
  -> session/message cache + attention service -> event bus -> SSE clients
```

Action:

```text
web -> attention/read service -> provider adapter -> provider
  -> reconcile cache -> event bus -> all clients
```

Startup:

```text
config -> state store -> provider registry -> health/sync
  -> session index + attention reconciliation -> clients resync
```

## 6. HTTP API additions

Keep the existing `/api/v1` contract and add:

| Method | Route | Purpose |
|---|---|---|
| `POST` | `/api/v1/auth/pair` | Create a five-minute, single-use pairing code; owner credential only |
| `POST` | `/api/v1/auth/connect` | Redeem a JSON `{ code }` for a session token; machine exchange only |
| `POST` | `/api/v1/auth/refresh` | Issue a fresh 30-day session token for a paired session |
| `POST` | `/api/v1/auth/signout` | Clear the paired browser cookie |
| `GET` | `/api/v1/auth/check` | Validate the owner or session credential before loading the app |
| `GET` | `/pair/{code}` | Human confirmation page; does not consume the code |
| `POST` | `/pair/{code}` | Human pairing action; consumes the code and sets the session cookie |
| `GET` | `/api/v1/providers/{id}/options` | Agents, models, directories, defaults |
| `POST` | `/api/v1/sessions/{ref}/read` | Mark a session read and sync the marker |
| `GET` | `/api/v1/diagnostics` | Authenticated operational state |

Contract changes:

- Add `ProviderOptions`, `AgentOption`, `ModelOption`, and `DirectoryOption`.
- Add `AuthKind`, `PairingCode`, `PairingSession`, `PairingExchange`, and `SessionRefresh` schemas.
- Add `options` and `markRead` to provider capabilities.
- Add an optional `fields` array and `openInProviderUrl` to attention items.
- Add `resync` and `session.read` to the event union.
- Add `requestId` and `retryable` to error objects.
- Keep `after` on the event stream; optionally accept `Last-Event-ID` as a compatibility alias.

Generate `docs/openapi.yaml` from `packages/contracts` and run a CI drift check. The generated document is the Rust-facing contract.

## 7. Web client structure

### Routes

- `/login`
- `/` → inbox
- `/sessions`
- `/sessions/:ref`
- `/providers`
- `/settings`
- `/search`

Session refs are opaque. URL-encode them; never parse the provider ID from the URL in the client.

### Data flow

- `HubClient` from `packages/client` owns HTTP, auth, errors, and SSE parsing.
- TanStack Query is planned to own server state: sessions, messages, attention, providers, options, search.
- React state owns selection, filters, modals, and sheet state.
- `event-sync.ts` maps hub events into query updates:
  - `message.created/updated` upserts a normalized message snapshot into the active page;
  - `message.delta` falls back to a page refresh when only deltas are available;
  - `session.updated` updates the session and list and reconciles the page;
  - `attention.*` updates the inbox;
  - `provider.status` updates provider cards;
  - `resync` invalidates all server state.
- Actions use optimistic updates only for local attention state and disable the action while pending. Roll back on provider failure.

### UI implementation

- Extract tokens from `docs/prototypes/styles.css` into `packages/ui/src/tokens.css` and `base.css`.
- Rebuild interaction components in React; do not copy the prototype's DOM rendering code.
- Keep the existing hierarchy:
  - topbar owns the page `h1`;
  - inbox titles 16px;
  - session titles and body 14px;
  - metadata 11px;
  - badges 10px;
  - one primary action per surface.
- Reuse the responsive rules from `AGENTS.md`.
- Add a logged-out state and a token validation failure state.
- Bootstrap auth from the paired HttpOnly cookie before showing login; keep the pasted owner/session token as the fallback.
- Pairing links are opened directly, so the app does not need a token field in the pairing path.
- Render normalized message parts: text, reasoning, tool calls, code, and the streaming cursor.
- Gate actions from provider capabilities. Do not show a permission or interrupt control a provider cannot honor.
- Add loading, empty, offline, stale, and provider-error states.
- Add PWA manifest and app-shell service worker. Do not cache mutations.

## 8. Development harness

`pnpm dev` should start:

1. Fake OpenCode, Open WebUI, and Hermes HTTP servers.
2. The hub pointed at those fake providers.
3. The Vite web app proxying `/api` to the hub.
4. A pairing link available with `pnpm pair:dev` while the hub is running. The dev hub disables the TUI and interactive `p` prompt because Vite owns the terminal.

The fake providers need scripted scenarios:

- two OpenCode projects;
- paginated sessions and messages;
- streaming assistant text;
- a permission request and resolution;
- an Open WebUI chat tree with a branch;
- a Hermes approval;
- provider offline and auth-error states;
- SSE reconnect and a forced event gap.

The same fake servers are used by contract and integration tests.

## 9. Task plan

The milestones in [`plan.md`](plan.md) remain the product phases. Build them as vertical slices:

| Phase | Build | Depends on | Exit criteria |
|---|---|---|---|
| 0. Foundation | Workspace, contracts, OpenAPI generation, config, auth, errors, logger, health, storage interface, JSON store, event bus, Hono app factory, fake provider server | — | `pnpm dev` serves the shell; authenticated health and SSE heartbeat work; tests pass |
| 1. OpenCode read | Adapter health/list/get/messages, normalization, registry, sync, cache, merge cursors, sessions API, web login/session list/chat read | 0 | Real or fake OpenCode lists sessions and messages with pagination; no full-history polling |
| 2. OpenCode write | Prompt, create, options, interrupt, SSE normalization, idempotency, composer, new-session flow | 1 | Prompt streams into the open chat; create works; duplicate submit is safe |
| 3. Attention | Permission/form/error/unread normalization, attention service, action locks, read markers, inbox UI, action feedback | 2 | Approval from inbox resolves provider state and emits events; restart preserves read state |
| 4. Open WebUI | Chat list, tree resolver, completion stream, write-back, models, provider health | 2 | At least 50 chats list; current branch reads correctly; reply persists |
| 5. Hermes | API server, TUI gateway, sessions, runs, approvals, existing-session resume | 2 | Existing Hermes session reads; approval works; restart keeps refs |
| 6. Workspace features | Search, read sync across clients, drafts, PWA, device polish | 3 | Read on one client clears unread on another; drafts survive reload |
| 7. Hardening | Contract tests, integration, E2E, visual matrix, load, security, diagnostics, packaging, Termux/systemd/Docker docs | 1–6 | Restart/reconnect tests pass; no secrets in logs; clean Node 24 install runs |
| 8. Other clients | Glasses, VR, native desktop | 3–5 | Same API, same attention actions, no provider credentials in client |

Do not build all three provider adapters before the web slice works. OpenCode plus the fake provider is the proving ground.

### Critical path

1. Contracts and generated OpenAPI.
2. Fake provider and adapter interface.
3. OpenCode read path.
4. Web read-only slice.
5. OpenCode write path and SSE.
6. Provider options and new-session flow.
7. Attention engine and inbox.
8. Open WebUI, then Hermes.
9. Search, PWA, hardening.

## 10. Testing and CI

- **Unit:** Zod schemas, cursors, merge order, attention reducer, read markers, config interpolation, redaction.
- **Contract:** adapter fixtures for every provider response and error shape.
- **Integration:** Hono `createApp(deps)` against fake providers and a memory store.
- **SSE and jobs:** replay, gap/resync, heartbeat, slow client, reconnect, restart, interrupted send, cancel.
- **Storage:** JSON atomic writes, concurrent writes, migration, corrupt file handling.
- **Web:** query updates from events, attention optimistic actions, auth failure, offline state.
- **E2E:** login, list, read, send, approve, create, reconnect.
- **Visual:** 1440, 1024, 390, 320 in dark and light; inbox, chat, details, providers, settings, search, modal.
- **Load:** 10 clients, bursty deltas, provider churn, memory ceiling.
- **CI:** Node 24 and 26 matrix; typecheck, lint, test, build, OpenAPI drift, built-hub smoke test, Playwright.

## 11. Build and deployment

```text
pnpm install
pnpm dev          # fake providers + hub + Vite
pnpm typecheck
pnpm lint
pnpm test
pnpm openapi:check
pnpm test:e2e
pnpm build
node dist/hub.js --config ./hub.config.json
```

Build outputs:

- `dist/hub.js` — bundled Node server.
- `dist/web/` — built web assets served by the hub at `/`.
- `docs/openapi.yaml` — generated contract artifact committed with the repository.

Runtime requirements: Node 24+, read/write access to `dataDir`, and network reachability to configured providers. No database server, native module, or background daemon required.

Termux, systemd, Docker, and reverse-proxy examples stay operator documentation. The hub does not create tunnels, terminate TLS, or discover providers.

## 12. What not to build yet

- Multi-user identity, organizations, per-user tokens.
- ACP or local agent processes on the hub.
- File and image attachments.
- Full-text message search.
- Push notifications.
- A native mobile or desktop app.
- Redis, a message broker, or a separate worker service.
- A networking/tunnel/TLS layer.
- A custom cache when TanStack Query and the hub cache cover the need.
- A second copy of provider history in hub storage.

## 13. First implementation move

Scaffold Phase 0 only:

1. Create the workspace packages and dependency graph.
2. Implement `packages/contracts` with the four new API shapes and generated OpenAPI.
3. Implement config, auth, error handling, logging, health, storage, event bus, and `createApp`.
4. Add the fake provider server and the React shell with login.
5. Run the first vertical slice against fake OpenCode before touching a live provider.

If those defaults are accepted, the next change should be the Phase 0 scaffold, not another design pass.
