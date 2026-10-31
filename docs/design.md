# Oktoso Design

Oktoso is the product name. The architecture does not depend on it.

## 1. Purpose

Oktoso gives one place to work with sessions from several AI systems. You open it, see which sessions need you, browse the rest, start a new chat, and reply. It works the same from a browser, a phone, a desktop app, Even G2 glasses, or a VR client.

The hub is the product. The clients are views over one HTTP API.

## 2. Goals

- Aggregate sessions from OpenCode V2, Open WebUI, Hermes, and later providers.
- Show a single attention inbox for approvals, questions, unread replies, and failures.
- Browse sessions by provider, project, status, and recency.
- Read a session, create one, and reply without leaving the hub.
- Share read state, drafts, and attention state across devices.
- Run on a phone with Termux, a Raspberry Pi, a desktop, a NAS, or a VPS.
- Leave networking to the operator. The hub binds a host and port, then connects to configured provider URLs.
- Keep provider credentials on the hub. Clients never hold provider secrets.
- Keep the provider layer replaceable. A Rust port must be possible without changing clients.

## 3. Non-goals

- Running agent CLIs or ACP servers inside the hub.
- Managing VPNs, tunnels, DNS, TLS certificates, or port forwarding.
- Replacing OpenCode, Open WebUI, or Hermes as an agent runtime.
- Multi-user identity in the first release. The first release is single-owner with an owner token and paired device sessions.
- Full-text message search in the first release. The API reserves room for it.
- File and image attachments in the first release.
- A native mobile app in the first release. The web client is a PWA.
- A native VR app in the first release. The VR client is WebXR.

## 4. Principles

1. **Hub-first.** Provider access, normalization, credentials, attention, and event fan-out live in the hub.
2. **Thin clients.** A client renders data and sends user actions. It does not call providers directly or own session logic.
3. **Provider APIs are canonical.** The hub reads and writes through each provider's API. It indexes and caches for speed, but it does not become the source of truth for session history.
4. **Capabilities over assumptions.** Providers declare what they support. The UI hides actions that a provider cannot perform.
5. **No ACP requirement.** The first release speaks REST and SSE to providers. ACP is an optional future adapter for agents with no stable HTTP API.
6. **No networking assumptions.** Provider URLs, bind address, CORS, and TLS are configuration. The hub does not create tunnels or VPNs.
7. **Portable runtime.** Node.js 24+, pure JavaScript dependencies, no native modules, no platform-specific process handling.
8. **Attention is a first-class object.** A session can need approval, an answer, a read, or a retry. The hub models those states once.
9. **Plain JSON over the wire.** The API contract is language-neutral so a Rust server can replace the TypeScript server later.
10. **Measure before rewriting.** The hub is I/O-bound. Fix blocking calls, pagination, caching, and rendering before changing languages.

## 5. System context

```text
Web / mobile / desktop        Even G2 glasses        VR / WebXR
          │                          │                  │
          └──────────────┬───────────┴──────────────────┘
                         │  HTTPS + SSE / WebSocket
                         ▼
                 ┌───────────────┐
                 │   Oktoso   │
                 │  Node/TS      │
                 │               │
                 │  providers    │
                 │  sessions     │
                 │  attention    │
                 │  events       │
                 │  read state   │
                 └───────┬───────┘
                         │  REST + SSE, configured URLs
        ┌────────────────┼──────────────────┬─────────────────┐
        ▼                ▼                  ▼                 ▼
   OpenCode V2      Open WebUI           Hermes          Future
   desktop/laptop   server/cloud         Raspberry Pi     providers
```

The hub is the only service clients need. Operators decide how clients and providers reach it: WireGuard, Tailscale, LAN, SSH tunnel, reverse proxy, or the public internet.

## 6. Domain model

### Provider

```ts
interface Provider {
  id: string                 // "desktop-opencode", "rpi-hermes", "openwebui"
  type: "opencode" | "openwebui" | "hermes" | string
  name: string
  baseUrl: string
  enabled: boolean
  status: "online" | "offline" | "auth-error" | "unknown"
  capabilities: ProviderCapabilities
  lastCheckedAt?: number
  version?: string
}
```

