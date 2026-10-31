# Oktoso Delivery Plan

The plan starts with the hub API and the web client. Glasses and VR come after the API and the web client prove the model.

The concrete repository layout, runtime systems, API additions, and vertical-slice order are in [`code-structure.md`](code-structure.md).

## Milestone 0: Foundation

Status: complete.

Deliverables:

- Repository scaffold and workspace layout.
- Architecture design in `docs/design.md`.
- UI and IA design in `docs/ui-ia.md`.
- Interactive wireframe in `docs/prototypes/`.
- API contract draft in OpenAPI or JSON Schema.
- Decision log and risk list.

Acceptance:

- The team can explain the hub, provider, session, message, attention, and event models.
- The UI prototype covers inbox, sessions, chat, providers, and mobile.
- The API draft supports every screen in the prototype.

## Milestone 1: Hub core and OpenCode

Status: in progress. Phase 0 foundation and the OpenCode read/write slice are in place: contracts, config, owner/session auth, state, event bus, fake providers, authenticated shell, real session index, transcript, composer, prompt sending, new-session options/creation, interrupt, and provider event forwarding.

Goal: prove the hub with one provider and one client.

Deliverables:

- Node/TypeScript workspace with `packages/contracts`, `packages/providers`, `packages/storage`, `packages/hub`, `packages/client`, `packages/ui`, and `apps/web`.
- Config loader with environment substitution.
- Provider registry and health checks.
- Provider options endpoint for agents, models, and directories.
- OpenCode V2 adapter:
  - list sessions
  - get session
  - list messages with pagination
  - send prompt
  - create session
  - interrupt
  - SSE event subscription
- Hub API:
  - `/api/v1/health`
  - `/api/v1/providers`
  - `/api/v1/sessions`
  - `/api/v1/sessions/:ref`
  - `/api/v1/sessions/:ref/messages`
  - `/api/v1/sessions/:ref/messages` POST
  - `/api/v1/sessions` POST
  - `/api/v1/events`
  - `/api/v1/auth/pair`
  - `/api/v1/auth/connect`
  - `/api/v1/auth/refresh`
  - `/api/v1/auth/signout`
  - `/pair/:code`
- Owner and session auth (Bearer or HttpOnly cookie), five-minute single-use pairing codes, preview-safe `/pair/:code` confirmation, 30-day stateless sessions with rolling refresh, terminal/browser QR pairing, auth check endpoint, error shape, request logging with redaction.
- Terminal UI: full-screen dashboard, setup/pairing modal with QR, platform log files with two-file rotation, `--plain` and `--log-json` service modes.
- Web client shell:
  - session list
  - filters by provider and status
  - chat transcript
  - composer
  - new chat
- Mock-free development against a real OpenCode V2 server.

Acceptance:

- The web client lists real OpenCode sessions across at least two projects.
- Opening a session shows its messages in order.
- Sending a prompt reaches OpenCode and the reply streams into the client.
- Creating a session works with a directory, agent, and model.
- The event stream survives a reconnect and resyncs.
- A five-minute pairing page pairs a browser without exposing the owner token; only the confirmation POST consumes the code, so a link preview cannot use it. The cookie authenticates the API.
- Machine clients redeem a code with `POST /api/v1/auth/connect` and a JSON body.
- The first start that creates a config opens a TUI setup panel (plain/non-TTY prints a first-run link); `p` in the foreground terminal issues a new link without restarting; an expired link explains how to create a new one and sends an already-paired browser to the app.
- A terminal QR code and the browser Barcode Detection API cover phone pairing where available.
- Active cookie sessions refresh automatically before the 30-day expiry; bearer clients can call the refresh endpoint.
- A TTY starts the dashboard; a non-TTY process logs to stdout/stderr; TUI logs go to the platform log file with a bounded two-file rotation.
- A second start against a live hub prints a status card instead of an `EADDRINUSE` stack; `status`, `pair`, `--host`, and `--port` cover the follow-up actions.
- No blocking shell calls in a request path.

## Milestone 2: Attention inbox

Status: core OpenCode attention is implemented: permissions, forms (including select, boolean, number, and multiselect fields), unread sessions, failures, inbox actions, attention events, background reconciliation, and live navigation badge counts. Desktop notifications, retry for failed sessions, and Open WebUI/Hermes attention remain for later slices.

Goal: make the hub useful when you are away from the keyboard.

Deliverables:

- Attention model in the hub.
- OpenCode permission requests mapped to attention items.
- OpenCode forms mapped to question items.
- Failed and interrupted sessions mapped to error items.
- Unread detection from provider timestamps and hub read markers.
- Inbox screen with grouped items and priority order.
- Approval actions: allow once, always allow, deny.
- Form actions for single-choice, boolean, and short text fields.
- Mark read, retry, and open session.
- Hub-side read markers and attention acknowledgements.
- In-app notifications and badge counts.

Acceptance:

- A pending OpenCode permission appears in the inbox without a manual refresh.
- Approving or denying resolves the item and emits an attention event.
- A question with options can be answered from the web client.
- A complex form opens a full-page form view or is deferred to the provider UI.
- Read state survives a hub restart.

## Milestone 3: Open WebUI

Status: in progress. The adapter lists chats, resolves the current branch, maps messages, creates chats, sends prompts, waits for the asynchronous completion task, and lists models. Live validation is against Open WebUI 0.11.1. Provider-native mark-read, token-level streaming, and full failure discovery for old chats remain.

Goal: add the second provider and validate the normalized chat model.

Deliverables:

- Open WebUI adapter:
  - list chats with pagination
  - read chat and resolve the current message branch
  - create chat
  - send message with streaming
  - list models
- Chat tree mapping with branch metadata.
- Attention from unread and failed chats.
- Provider health and capability flags.
- Validation against the operator's Open WebUI instance using `/api/v1` routes.

Acceptance:

- The hub lists at least 50 Open WebUI chats.
- Opening a chat shows the current branch in order.
- Sending a message appends a user message and an assistant reply.
- The hub writes the resulting messages back to the Open WebUI chat.
- A branch with multiple assistant responses resolves correctly.

## Milestone 4: Hermes

Goal: add the Raspberry Pi agent and approval flow.

Deliverables:

- Hermes adapter:
  - API server health, sessions, messages, runs
  - streaming completions
  - approvals and clarify requests
  - TUI gateway WebSocket path for existing sessions
- Session mapping for new and existing Hermes sessions.
- Attention for approvals and clarify questions.
- Deployment notes for a Raspberry Pi: systemd, `API_SERVER_KEY`, bind address.
- Validation against a real Hermes instance.

Acceptance:

- The hub lists Hermes sessions.
- Opening an existing Hermes session shows history through the TUI gateway or API.
- Sending a prompt streams a reply.
- An approval request appears in the inbox and can be approved or denied.
- A Hermes restart does not lose session references.

## Milestone 5: Remote and multi-host

Goal: run the hub anywhere and connect providers on other machines.

Deliverables:

- Provider config supports arbitrary URLs and credentials.
- Per-provider health, offline state, retry, and backoff.
- Hub runs on Termux, Linux, macOS, and Docker.
- Bundled `dist/hub.js` with no native dependencies.
- Deployment examples:
  - Termux with `termux-services`
  - systemd
  - Docker
  - reverse proxy / TLS
- Operator documentation for WireGuard, Tailscale, LAN, and public exposure.
- No networking code in the hub.

Acceptance:

- The hub runs on Termux with Node 24+.
- It connects to OpenCode on a laptop, Hermes on a Pi, and Open WebUI over HTTPS.
- An offline provider appears as offline without blocking other providers.
- Restarting the hub recovers sessions and attention state.
- A prompt to an offline provider is rejected with a clear error or queued when the queue feature is enabled.

## Milestone 6: Cross-device state and search

Goal: make the hub feel like one workspace across devices.

Deliverables:

- Read markers and unread counts shared across clients.
- Drafts stored per session and device.
- Device list and token management. Per-device revocation requires stored device tokens; the first pairing release is stateless, so rotating `HUB_TOKEN` revokes all sessions.
- Session search by title and project.
- Message search API and UI.
- Attention snooze and bulk mark read.
- Optional notification preferences per provider.

Acceptance:

- Reading a session on mobile clears the unread marker on desktop.
- A draft written on one device appears on another.
- Search returns sessions and messages with filters.
- Snoozed attention items return at the configured time.

## Milestone 7: Glasses client

Status: in progress. The Even G2 client scaffold, phone pairing (QR, link, code, token), inbox, attention detail, chat, reply options, numbered-choice flow, question reply, multiple-question batches, question discovery, and phone keyboard fallback are implemented. Voice capture/STT and real-hardware acceptance remain; the checklist and preflight script are ready.

Goal: a glanceable inbox and reply surface on Even G2.

Deliverables:

- Even Hub app scaffold with the hub API client.
- Inbox screen with 1 to 3 attention items.
- Session screen with short context and actions.
- Reply flow with voice, quick replies, and phone keyboard fallback.
- Input mapping:
  - right temple tap: primary action
  - left temple tap: back or secondary
  - R1 ring tap: approve or primary
  - R1 double tap: deny or back
  - swipe up/down: navigate
  - long press: contextual menu