Provider IDs are stable configuration keys. They appear in session references, so changing one breaks saved links.

### Provider capabilities

```ts
interface ProviderCapabilities {
  list: boolean
  read: boolean
  send: boolean
  create: boolean
  stream: boolean
  interrupt: boolean
  permissions: boolean
  forms: boolean
  attachments: boolean
  search: boolean
}
```

### Session

```ts
interface Session {
  ref: string                // "desktop-opencode:ses_123"
  providerID: string
  nativeID: string
  title: string
  project?: string
  directory?: string
  parentRef?: string
  agent?: string
  model?: string
  status: "running" | "idle" | "error" | "offline"
  unread: boolean
  updatedAt: number
  createdAt: number
  cost?: number
  tokens?: TokenUsage
  attention?: AttentionSummary
  nativeUrl?: string         // optional link into the provider UI
}
```

Session references are `providerID:nativeID`. Clients treat them as opaque strings and URL-encode them.

### Message

```ts
interface Message {
  id: string
  sessionRef: string
  role: "user" | "assistant" | "system" | "tool"
  parts: MessagePart[]
  createdAt: number
  completedAt?: number
  streaming?: boolean
  metadata?: Record<string, unknown>
}

type MessagePart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; id: string; name: string; status: string; input?: unknown; output?: unknown }
  | { type: "file"; name: string; mimeType?: string; url?: string }
  | { type: "unknown"; raw: unknown }
```

### Attention

```ts
interface Attention {
  id: string                // "desktop-opencode:permission:per_123"
  sessionRef: string
  type: "permission" | "question" | "approval" | "unread" | "error"
  priority: "blocking" | "high" | "normal"
  title: string
  summary: string
  createdAt: number
  actions: AttentionAction[]
  payload?: unknown
}

interface AttentionAction {
  id: string                // "approve_once", "deny", "answer", "mark_read", "retry"
  label: string
  style?: "primary" | "danger" | "default"
}
```

### Event

```ts
interface HubEvent {
  seq: number
  type:
    | "session.created"
    | "session.updated"
    | "session.deleted"
    | "message.created"
    | "message.updated"
    | "message.delta"
    | "attention.created"
    | "attention.updated"
    | "attention.resolved"
    | "provider.status"
    | "error"
  sessionRef?: string
  attentionID?: string
  data: unknown
  at: number
}
```

Every event has a monotonic `seq`. Clients reconnect with `GET /api/v1/events?after=<seq>` and receive missed events from a bounded in-memory buffer. A snapshot endpoint covers gaps beyond the buffer.

## 7. Provider model

The hub exposes one normalized interface:

```ts
interface ProviderAdapter {
  id: string
  type: string
  capabilities: ProviderCapabilities

  health(): Promise<ProviderHealth>
  listSessions(query: SessionQuery): Promise<SessionPage>
  getSession(ref: string): Promise<Session>
  getMessages(ref: string, query: MessageQuery): Promise<MessagePage>
  sendMessage(ref: string, input: SendInput): Promise<SendResult>
  createSession(input: CreateSessionInput): Promise<Session>
  interrupt?(ref: string): Promise<void>

  listAttention?(): Promise<Attention[]>
  actOnAttention?(id: string, action: string, payload?: unknown): Promise<void>

  subscribe?(handler: (event: ProviderEvent) => void): Promise<() => void>
}
```

Adapters translate provider errors into a small error set:

- `provider_offline`
- `provider_auth_error`
- `not_found`
- `conflict`
- `rate_limited`
- `invalid_request`
- `unsupported`
- `internal`

## 8. Provider adapters

### 8.1 OpenCode V2

Connection:

- Base URL, for example `http://192.0.2.2:4096`
- Username `opencode`
- Password configured on the OpenCode server
- HTTP Basic auth

Endpoints:

| Purpose | Endpoint |
|---|---|
| Health | `GET /api/info` |
| List sessions | `GET /api/session?limit=&order=&search=&parentID=&directory=&project=&cursor=` |
| Get session | `GET /api/session/{sessionID}` |
| Messages | `GET /api/session/{sessionID}/message?limit=&order=&cursor=&type=` |
| Prompt | `POST /api/session/{sessionID}/prompt` with `{ "text": "..." }` |
| Create | `POST /api/session` with `{ "title", "location": { "directory" } }` |
| Interrupt | `POST /api/session/{sessionID}/interrupt` |
| Events | `GET /api/event` (SSE) |
| Pending permissions | `GET /api/permission/request` |
| Reply permission | `POST /api/session/{sessionID}/permission/{requestID}/reply` |
| Pending forms | `GET /api/form` |
| Reply form | `POST /api/session/{sessionID}/form/{formID}/reply` |
| Mark viewed | `POST /api/session/{sessionID}/view` |

Capabilities: `list`, `read`, `send`, `create`, `stream`, `interrupt`, `permissions`, `forms`, `attachments`. No search across messages.

Mapping notes:

- OpenCode message records include `type` values beyond chat, such as `idle` and `system`. The adapter returns `user` and `assistant` records and drops lifecycle records.
- Assistant records carry a `content` array with `text`, `reasoning`, and tool parts. The adapter maps those to `MessagePart`.
- `time.updated`, `time.idle`, and `idle_outcome` drive status and unread state.
- Permission requests block the agent. They are blocking attention items.
- Forms can be simple option lists or complex multi-field forms. The hub exposes the field schema so clients can render what they can and defer complex forms to the web client.

### 8.2 Open WebUI

Connection:

- Base URL, for example `https://openwebui.example`
- API key in `Authorization: Bearer <key>`
- API keys inherit the creating user's permissions.

Endpoints:

| Purpose | Endpoint |
|---|---|
| List chats | `GET /api/v1/chats/list?page=&sort_by=&sort_dir=` |
| Read chat | `GET /api/v1/chats/{id}` |
| Create chat | `POST /api/v1/chats/new` |
| Update chat | `POST /api/v1/chats/{id}` |
| Delete chat | `DELETE /api/v1/chats/{id}` |
| Fork | `POST /api/v1/chats/{id}/fork` |
| Models | `GET /api/v1/models` |
| Completion | `POST /api/chat/completions` with `stream: true` |

Capabilities: `list`, `read`, `send`, `create`, `stream`. No permissions, forms, or interrupt in the first release.

Mapping notes:

- An Open WebUI chat is a JSON document with a message tree: `history.currentId`, `history.messages`, `parentId`, `childrenIds`.
- The canonical session is the Open WebUI chat. The adapter resolves the current branch into a linear message list and keeps branch metadata on the side.
- The hub stores the provider's native chat ID. It does not reconstruct the tree from message text.
- For replies, use stateless `POST /api/chat/completions` without `chat_id`, consume the SSE chunks, then write the resulting messages back with `POST /api/v1/chats/{id}`. This keeps streaming under hub control.
- Native Socket.IO integration is a later improvement for exact UI behavior.
- Open WebUI has no blocking approval model. Attention comes from unread state, streaming state, and errors.

### 8.3 Hermes

Connection options:

1. **API server** (`hermes gateway`) with `API_SERVER_KEY`, HTTP + SSE.
2. **TUI gateway** WebSocket for existing sessions, history, branching, approvals, and steering.
3. **ACP** only if a future deployment needs it. ACP is not part of the first release.

Endpoints and methods:

| Purpose | Surface |
|---|---|
| Health | `GET /v1/capabilities` |
| List sessions | `GET /api/sessions` |
| Messages | `GET /api/sessions/{id}/messages` |
| Create / prompt | `POST /v1/chat/completions`, `POST /api/sessions/{id}/chat/stream` |
| Runs | `POST /v1/runs`, `GET /v1/runs/{id}`, `GET /v1/runs/{id}/events` |
| Approvals | `POST /v1/runs/{id}/approval` |
| Steer / stop | `POST /v1/runs/{id}/steer`, `/stop` |
| Existing sessions | TUI gateway `session.list`, `session.history`, `session.resume`, `prompt.submit` |

Capabilities: `list`, `read`, `send`, `create`, `stream`, `interrupt`, `approvals`, `questions` where the TUI gateway exposes them.

Mapping notes:

- The Hermes API server creates its own sessions. It refuses to bind sessions owned by the CLI, TUI, desktop, ACP, or messaging surfaces.
- Use the TUI gateway when the hub must attach to existing Hermes sessions. Use the API server for new sessions and stateless runs.
- Approvals and clarify requests are blocking attention items.
- Hermes keeps sessions in `~/.hermes/state.db`. The hub does not read that database directly in the first release. It uses the APIs.

### 8.4 Future providers

The adapter interface covers future providers without changing clients:

- Claude Code through its SDK or a small HTTP bridge.
- Codex through its app server or SDK.
- Other chat systems through OpenAI-compatible APIs.
- ACP agents through an optional adapter, if a stable HTTP transport appears.

## 9. Hub API

The contract is generated from `packages/contracts` and written to `docs/openapi.yaml`. The generated file is the field-name and shape contract for clients and the future Rust port. Run `pnpm openapi:generate`; CI checks for drift with `pnpm openapi:check`.

Base path: `/api/v1`.

Auth: owner or session `Authorization: Bearer <token>` on every API route except `/api/v1/health`, `POST /api/v1/auth/connect`, and `/api/v1/auth/signout`. A paired browser uses the `oktoso_session_<port>` HttpOnly cookie instead of a header. The human `/pair/<code>` page is outside `/api/v1` and is public.

### Routes

```text
GET    /api/v1/health
POST   /api/v1/auth/pair
POST   /api/v1/auth/connect
POST   /api/v1/auth/refresh
POST   /api/v1/auth/signout
GET    /api/v1/auth/check
GET    /pair/:code
POST   /pair/:code
GET    /api/v1/providers
POST   /api/v1/providers/:id/check
GET    /api/v1/sessions?provider=&status=&q=&cursor=&limit=
GET    /api/v1/sessions/:ref
GET    /api/v1/sessions/:ref/messages?cursor=&limit=&order=
GET    /api/v1/sessions/:ref/question
POST   /api/v1/sessions/:ref/messages
POST   /api/v1/sessions
POST   /api/v1/sessions/:ref/interrupt
GET    /api/v1/sessions/:ref/draft
PUT    /api/v1/sessions/:ref/draft
DELETE /api/v1/sessions/:ref/draft
GET    /api/v1/attention
POST   /api/v1/attention/:id/actions/:action
GET    /api/v1/events?after=
GET    /api/v1/search?q=            (later)
```

### Session list

```http
GET /api/v1/sessions?provider=desktop-opencode&status=idle&limit=50
```

```json
{
  "data": [
    {
      "ref": "desktop-opencode:ses_123",
      "providerID": "desktop-opencode",
      "nativeID": "ses_123",
      "title": "Fix auth race in gateway",
      "project": "oktoso",
      "directory": "/home/me/oktoso",
      "agent": "build",
      "model": "anthropic/claude-sonnet",
      "status": "idle",
      "unread": true,
      "updatedAt": 1792900000000,
      "createdAt": 1792890000000,
      "attention": { "type": "permission", "priority": "blocking" }
    }
  ],
  "cursor": { "next": "opaque" }
}
```

### Messages

```http
GET /api/v1/sessions/desktop-opencode%3Ases_123/messages?limit=50&order=asc
```

```json
{
  "data": [
    {
      "id": "msg_1",
      "sessionRef": "desktop-opencode:ses_123",
      "role": "user",
      "parts": [{ "type": "text", "text": "Fix the auth race" }],
      "createdAt": 1792890000000
    }
  ],
  "cursor": { "next": "opaque" }
}
```

### Question

```http
GET /api/v1/sessions/desktop-opencode%3Ases_123/question
```

```json
{
  "data": {
    "sessionRef": "desktop-opencode:ses_123",
    "messageId": "msg_42",
    "revision": "msg_42:8f3c1a",
    "askedAt": 1793000000000,
    "generatedAt": 1793000001000,
    "questions": [
      {
        "id": "msg_42:q0",
        "text": "Should I squash the three fix commits into one?",
        "context": "Branch: fix/auth-race",
        "kind": "boolean",
        "choices": [
          { "id": "msg_42:q0:c0", "label": "Yes", "text": "Yes", "kind": "boolean", "source": "heuristic" },
          { "id": "msg_42:q0:c1", "label": "No", "text": "No", "kind": "boolean", "source": "heuristic" }
        ],
        "allowsFreeText": true,
        "allowsVoice": false,
        "multiSelect": false,
        "risk": "normal",
        "confidence": "high",
        "source": "heuristic"
      }
    ]
  }
}
```