- Contextual menu for approve, deny, reply, snooze, mark read.
- Partial text rendering. No full page rebuild on every update.
- Simulator tests and the scripted hardware checklist in
  [`g2-hardware-validation.md`](g2-hardware-validation.md).

Acceptance:

- The glasses show a permission request and can approve or deny it.
- A chat can be opened, read, and answered by a choice, typed reply, or phone.
- A multi-question message is answered as one batch from the phone.
- The inbox updates when a new attention item arrives.
- Pending questions are visible from Home, Recent, and Inbox before the chat is opened.
- A lost connection shows an offline state and recovers.

## Milestone 8: VR client

Goal: a spatial view of the same hub.

Deliverables:

- WebXR client or a 2D web panel in a WebXR browser.
- Spatial panels: inbox, session list, chat, details.
- Wrist or controller menu for navigation.
- Voice composer through the hub STT path or browser speech input.
- Shared read state and attention with other clients.

Acceptance:

- The VR client lists sessions and opens a chat.
- A prompt can be sent and streamed.
- Attention items can be approved or denied.
- The same session state matches the web client.

## Milestone 9: Hardening and optional Rust port

Goal: production quality and a decision on Rust.

Deliverables:

- Contract tests for every provider adapter.
- Integration tests with recorded provider responses.
- Load test with multiple clients and event bursts.
- Security review: token handling, pairing code handling, cookie CSRF, redaction, CORS, rate limits.
- Packaging: single-file bundle, Docker image, Termux archive.
- Rust port decision record.
- If porting: Rust hub behind the same OpenAPI contract, with contract tests run against both.

Acceptance:

- The hub survives provider restarts and client reconnects.
- No secrets appear in logs.
- The bundle runs on a clean Node 24 install.
- A Rust prototype can serve the same session and message endpoints.

## Work breakdown

| Area | Tasks |
|---|---|
| Contracts | OpenAPI draft, error schema, event schema, capability matrix |
| Hub core | Config, provider registry, auth, CORS, logging, health, event bus |
| OpenCode | Auth, sessions, messages, prompt, create, events, permissions, forms, viewed |
| Open WebUI | Auth, chats, branches, messages, completion, create, models |
| Hermes | API server, sessions, messages, runs, approvals, TUI gateway |
| Persistence | Read markers, drafts, attention state, migrations, JSON fallback |
| Web client | Shell, inbox, sessions, chat, composer, new chat, providers, settings |
| Mobile | Responsive layout, bottom nav, sheets, PWA manifest |
| Glasses | Even Hub app, inbox, chat, voice, ring, contextual menu |
| VR | WebXR shell, panels, input, voice |
| Testing | Unit, contract, integration, simulator, load, security |
| Deployment | Termux, systemd, Docker, reverse proxy, docs |

## Testing strategy

- **Unit tests** for normalization, pagination, attention priority, and config parsing.
- **Contract tests** for each provider adapter against recorded fixtures.
- **Live smoke tests** against a real OpenCode, Open WebUI, and Hermes instance.
- **API tests** that run against the TypeScript hub and, later, the Rust hub.
- **Web tests** for session list, chat, composer, and attention actions.
- **Glasses simulator tests** for inbox, approval, reply, and reconnect.
- **Load tests** for SSE fan-out and session list caching.

## Risks

| Risk | Mitigation |
|---|---|
| Hermes API cannot bind existing sessions | Use the TUI gateway for existing sessions; document the split |
| Open WebUI branch mapping loses context | Keep native branch metadata; resolve only the current branch for display |
| Provider rate limits | Cache, backoff, and a minimum health-check interval |
| Android kills the hub | Wake lock, Termux services, restart recovery, no in-memory-only state |
| Token leakage in logs | Central redaction, structured logs, no message bodies at info level |
| Scope grows into agent execution | Keep the hub read/write over provider APIs; no local agents |
| Glasses rendering is slow | Partial updates, small payloads, precomputed pages, no full rebuilds |
| Rust port drifts from the API | OpenAPI contract and black-box tests |

## Decisions to confirm

1. Hub host: Termux, Raspberry Pi, desktop, NAS, or VPS.
2. Single-owner owner token plus paired sessions for the first release.
3. Open WebUI as a chat provider, not as the hub.
4. Hermes existing sessions through the TUI gateway.
5. Web client first, then glasses, then VR.
6. No ACP in the first release.