`data` is `null` when there is no pending question. The question is derived from
the latest completed assistant message; no provider-side question API is needed.
A provider-native question attention item is returned as `attentionID` so the
glasses route to the attention form instead of sending a text answer. Multiple
questions return `null` until the phone batch flow exists.

### Send

```http
POST /api/v1/sessions/desktop-opencode%3Ases_123/messages
Idempotency-Key: 01J...
Content-Type: application/json

{
  "text": "Yes",
  "answer": {
    "questionId": "msg_42:q0",
    "messageId": "msg_42",
    "revision": "msg_42:8f3c1a",
    "choiceId": "msg_42:q0:c0",
    "source": "boolean"
  }
}
```

The hub queues the prompt, returns `202 Accepted`, and emits message events. Provider send failures surface as `error` events and a session status update.

`answer` is optional hub-only metadata. When present, the hub compares the
question ID, message ID, and revision with the current pending question. A
changed question returns `409 conflict` with
`details.reason = "question_changed"`; an already answered question returns
`question_resolved`. The metadata is stripped before the provider send.

An `Idempotency-Key` header is optional. The hub caches the `202` result for five
minutes and returns the same result for a retry with the same key. Retries must
reuse the key; a new answer draft gets a new key.

### Create

```http
POST /api/v1/sessions
Content-Type: application/json

{
  "providerID": "desktop-opencode",
  "title": "Investigate auth race",
  "directory": "/home/me/oktoso",
  "agent": "build",
  "model": "anthropic/claude-sonnet",
  "text": "Start by reading the auth middleware."
}
```

### Attention

```http
GET /api/v1/attention
```

```json
{
  "data": [
    {
      "id": "desktop-opencode:permission:per_123",
      "sessionRef": "desktop-opencode:ses_123",
      "type": "permission",
      "priority": "blocking",
      "title": "Run shell command",
      "summary": "git push origin main",
      "createdAt": 1792900000000,
      "actions": [
        { "id": "approve_once", "label": "Allow once", "style": "primary" },
        { "id": "approve_always", "label": "Always allow", "style": "default" },
        { "id": "deny", "label": "Deny", "style": "danger" }
      ]
    }
  ]
}
```

### Events

```http
GET /api/v1/events?after=1042
Accept: text/event-stream
```

```text
id: 1043
event: message.updated
data: {"seq":1043,"type":"message.updated","sessionRef":"desktop-opencode:ses_123","data":{"message":{"id":"msg_2","sessionRef":"desktop-opencode:ses_123","role":"assistant","parts":[{"type":"text","text":"The race comes from"}],"createdAt":1792970020000,"streaming":true}}}
```

Message events carry a normalized message snapshot. Providers that only expose deltas are coalesced into snapshots before fan-out.

The buffer keeps a bounded number of events. Clients that fall behind fetch a session snapshot and resume from the latest `seq`.

### Errors

```json
{
  "error": {
    "code": "provider_offline",
    "message": "desktop-opencode is not reachable",
    "details": { "providerID": "desktop-opencode" }
  }
}
```

## 10. Attention model

Attention has four sources:

| Type | Source | Blocking | Actions |
|---|---|---|---|
| `permission` | OpenCode permission request | Yes | allow once, always, deny |
| `approval` | Hermes approval request | Yes | approve, deny, edit |
| `question` | OpenCode form, Hermes clarify | Yes | answer, open on web, cancel |
| `unread` | Session idle with new content since last view | No | mark read, open |
| `error` | Failed run or interrupted session | No | retry, open, dismiss |

Priority order: blocking, high, normal. Within a priority, newest first. The inbox groups by type and collapses sessions with multiple items.

The hub stores read markers and attention acknowledgements. Provider-native read state, such as OpenCode `time_viewed`, is updated when possible.

## 11. Persistence

Use SQLite when Node's `node:sqlite` is available. Fall back to a JSON file for small deployments. The schema is small:

- `providers`: config is loaded from the hub config file, not stored in the database.
- `read_markers`: session ref, last viewed event or timestamp, updatedAt.
- `drafts`: session ref, client device ID, text, updatedAt.
- `attention_state`: attention ID, acknowledgedAt, snoozedUntil.
- `devices`: optional client device records for sync.
- `event_cursor`: optional per-client cursor.

Provider history stays in the provider. The hub caches recent session pages and message pages in memory with a short TTL. The cache is not authoritative.

## 12. Auth and security

The hub has one owner credential and any number of paired device sessions.

### Pairing and sessions

1. On the first start that creates the config, the TUI starts listening and opens a setup panel with the owner token shown once. Pressing `p` issues the first pairing code. In plain and non-TTY modes the hub prints a first-run pairing link instead.
2. In a foreground terminal, `p` and Enter issue a fresh link at any time without stopping the server. Later starts show a one-line reminder. Background and service deployments run the pair command instead.
3. The CLI reads only the host, port, and owner token from the config, authenticates with the owner token, and calls `POST /api/v1/auth/pair`. Provider secrets are not required.
4. The hub returns a 128-bit URL-safe code. It is single-use, expires in five minutes, lives in an in-memory cache capped at 1000 live codes, and is lost on restart.
5. `GET /pair/<code>` serves a confirmation page and does not consume the code. Link previews and chat unfurlers can fetch it safely. If the browser already holds a valid session cookie, the page offers “Open Oktoso” and “Pair again.”
6. `POST /pair/<code>` consumes the code, sets an `HttpOnly; SameSite=Lax` session cookie, and returns `303 /`. Machine clients use `POST /api/v1/auth/connect` with a JSON `{ "code": ... }` body and receive `{ token, expiresAt }`. An expired, reused, or restart-invalidated page tells the operator to press `p` in the hub terminal; if the browser already holds a valid session cookie, it redirects to `/`.
7. A session token is `<expiry>.<HMAC-SHA256(key, expiry)>`, where `key = HMAC-SHA256(ownerToken, "oktoso-session-v1")`. It lasts 30 days, is stateless, and is verified in constant time.
8. A cookie-authenticated session refreshes to a fresh 30-day token when it is within seven days of expiry. The middleware rotates the cookie transparently. Bearer clients call `POST /api/v1/auth/refresh`. Old stateless tokens remain valid until their original expiry.
9. The cookie is named `oktoso_session_<port>` when the Host includes a port and `oktoso_session` otherwise. It uses `Path=/` and sets `Secure` when the request is HTTPS or `X-Forwarded-Proto: https`.
10. Rotating `HUB_TOKEN` invalidates every paired session. Per-device revocation requires stored device tokens, which is deferred to the Devices screen.

When stdout is a TTY and a LAN address exists, the terminal output includes a compact **Scan to pair** QR encoding the LAN `/pair/<code>` link. On supported secure-context browsers, the login screen offers a camera scanner using the Barcode Detection API; otherwise the phone camera app is the fallback.

Sessions have no server-side identity. A continuously used cookie can keep refreshing, and there is no per-device revoke or absolute refresh cap. Rotating `HUB_TOKEN` remains the global revocation mechanism.

The owner token remains the recovery and administration credential. Only the owner token can mint pairing codes. A paired session cannot create another pairing code.

Clients may send a session token as a Bearer header or rely on the cookie. Browser and first-party wearable clients use the cookie and never put the token in JavaScript-readable storage. Cross-origin or packaged clients keep the Bearer fallback.

Cookie-authenticated mutations must come from the hub's own origin: the hub checks `Origin`, falling back to `Sec-Fetch-Site`. This is the CSRF boundary that bearer-only auth did not need.

### Rules

- Provider credentials live in `hub.config.json` or environment variables referenced by the config.
- Config files with secrets must be `0600`.
- The hub binds `127.0.0.1` by default. The operator sets `0.0.0.0` or a VPN address when needed.
- CORS is configurable. The default for a local-only hub is the web client origin. Credentialed CORS uses an explicit origin list, never `*`.
- The hub does not terminate TLS. Use WireGuard, Tailscale Serve, Caddy, nginx, or another proxy.
- The hub does not expose provider credentials to clients.
- Logs redact tokens, passwords, cookies, pairing codes, message bodies, and file contents.
- Approval actions require an authenticated hub request. There is no auto-approve path.
- Rate-limit provider health checks and retries.

### 12.1 Terminal interface

The foreground CLI is a dashboard, not a log stream:

- Header: bind URL, uptime, storage; status: providers, sessions, attention, SSE, event/request/error counts.
- Activity feed: selected domain events and warnings; raw request logs stay out.
- `p` opens a pairing modal with the primary LAN link, QR, and a live countdown. `c` copies, `o` opens, `p` regenerates, `esc` closes.
- `l` toggles a bounded in-memory logs view; `j`/`k` scroll. `r` re-checks providers. `o` opens the web UI. `?` shows keys. `Ctrl+C` quits.
- First run opens a setup panel with the owner token once; `p` moves to pairing.
- The TUI uses a small custom ANSI renderer with alternate screen, raw key input, resize handling, and clean terminal restoration. It is not React/Ink and adds no native modules.
- `--plain` keeps the scrollback-friendly output: human output on stdout, JSON logs on stderr.
- `--log-json` writes JSON logs to stdout and disables the TUI for service managers.
- A non-TTY process never starts the TUI. Pairing for a service uses `oktoso pair` from any terminal, which calls the running hub over HTTP.
- A second start against a live hub probes `/api/v1/health` before opening state or the TUI. It prints a status card (version, pid, uptime, web URL, pair/status/stop hints) and exits successfully. `status` performs the same probe; `pair` connects to the running hub; `--host` and `--port` override the bind target. If another process owns the port, the command reports it and suggests another port instead of throwing `EADDRINUSE`. A second instance needs separate state and log directories.

Structured logs in TUI mode go to the platform log directory:

- Linux/Termux: `$XDG_STATE_HOME/oktoso/logs/hub.log` (usually `~/.local/state/oktoso/logs/`)
- macOS: `~/Library/Logs/Oktoso/hub.log`
- Windows: `%LOCALAPPDATA%\Oktoso\Logs\hub.log`

Only `hub.log` (current run) and `hub.log.prev` (previous run) are kept. A run rotates at 25 MiB, replacing the previous file when it is long enough. `HUB_LOG_DIR`, `HUB_LOG_MAX_BYTES`, `--log-file`, `--log-dir`, and `--no-log-file` override the defaults. Files use `0600`; directories use `0700`. Info and above are persisted by default; `--verbose` adds debug.

## 13. Deployment and portability

The hub is a single Node process:

```sh
node dist/hub.js --config ./hub.config.json
```

Supported targets:

- Termux on Android
- Linux, including Raspberry Pi
- macOS
- Docker
- A VPS

No native modules. Bundle to `dist/hub.js` on a build machine and copy it to the target. The target needs Node 24+ only.

Termux notes:

- Install Node with `pkg install nodejs-lts`.
- Use `termux-wake-lock` and `termux-services` or `tmux`.
- Use `Termux:Boot` to start after reboot.
- Android may still kill the process. The hub re-fetches provider state on restart.
- The hub does not need a database server.

Configuration:

```json
{
  "host": "127.0.0.1",
  "port": 8787,
  "token": "hub-owner-token",
  "cors": ["http://localhost:5175"],
  "providers": [
    {
      "id": "desktop-opencode",
      "type": "opencode",
      "baseUrl": "http://192.0.2.2:4096",
      "password": "${OPENCODE_PASSWORD}"
    },
    {
      "id": "openwebui",
      "type": "openwebui",
      "baseUrl": "https://openwebui.example",
      "apiKey": "${OPENWEBUI_API_KEY}"
    }
  ]
}
```

Environment substitution keeps secrets out of the file. The operator manages WireGuard, DNS, TLS, and reachability.

## 14. Performance

The old `er-hello` bridge had clear bottlenecks:

- `execSync` SQLite queries blocked the Node event loop.
- Full message history was fetched every two seconds.
- Glasses screens were rebuilt in full on every update.

The new hub avoids those:

- Use HTTP APIs, not a local SQLite CLI.
- Paginate messages and cache recent pages.
- Use SSE for live updates, with a snapshot on reconnect.
- Debounce provider event bursts before fan-out.
- Keep provider calls concurrent with bounded parallelism.
- Serve small JSON payloads.
- Let clients render incrementally. The glasses client uses partial text updates, not full page rebuilds.

Targets for the first release:

- Session list responds in under 300 ms on a LAN with warm cache.
- First message page responds in under 500 ms.
- SSE event latency under 200 ms on a LAN.
- Hub memory under 150 MB with three providers and ten clients.

Measure before optimizing. A Rust rewrite does not fix a blocking query or a full-page render.

## 15. Rust port path

The API contract is the boundary. Clients speak JSON over HTTP and SSE, so a Rust server can replace the TypeScript server without client changes.

Port these modules:

- Provider adapters (OpenCode, Open WebUI, Hermes)
- Domain models and normalization
- HTTP server, SSE, auth, CORS
- Session cache and attention engine
- Persistence

Keep these modules:

- Web client
- Glasses client
- VR client
- Client SDK, if the API contract stays stable

Design rules that make the port cheap:

- Define the API in OpenAPI or JSON Schema, not in TypeScript alone.
- Keep provider adapters behind the `ProviderAdapter` interface.
- Keep domain logic independent of Hono or `node:http`.
- Use plain JSON values. No `Date`, `Map`, `Set`, or class instances in responses.
- Use a standard SQLite schema or JSON storage.
- Add black-box contract tests that run against either server.
- Keep the web app static and server-agnostic.

Estimate: a 2k to 4k line TypeScript hub becomes a 3k to 6k line Rust hub. The work is weeks, not months, and the clients do not change.

## 16. Risks and open questions

- **Hermes existing sessions:** the API server refuses to bind sessions owned by other surfaces. The TUI gateway is required for those. Validate against the operator's Hermes version.
- **Open WebUI branches:** the message tree must map to a canonical linear view without losing branch metadata. Validate against the operator's instance.
- **Open WebUI streaming:** stateless completion plus hub-side persistence is the first approach. Socket.IO integration is later.
- **Provider rate limits:** polling and health checks need backoff.
- **Token storage:** the owner token comes from an environment variable or a config file with `0600`. Paired sessions are stateless and expire after 30 days; per-device revocation is later. A keyring is later.
- **Multi-user:** the first release has one owner token plus paired device sessions. Per-user identity and leases are later.
- **Attachments:** later. The canonical message model reserves a file part.
- **Search:** later. The API reserves `/api/v1/search`.
- **Android process death:** the hub must recover from restarts and provider disconnects.
- **Glasses/VR:** clients share the API, but their input models differ. Design them after the web client works.

## 17. Architecture decisions

| ID | Decision | Reason |
|---|---|---|
| ADR-001 | Hub-first, thin clients | One place for credentials, normalization, attention, and sync |
| ADR-002 | REST + SSE, no ACP requirement | OpenCode, Open WebUI, and Hermes expose HTTP APIs |
| ADR-003 | Provider APIs are canonical | Avoids stale copies and provider-specific storage coupling |
| ADR-004 | TypeScript/Node first | Fast iteration, shared types with web/glasses/VR clients, easy Termux install |
| ADR-005 | No networking logic in the hub | Operators manage WireGuard, TLS, DNS, and reachability |
| ADR-006 | Attention as a first-class object | Approvals and questions are the reason to open the hub |
| ADR-007 | Plain JSON contract | Keeps a Rust port and other clients possible |
| ADR-008 | SQLite or JSON persistence | Portable, no database server, no native modules |
| ADR-009 | No local ACP or agent processes | The hub aggregates HTTP APIs; agents stay on their hosts |
| ADR-010 | Web client is the reference client | Proves the API is medium-agnostic before glasses/VR work |
| ADR-011 | Owner token plus stateless paired sessions | Five-minute pairing links avoid copying the owner token; HMAC sessions add no server state; rotating the owner token revokes all |
