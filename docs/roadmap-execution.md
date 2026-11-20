# Oktoso execution plan

Companion to [`roadmap.md`](roadmap.md). The roadmap holds strategy, phase
goals, and acceptance. This document holds the ordered work breakdown, the
dependencies, the release map, and the open decisions that block implementation.

Update the checkboxes in place as work lands. Do not create a parallel plan.

## How to read this

- **Phase** matches `roadmap.md`.
- **Task IDs** (`A1`, `B3`, ...) are stable. Reference them in commits and PRs.
- **Touch** lists the expected files or packages. It is a guide, not a fence.
- **Done** is the task-level finish line. The phase acceptance lives in
  `roadmap.md`.
- Effort is t-shirt sized for one primary developer. Split a task if it grows
  past its size.

## Constraints that shape the plan

- Mobile-first. The phone loop ships before any new desktop surface.
- Single owner. No multi-user work until a phase explicitly schedules it.
- Providers stay canonical. A cache is derived, invalidatable, and never written
  back to a provider.
- Pure JavaScript. No native modules, including for search or push.
- Thin clients. Credentials and provider calls stay in the hub.
- Contracts first. Every endpoint starts in `packages/contracts` and regenerates
  `docs/openapi.yaml`.
- No background aggregation endpoint. Rollups are computed from data the client
  already fetches.
- `App.tsx` is already 8,859 lines. New UI lands in its own module and mounts
  from `App.tsx`; do not grow the monolith.

## Workstreams and dependencies

```text
W1 Mobile loop      Phase 3 (notifications/PWA) ──> Phase 4 (supervisor)
W2 Memory           Phase 5 (recall/lineage)
W3 Platform         Phase 6 (providers, skipped) ──> Phase 7 (MCP southbound, skipped)
Hardening           Phase 8 (independent of the skipped platform track)
Bets                Phase 9 (independent, one at a time)
```

- Phase 3 is independent. Start there.
- Phase 4 depends on the attention events (already shipped) and optionally the
  Phase 3 notification channel.
- Phase 5 is independent and can run in parallel with Phase 3/4 if there is
  capacity.
- Phase 6 and Phase 7 are **skipped by the owner** as of 2026-11-16: no Hermes
  install, and the southbound broker's benefit is unclear for a single-owner
  hub. The tasks stay in this document as the record; the revisit trigger is a
  third provider or a concrete tool-governance need.
- Phase 8 is independent of the skipped track and is done except F5.
- Phase 9 is independent bets, not a dependency chain: schedule one at a time.

## Phase 3 — Always-on attention

Target: 2–3 weeks. Release: `v0.2.0` at phase completion, patches per slice.

Status: complete and shipped in `v0.2.0`. A1–A6, A8, and A9 are done. Web Push is the only outbound channel; there is no ntfy, Telegram, or webhook sender.

### A1. Contracts and configuration

- [x] Add `packages/contracts/src/notifications.ts`:
  - `zNotificationChannelKind` and `zNotificationChannelView`
  - `zNotificationRouting` (types, digest window, quiet hours)
  - `zPushSubscriptionInput` / `zPushSubscription` (transport secrets omitted
    on read)
  - `zNotificationDelivery` (id, channel, attentionID, status, attempts, error)
- [x] Export from `packages/contracts/src/index.ts`.
- [x] Extend the hub config schema with a `notifications` block, including
  `${ENV}` substitution for channel tokens.
- [x] Regenerate `docs/openapi.yaml` and add a schema round-trip test.

**Touch:** `packages/contracts/src/notifications.ts`,
`packages/contracts/src/index.ts`, `packages/hub/src/config.ts`,
`scripts/generate-openapi.ts`, `docs/openapi.yaml`.
**Done:** `pnpm typecheck` and `pnpm openapi:check` pass; a unit test parses a
minimal and a full notification config.

### A2. Notification service core

- [x] Add `packages/hub/src/services/notification-service.ts`.
- [x] Subscribe to the event bus and select attention events only.
- [x] Implement routing: blocking immediate, high/normal per rule, unread/error
  digest.
- [x] Implement coalescing by session and type inside a window. Four events from
  one session produce one delivery.
- [x] Implement quiet hours in the hub's configured timezone.
- [x] Persist subscription and delivery state under `dataDir` with the existing
  JSON store.
- [x] Add `NotificationService.test()` for the settings button and CLI; the
  HTTP/CLI wiring lands with A4.

**Touch:** `packages/hub/src/services/notification-service.ts`,
`packages/hub/src/services/event-bus.ts`, `packages/hub/src/storage/*`,
`packages/hub/src/app.ts`.
**Done:** unit tests cover routing, coalescing, quiet hours, and an empty
attention payload; no message body is logged.

Status: implemented. `NotificationService` routes, coalesces by session and
type, respects quiet hours, dedupes by attention id, retries, and records
delivery attempts. It is wired in `main.ts` with a no-op transport until A3.

### A3. Web Push transport

- [x] Choose and pin the push implementation.
  `@block65/webcrypto-web-push` 2.0.0: pure JS, one tiny dependency, and it
  bundles cleanly. (`web-push` broke the ESM bundle on a dynamic `tty`
  require.)
- [x] Generate VAPID keys on first start; store the private key in `dataDir`
  with `0600`; never log it.
- [x] Send with a bounded payload (title, attention type, session ref, deep
  link, one line of summary). No transcript content.
- [x] Handle `404`/`410` by deleting the subscription; handle `429` and `5xx`
  with capped exponential backoff.
- [x] Record every attempt in the delivery log.

**Touch:** `packages/hub/src/services/web-push-transport.ts`,
`packages/hub/src/services/vapid.ts`,
`packages/hub/src/services/notification-service.ts`, `dataDir`.
**Done:** an injected sender receives the exact payload for each subscription;
expired subscriptions are removed; retries stop after the cap. Real payload
encryption is delegated to the Web Crypto library.

### A4. Subscription and settings routes

- [x] `GET /api/v1/notifications/subscriptions` for the current owner.
- [x] `POST /api/v1/notifications/subscriptions` (register a browser
  subscription).
- [x] `DELETE /api/v1/notifications/subscriptions/:id`.
- [x] `POST /api/v1/notifications/test`.
- [x] `GET`/`PUT /api/v1/notifications` (settings and routing).
- [x] Gate all writes behind the authenticated session; subscriptions carry a
  client-generated `deviceID` and can be revoked individually.
- [x] Add a stable device identity. The current pairing is stateless, so the
  client sends a `deviceID` plus a label with the subscription; revoke is
  per-subscription, without rotating the owner token.

**Touch:** `packages/hub/src/http/routes/notifications.ts`,
`packages/hub/src/app.ts`, `packages/client/src/hub-client.ts`.
**Done:** route tests cover auth, validation, and device revocation; the client
has typed methods.

Status: implemented. Settings and subscriptions live at
`/api/v1/notifications`, with `/subscriptions`, `/deliveries`, and `/test`
below it. The settings view exposes the VAPID public key as
`applicationServerKey`.

### A5. Service worker and deep links

- [x] Add `apps/web/public/sw.js`:
  - `push` handler with a safe fallback payload
  - `notificationclick` that focuses an existing tab or opens the deep link
  - shell precache and cache-first static assets
- [x] Register the worker from a small `apps/web/src/pwa.ts` module.
- [x] Add `mobile-web-app-capable` alongside the deprecated Apple meta.
- [x] Deep link format: `/sessions/<ref>?attention=<id>`; the chat scrolls
  the matching inline attention card into view and outlines it.
- [x] Provide `enablePush`/`disablePush` helpers that request permission only
  from a user gesture; A6 wires the Settings button.

**Touch:** `apps/web/public/sw.js`, `apps/web/src/pwa.ts`,
`apps/web/src/app/App.tsx` (mount only), `apps/web/index.html`.
**Done:** a synthetic push opens the exact item; a second tab is focused, not
duplicated.

Status: implemented. The worker precaches the shell, uses network-first
navigation, handles `push`/`notificationclick`, and is registered in
production only. The deep link is carried by the router and focuses the inline
card. Push subscription helpers live in `apps/web/src/pwa.ts`.

### A6. Settings UI

- [x] Add `apps/web/src/app/settings-notifications.tsx` (new module).
- [x] Enable/disable per device, send a test, show permission state.
- [x] Quiet hours, per-type routing, digest window.
- [x] Device list with last seen and revoke.
- [x] Keep the existing type scale and one primary action per surface.

**Touch:** `apps/web/src/app/settings-notifications.tsx`,
`apps/web/src/styles.css`, `docs/ui-ia.md`, `docs/visual-audit.md`.
**Done:** works at 1440, 1024, 390, and 320; no horizontal overflow; reviewed in
both themes.

Status: implemented. The panel lives in
`apps/web/src/app/settings-notifications.tsx`, loads from
`/api/v1/notifications`, and uses the existing panel/form/button grammar.
An e2e saves routing and verifies it survives a reload.

### A8. Offline shell and queued sends

- [x] Cache the shell and the last session list.
- [x] Queue composer sends while offline and replay in order on reconnect.
- [x] Show a clear offline/queued state; never silently drop a send.
- [x] Reuse the existing optimistic-send and retry path.

**Touch:** `apps/web/src/app/App.tsx` (thin), `apps/web/src/pwa.ts`,
`apps/web/public/sw.js`.
**Done:** a send made offline appears queued, survives a reload, and lands once.

Status: implemented. The worker precaches the built index's hashed assets
(not just `/`), the first session page and the last session header are cached
in local storage, and queued sends persist in `oktoso-send-queue-v1`. The queue
replays on `online` or an open event stream, in order, with the original
idempotency key. An offline auth check keeps the cached shell open. E2e covers
queue, reload, reconnect, and one POST.

### A9. Tests and docs

- [x] e2e/transport: capture the encrypted request with a mocked push
  receiver, assert one delivery, and assert the service worker turns the
  payload into a notification with the deep link.
- [x] Quiet hours suppress, then flush the digest after the window (service
  test).
- [x] Unit: coalescing, retry cap, subscription cleanup, payload size.
- [x] Docs: `deployment.md` (VAPID, HTTPS, reserved channels), `ui-ia.md`,
  `interaction-contract.md`, `visual-audit.md`.

**Done:** `pnpm test`, `pnpm test:e2e`, `pnpm brand:check`, and
`pnpm openapi:check` pass.

Status: complete. The browser-side push handler is tested by dispatching a
`PushEvent` in the live service worker and stubbing `showNotification`; the
wire payload is tested by capturing the `fetch` the sender makes to a fake
`https://` receiver (real VAPID keys, real ECDH subscription, encrypted
`aes128gcm` body). A full hub-to-HTTPS-receiver e2e is deliberately skipped
because the push library requires TLS and the repository does not commit a
test certificate.

Release: the branch is release-ready. `release-please` will cut `0.1.29` when
the branch merges; nothing is published from the worktree.

## Phase 4 — Supervisor

Target: 4–6 weeks. Shipped in `v0.2.0` together with Phase 3.

Status: complete, including validation against a real OpenCode provider.
Attention, session-idle/error, and schedule watchers are implemented, with the
low-risk answer policy, dry-run, leases, budgets, quiet hours,
notify/retry/escalate/start actions, approvals in the Inbox and Settings,
always-allow shapes, runs, pause with an in-flight abort, MCP tools, and the
CLI. Validation found and fixed one integration bug: answers now go through the
provider form action instead of a chat message, which did not resolve the form.

### B1. Contracts

- [x] `zAutomationWatcher` with attention, session, and schedule triggers.
- [x] `zAutomationRun` (id, watcherID, trigger, decision, reason, sessionRef,
  attentionID, action, at).
- [x] `zAutomationApproval` (attention identity, action, reason, plan, status,
  expiry).
- [x] `automation.run` and `automation.approval` event types.

### B2. Watcher runtime

- [x] Attention events (questions, permissions, approvals, errors).
- [x] Session idle/error triggers with a poll and a stability window.
- [x] Schedule triggers on `everyMs`.
- [x] Match conditions without fetching every session on every event.
- [x] Lease per watcher + target so duplicate events cannot act twice.
- [x] Debounce idle/running flaps by resetting the stability timer on a status
  change.

### B3. Policy and risk

- [x] Allowlist low-risk shapes: boolean and single-select with explicit,
  non-destructive, non-sensitive options. Never free text, never multi-select.
- [x] Escalate everything else to the approval queue, with a concrete proposed
  choice when the watcher names one.
- [x] Enforce actions/hour and actions/day, globally and per watcher.
- [x] Quiet hours: answer and retry escalate instead of acting.
- [x] Record the policy decision on every run.
- [x] No token budget. A per-action token charge cannot be computed before an
  action: `sendMessage` returns only `accepted` and a message id, and session
  usage arrives after the provider's reply. Actions/hour and actions/day are
  the enforced cost guards; see `deployment.md`.

### B4. Actions

- [x] Auto-answer, escalate, notify, and retry.
- [x] Every action goes through the existing service path.
- [x] Retry a failed action once before recording it as failed.
- [x] start-from-template: a `start` action references a configured
  template and creates a session; schedule watchers may omit
  `condition.sessionRef`. Dry-run, budgets, and the startup lease apply.

### B5. Approval queue

- [x] Pending approvals with the session, watcher, policy reason, and a typed
  `actionable`/`proposed` summary. The execution plan stays in hub state.
- [x] Approve and deny from the API, the Settings panel, and the Inbox.
- [x] Inbox uses the existing group and card grammar; approvals count toward
  the attention badge.
- [x] "Always allow this shape": a two-step confirmation in Settings stores a
  bounded fingerprint (watcher + question kind + option labels + selected
  label), only for normal explicit questions with a safe choice. Settings lists
  remembered shapes with uses and Revoke.
- [x] G2 approvals: fetched directly and merged into the Inbox; Approve/Deny
  dispatch to `actOnApproval`. Simulator coverage; hardware validation pending.

### B6. Audit and kill switch

- [x] Append every run with watcher, decision, reason, action, and result.
- [x] Global pause and per-watcher pause.
- [x] A paused hub or watcher drops new work.
- [x] Interrupt an action already in flight: pause and per-watcher pause abort
  the active signal; the run records `skipped / aborted`. A request that already
  reached the provider may still complete; idempotency keeps a retry safe.

### B7. MCP and CLI

- [x] `automation_list`, `automation_pause`, `approvals_list`,
  `approvals_act`; write tools stay behind `--allow-write` and the token tool
  allowlist.
- [x] `oktoso automation status|pause|resume`, including `--watcher <id>`.
- [x] `oktoso://automation` MCP resource with subscription updates.

### B8. Safety tests

- [x] Duplicate events never double-act (lease).
- [x] Dry-run sends nothing.
- [x] A destructive question always escalates.
- [x] Budget exhaustion stops the watcher cleanly.
- [x] Pause stops new work.
- [x] Quiet hours escalates instead of answering.
- [x] Session idle/error and schedule triggers fire once.
- [x] Retry-once and retry-action tests.
- [x] Kill switch stops an action mid-flight.
- [x] Approval execution on a real provider. Verified on OpenCode 2.3.0: an
  escalated form is answered from the approval queue and the `question` tool
  ends `completed`. The answer path uses the provider form action, because a
  plain message leaves the form pending.
- [x] A form that offers a free-text answer is never auto-answered. The hub
  marks provider questions as free-text capable, so an `answer` watcher
  escalates on OpenCode; only an approved or always-allowed shape answers.
- [x] A form no single select field can answer gets an approval with no
  executable plan: approving records that a human handled it in the provider UI
  instead of sending a message that would leave the form pending.

**Phase done:** the acceptance in `roadmap.md` passes on fake providers and one
real session.

## Phase 5 — Recall and lineage

Target: 3–4 weeks. Released as `0.2.2`.

### C1. Transcript cache

Status: done. `TranscriptCacheService` keeps a JSON copy of what the hub already
read from a provider, under `dataDir/transcripts` (`0600`, one file per session
plus an index). The settings panel is the opt-in.

- [x] Write-through on message reads; keyed by session ref and provider
  `updatedAt`. Pages of the same revision merge by message id, so a paginated
  read builds one transcript instead of replacing it. A new `updatedAt`
  replaces the stored copy.
- [x] TTL and size cap; evict least recently used. TTL is checked on read and at
  start-up; the session cap evicts the oldest `lastUsedAt` first.
- [x] Opt-in in settings, with a clear privacy note. Turning it off deletes every
  stored transcript; **Clear cache** does the same without disabling it.
- [x] Never serve cache as authoritative when the provider is reachable. Reads
  always go to the provider; the cache is write-through only and a failed write
  never fails the read.

### C2. Index

Status: done. `SearchIndexService` is a hand-rolled inverted index over the
cached transcripts, in memory as typed arrays with a binary posting snapshot
under `dataDir/search`.

- [x] Choose the index: hand-rolled. A 500-session spike compared it with
  MiniSearch and SQLite FTS5: at p95 the hand-rolled index answered in 2.7 ms
  versus 5.5 ms and 10.3 ms, and used 5 MB of heap versus 141 MB. FTS5 stays the
  runner-up if phrases and snippets ever justify a database. The committed
  harness (`scripts/bench-search.ts`) measures this implementation at 1.6 ms
  p50 / 2.5 ms p95, 55 ms reload, and +12 MB of heap.
- [x] Index message text, role, session title, and project. Identifiers split on
  camelCase and snake_case, so `sessionService` matches `session`.
- [x] Update incrementally; rebuild on schema change. Writes land in a delta
  layer that compacts into a fresh seal. At start the snapshot is loaded and
  reconciled against the cache in the background; an unreadable or inconsistent
  snapshot is discarded and rebuilt.
- [x] Persist under `dataDir`; bounded memory. `meta.json` plus a binary
  postings file (14 MB for 500 sessions), one document table of typed arrays,
  and snippets capped at 200 characters.
- [x] Snippets survive eviction: each document keeps a bounded excerpt, so a hit
  stays readable after its transcript leaves the cache.

### C3. Search route

Status: done. `GET /api/v1/search` reads the transcript index; the UI wiring is
C4.

- [x] Implement `GET /api/v1/search?q=&scope=&provider=&status=&cursor=`.
- [x] Return sessions and messages with snippets; keep the existing
  `zSearchResult` shape and extend it only additively (`match`, `messageID`,
  `role`, `createdAt`, `score`). The messages scope returns one row per matching
  message; sessions dedupe by ref and keep their best message.
- [x] Rank title matches above body matches; dedupe sessions. Ordering is
  score, then session `updatedAt`, then ref, so an offset cursor is stable.
- [x] Cap result size and paginate. The index ranks at most 500 candidates per
  query; pages are 20 by default and 50 at most, with opaque cursors and a 400
  on a corrupt one.

### C4. Search UI

Status: done.

- [x] Add the messages scope to `SearchView`. A `Scope` control switches
  Sessions (session metadata, provider-backed) and Messages (cached
  transcripts), and the choice lives in the URL.
- [x] Show snippets with the matched term highlighted. Whole-word,
  case-insensitive matching, rendered as `<mark>`; a deep match is re-cut from
  the cache when the transcript is still there.
- [x] Keep filters and the back stack intact. Provider and status apply to both
  scopes; typing replaces the history entry, filters and scope add one.

### C5. Lineage

Status: done.

- [x] `GET /api/v1/sessions/:ref/lineage` resolving `parentRef` chains with
  cycle protection. The walk stops at 25 ancestors, 100 nodes, a repeated ref,
  or an ancestor the provider no longer knows; `truncated` says when a cap cut
  it.
- [x] Show forks, branches, and subagent children. The details panel lists the
  whole family, indented by depth from the root, with the current session
  marked. A single-session family renders no section.
- [x] Open any node from the tree. Each row is a button; the current row is not
  a link.

### C6. Cost view

- [x] Compute per-provider, project, model, and day from the existing session
  list pages, walked client-side; no aggregation endpoint.
- [x] Place it as the first section of the Overview destination, with no new
  route or nav item.
- [x] Show tokens and cost with tabular figures; an unreported figure is an em
  dash and the note names how many sessions reported nothing.

### C7. Retention and export

Status: done.

- [x] `GET /api/v1/sessions/:ref/export?format=md|json`. Markdown carries a
  header block and one section per message; JSON carries the session, the
  transcript, and the export time. Attachment files are listed, not embedded.
- [x] TTL and delete for drafts, read markers, reply feedback, and cache.
  Retention is per store (`0` = never): cache 7 days, markers and feedback 30,
  drafts never. `DELETE /api/v1/settings/local-data/:store` clears one;
  deleting the collection clears all, including the cache and its index.
- [x] Document what is local and what is provider-owned. See the Local data
  table in `deployment.md`; clearing local data never calls a provider.

**Phase done:** search finds an old phrase in under 200 ms on a 500-session
fixture; export round-trips; deleting local state leaves the provider untouched.

## Phase 6 — Provider platform

Target: 6–8 weeks. Skipped by the owner; revisit on a third provider.

### D1. Hermes adapter

- [ ] Health, sessions, messages, runs, and streaming.
- [ ] Approvals and clarify requests map to attention.
- [ ] Fixtures and contract tests; live validation against a real instance.

### D2. Hermes TUI gateway

- [ ] WebSocket path for existing sessions the API server will not bind.
- [ ] Reconnect and message ordering.
- [ ] Document the split between API-created and existing sessions.

### D3. SDK and conformance suite

- [ ] Make the adapter contract a public entry point.
- [ ] Conformance suite covering all 17 capability flags, pagination, error
  mapping, and cancellation.
- [ ] `docs/provider-adapters.md` with a worked example.

### D4. Proof adapter

- [ ] Add one community or OpenAI-compatible adapter using only the SDK and
  docs.
- [ ] Time the integration and fix the docs where it stalled.

### D5. UI

- [ ] Capability and health badges on the Providers screen.
- [ ] Explain a missing capability in place, not as a dead control.

**Phase done:** the Hermes acceptance in `roadmap.md` passes; the proof adapter
passes the suite with no hub changes.

## Phase 7 — MCP southbound

Target: 6–8 weeks. Skipped by the owner; revisit on a tool-governance need.

### E1. Client registry

- [ ] Persist MCP server configs, credentials, and health.
- [ ] Support stdio and Streamable HTTP.

### E2. Discovery

- [ ] List tools and capabilities; cache with a TTL.
- [ ] Surface tool names to the policy layer, not to clients directly.

### E3. Policy and execution

- [ ] Deny by default; per-tool and per-provider allowlists.
- [ ] Timeouts, retries, idempotency, and error mapping.
- [ ] No raw credential reaches a northbound client.

### E4. Northbound exposure

- [ ] Optional tools for northbound agents, behind a separate scope.
- [ ] Audit every call.

### E5. UI and tests

- [ ] Connections screen with health and discovered tools.
- [ ] Policy editor and audit view.
- [ ] Tests: denied tool never reaches the provider; timeout is normalized.

**Phase done:** the acceptance in `roadmap.md` passes.

## Phase 8 — Hardening and observability

Target: 2–3 weeks. Release: `0.2.x` (phase 5 already shipped as `0.2.2`).

### F1. Metrics

Status: done.

- [x] `/metrics` in Prometheus text format, behind the owner bearer token.
- [x] Provider health, event sequence and buffer, SSE clients, notification
  delivery, automation decisions, open approvals, paused state, device count.
  No message content, titles, or credentials; bounded-log counters carry a
  `_recent` suffix. Run durations are not exposed: automation runs record when a
  decision happened, not how long the action took.

### F2. Logs and redaction

Status: done.

- [x] Structured logs with a central redaction pass. One pass covers keys,
  registered secrets, and token-shaped substrings; it runs before stdout,
  stderr, the log file, and test sinks.
- [x] A test that asserts tokens and message bodies never appear at info level.
  See `packages/hub/src/lib/redact.test.ts`; content-shaped keys are masked and
  `main.ts` registers the owner token, provider credentials, VAPID key, and MCP
  tokens at startup.

### F3. Backup and restore

- [x] Snapshot `dataDir` and restore it into a fresh hub.
  `oktoso backup --out <dir>` writes a hashed manifest plus a copy of the data
  directory; `oktoso restore --from <dir> --force` verifies every hash, refuses
  a running hub, and keeps the replaced directory.
- [x] Document what is safe to copy and what must be re-paired. See the Backup
  and restore table in `deployment.md`: config separately, pairing survives with
  the same owner token, notification keys travel with `dataDir`.

### F4. Packaging

Status: done.

- [x] Docker image (`Dockerfile`), Termux install script
  (`packaging/termux-install.sh`), and a systemd unit
  (`packaging/oktoso.service`).
- [x] Clean Node 24 install check: CI runs Node 24, the image is pinned to
  `node:24-alpine`, and `scripts/smoke-image.sh` builds, boots, and probes the
  image (health 200, unauthenticated `/metrics` 401).

### F5. Acceptance runs

Status: blocked on hardware — a Termux device and a TLS/VPN path. The runbook is
in `deployment.md` ("Acceptance run"); results go in the same section.

**F5 exception (2026-11-16).** F5 needs a Termux device and a TLS/VPN path;
neither is available. Phase 8 closes on the four acceptance bullets in
`roadmap.md`, none of which depend on F5. What stays unvalidated is the Android
install path (`packaging/termux-install.sh`) and the external-origin path.
Compensating evidence: the image builds, boots, answers health, and rejects an
unauthenticated `/metrics` scrape (`scripts/smoke-image.sh`), and the seven-step
runbook is unchanged. Until the runbook runs and its results are recorded,
`deployment.md` and the README must not claim a verified Termux install. A
failed run is a `0.2.x` patch, not a phase reopen.

- [ ] Real Termux and cross-host run.
- [ ] TLS/VPN validation.

### F6. Load and security

Status: done.

- [x] SSE fan-out and event-burst load test (`scripts/load-test.ts`): 500
  events to 200 subscribers, 100k serialized frames, p95 0.099 ms per publish.
- [x] Security review with a written record (`docs/security-review.md`):
  fourteen findings, two documented gaps (advisory body caps, a spoofable
  pairing-limit key), residual risks listed.

### F7. Rust decision

Status: done.

- [x] Decision record (`docs/rust-decision.md`): stay on TypeScript; triggers
  for reopening are throughput, a CPU-bound feature, Termux memory, or a second
  maintainer; any future port is gated on the contract tests, which do not exist
  yet.

## Phase 9 — Surfaces and bets

Schedule one bet at a time, each with its own acceptance before it starts.

- [ ] G1. Cross-provider handoff. Skipped until a third provider exists.
- [x] G2. Templates and recipes. Slice 1: `AutomationView` carries
  `templates`, `POST /api/v1/automation/templates/:id/start` and
  `oktoso template list|start` start one as a human action, ignoring pause, dry
  run, budgets, and quiet hours. Slice 2: the Settings → Automation Templates
  panel starts one and opens the session, and approval/run reasons render as
  plain sentences (`design-v1.21`). The New-session panel stays unchanged: a
  prefilled form would add a second create path.
- [ ] G3. G2 ambient mode and hardware acceptance. Ambient is impossible on SDK
  0.0.16; run the hardware checklist when the glasses are in hand.
- [x] G4. Local reply drafting through Ollama. No code was needed: the reply
  surface already speaks OpenAI-compatible `/chat/completions`. Verified
  2026-11-16 against a local llama.cpp router: five to six options per fixture
  in ~1.6 s, valid JSON, no `response_format` fallback needed. The recipe uses
  placeholders for the host and model id in `wearables.md`.
- [x] G5. Multi-user decision. Deferred; owned by
  `docs/multi-user-decision.md`.
- [x] G6. Hub agent spike (session scope, read-only). `pnpm ask <ref>
  "question"` (`scripts/ask.mjs`) assembles session meta, attention, the pending
  question, a deduped tool-action digest, and the text tail, then makes one
  completion. Read-only by construction: it never calls a write route.
  - Context shape mattered more than the model. The first cut ("last 20 raw
    messages") fed a tool-heavy session nothing but tool calls, and the model
    reported that no file edits were visible when four were. Splitting a
    **deduped action digest** from the **text-only transcript** fixed it: the
    same question then named the edited files.
  - Model comparison, 2026-11-19, same four sessions and prompts, warm, 24 GB
    host. Qwen 3.8 27B at 32k ctx: 0.5–2.7 s (avg 1.7), 19.1 GB VRAM.
    Ternary-Bonsai 2 27B: 2.6–3.7 s (avg 3.0), 14.4 GB. Both were correct on
    the planning and Hermes sessions. Qwen cited turns and stayed tighter;
    Bonsai mistyped a session ref and answered the cache session from the wrong
    thread. Qwen is the default; `ASK_MODEL` overrides it.
  - The Qwen preset's earlier load failures were VRAM, not config: with VR and
    the ASR server stopped, the unchanged 131k preset loaded. `ctx-size` is now
    32768 (the largest observed prompt is ~4k tokens), costing 2.7 GB less.
    `~/.llama/draft/Qwen3.8-27B-Aggressive-FastMTP-32K.gguf` cannot be used as
    a draft head: 32k vocab against the model's 248k.
  - Honesty held. On an error session whose recorded turns contain no error
    text, both models said so and named the next thing to check instead of
    inventing a cause.
  - Cold start is cheaper than assumed: a cold 27B load added ~2.5 s. M1 can
    show a brief "waking model" row; it does not need a state machine.
  - The assistant and dictation do not co-reside with a 27B on 24 GB. With Qwen
    resident, GlassScribe OOMs after three retries (211 MB free), falls back to
    CPU, and a 3.9 s clip takes 43 s. ASR now goes through the orchestrator at
    `/asr/...` (`gpu-ochestrator` `0679b5e`): a transcription POST that needs
    VRAM unloads llama models first, ComfyUI is reclaimed if idle, and an LLM
    request waits for that swap instead of racing it. Measured: cold switch
    8.4 s (unload + ASR load + transcript), warm 0.5–0.7 s, return trip ~4 s.
    The hub's transcription base URL is `http://127.0.0.1:42068/asr/v1`; a
    direct `:8100` call bypasses the gate and can still starve itself.

- [x] G7. Session assistant (M1: read-only, session scope). The chat topbar's
  **Ask** action opens one hub-owned thread per session
  (`apps/web/src/app/AssistantDock.tsx`). `AssistantService` assembles session
  meta, attention, the pending question, a deduped tool digest, and the text
  tail, then makes one streamed completion; there is no tool loop and no write
  route. Routes: `GET /api/v1/assistant/status`, `POST/GET
  /api/v1/assistant/threads`, `GET/DELETE /api/v1/assistant/threads/:id`,
  `POST /api/v1/assistant/threads/:id/messages`, `POST
  /api/v1/assistant/runs/:id/stop`, `GET /api/v1/assistant/runs/:id/events`
  (SSE). Threads live in hub state (40 threads, 200 turns each).
  - Model config is `assistant` in `hub.config.json` (enabled, baseUrl, model,
    timeoutMs, maxContextMessages), falling back to the reply endpoint and
    model when empty. On this host it is Qwen 3.8 27B at 32k.
  - Measured live: 1.7–2.7 s warm for a 2–4k-token context; 8.4 s for the first
    dictation after an assistant answer because the 24 GB card swaps ASR in
    (see G6). The dock streams deltas, keeps partial text on Stop, and hides
    itself when the hub has no model.
  - Verified at 1440/1280/1024/390px in both themes, no overflow and no console
    errors; `tests/e2e/assistant.e2e.ts` drives the full loop against a fake
    model and asserts the thread survives a reload.
  - Not in M1: tools, writes, project and global scopes, supervisor-triggered
    drafts, G2 conclusions. Those are M2–M5 and each needs its own acceptance.

- [x] G8. Assistant writes (M2: session scope, confirmed). `assistant.allowWrite`
  (default false) adds one model tool, `propose_session_action`, with kinds
  `send`, `answer`, and `interrupt`. The proposal is stored on the assistant
  turn and surfaced as an action card; nothing reaches a provider until the
  human presses the primary action. `POST /api/v1/assistant/threads/:id/turns/
  :turnId/action` is the only write path, and it reuses `SessionActions` and
  `sessions.interrupt`, so answers still validate against the live question
  revision.
  - Decisions append to `dataDir/assistant-audit.jsonl` (thread, turn, action,
    kind, session, event, outcome, duration; never message text).
  - A pending action locks the thread: a second question returns 409 and the
    composer explains why. A failed proposal stays visible with its error.
  - Verified live against Qwen 27B (proposal, editable text, cancel) and in
    `tests/e2e/assistant.e2e.ts` against a fake provider (confirm → send →
    `Sent` → reload).
  - Hardening after audit: cancel is no longer gated by `allowWrite`; a
    decision is a compare-and-set through a transient `deciding` status (one
    send, one audit row, 409 for the second device); `postMessage` is
    single-flight per thread and honours `idempotencyKey`; a rejected audit
    write is contained instead of crashing the hub; an SSE reconnect past the
    end of a run replays its terminal event; `answer` sends the full option
    text, not the 80-char label; interrupted decisions become `failed` at
    startup.
  - Still out of scope: approvals, automation actions, project/global scopes.

- [x] G9. Assistant evidence line. Every assistant turn stores
  `{messages, omitted, chars, attention}` for the context it actually read and
  renders it at 10px with token usage (`Read 8 turns · 1 attention item · 3252
  in · 94 out`). The transcript budget now drops the oldest turns first and
  clips each message head + tail, so a conclusion at the end of a long message
  is never the part that gets cut.

- [x] G10. Assistant thread time markers. Day separators (`Today`,
  `Yesterday`, date) and per-turn `HH:MM` make persisted history legible; each
  answer's context carries the session's last-activity time and renders it as
  `session as of …`, so an answer based on an older session says so. Turns
  written before the stamp existed are backfilled at boot from the newest
  provider message at or before the answer; when the provider cannot answer,
  they stay unstamped and the next boot retries.

- [x] G11. Assistant context blocks. The prompt separates hub facts from
  session data and adds `SITUATION` (now, idle time, age, parent), `HISTORY`
  (newest provider compaction, found by a cached deep scan outside the window),
  `WORK` (files and commands derived from tool calls), and `FAILURES` (failed
  shells with exit and output tail, failed tools, message errors). The evidence
  line reports the failure count. No model call is added. Hardening: the
  200-message history page is skipped when the tail's newest message id has not
  changed; an empty session never fetches it; the one-off deep scan is bounded
  by 5 pages and a 3-second budget; failure detail is passed through a
  credential redactor (`Bearer`/`Basic`, `sk-`/`ghp_`/`xox`, key/value tokens)
  before it reaches the model.

- [x] G12. Permission prompts stay in the Inbox. `buildAction` refuses to
  propose an `answer` when any pending question has `risk` other than
  `normal`; the failed card shows the provider's question, choices, and risk,
  with an Inbox link. Normal answer cards carry the question snapshot and a
  button that names the effect (`Answer "main"`). The write path is unchanged:
  one human decision, one send, audited.

- [x] G13. Expiry, eviction, and restart markers. Pending actions expire after
  24 hours (lazily, audited as `expired`); thread eviction is LRU by
  `updatedAt` and never removes a thread with a pending/deciding action; a
  thread left on a user turn by a restart gains one assistant turn saying the
  answer was interrupted. `init()` applies all three at boot.

## Cross-cutting work

- [ ] Keep `docs/openapi.yaml` generated; never hand-edit it.
- [ ] Add fake-provider fixtures with every new provider behavior.
- [ ] Add an e2e flow for every user-visible phase outcome.
- [ ] Update `ui-ia.md`, `interaction-contract.md`, `visual-audit.md`, and
  `design-lock.md` in the same change as UI work.
- [ ] Keep one primary action per surface and the existing type/space scales.
- [ ] Review dark and light, 1440/1024/390/320, and console errors before
  calling UI work done.

## Release map

| Version | Scope | Gate |
|---|---|---|
| `0.1.29` | Phase 3, slice 1: contracts, notification core, Web Push | e2e push delivery |
| `0.1.30` | Phase 3, slice 2: channels, quiet hours, settings | routing/quiet-hours tests |
| `0.2.0` | Phases 3 and 4: attention, PWA/offline, supervisor | phase acceptance |
| `0.2.2` | Phase 5: recall and lineage | search/export acceptance |
| `0.2.3` | Phase 8: hardening | automated acceptance, F5 exception |
| `0.3.0` | next minor: a Phase 9 bet | per-bet acceptance |

Patch releases inside a phase are expected. A phase does not merge to `main`
until its acceptance passes.

## Definition of done

A task is done when:

1. The contract change is in `packages/contracts` and OpenAPI is regenerated.
2. Unit tests cover the new logic, including the failure path.
3. An e2e test covers the user-visible outcome when there is one.
4. Docs are updated in the same change.
5. `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm brand:check`, and
   `pnpm openapi:check` pass.
6. No secret or message body is logged.
7. The change is independently revertible.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| iOS requires an installed PWA for push and shows no silent push | Detect and explain in Settings → Notifications |
| Push encryption and VAPID are easy to get wrong | Use a pinned, pure-JS implementation; test against a fake receiver |
| Notifications become noise | Coalesce by session, default digest for non-blocking, quiet hours |
| Auto-answer does something wrong | Dry-run default, allowlist only, approval queue, kill switch, audit |
| Transcript cache disagrees with the provider | Provider `updatedAt` invalidates; cache is never authoritative |
| Search index drifts or grows unbounded | Incremental update plus rebuild; TTL and size cap |
| `App.tsx` keeps growing | New UI in its own module; mount only from `App.tsx` |
| Hermes cannot bind existing sessions | Use the TUI gateway and document the split |
| Termux rejects a dependency | Verify pure JS before adopting; no native modules |
| Work collides with another active session | One branch per phase; docs-only changes stay path-scoped |

## Open decisions

These need an answer before the task that depends on them.

1. **Push implementation.** Resolved: `@block65/webcrypto-web-push` 2.0.0,
   pure JS and bundled. The transport accepts an injected sender so tests never
   hit the network.
2. **VAPID key location.** Resolved: generated at
   `dataDir/notifications/vapid.json` (mode `0600`) on first start, with a
   config override for operators who keep keys elsewhere.
3. **Channel scope.** Resolved: Web Push only. No ntfy, Telegram, or webhook
   sender is planned; the settings screen explains the HTTPS/localhost and iOS
   install requirements instead of offering another channel.
4. **Search index.** Resolved: hand-rolled inverted index with a compact
   posting snapshot. Measured on a 500-session fixture at p95: 2.7 ms
   hand-rolled, 5.5 ms MiniSearch, 10.3 ms SQLite FTS5, with 5 MB, 141 MB, and
   3.8 MB of heap respectively. A dependency becomes worth it only if relevance
   grows past field weighting into stemming, synonyms, or real phrase positions.
5. **Cache TTL and opt-in.** Default off or default on? Recommendation: default
   off, explicit opt-in, 30-day TTL, visible storage size. Owner: C1.
6. **Low-risk question shapes.** Recommendation: boolean and single-select with
   explicit options only; no free text, no destructive verbs. Owner: B3.
7. **G2 notifications.** Recommendation: no direct push; the phone notification
   is the alert and G2 shows it on next sync. Owner: A5/G3.
8. **Multi-user.** Recommendation: defer to Phase 9 at the earliest, and only
   with demand. Owner: G5.
9. **Device identity.** Pairing is stateless today. Recommendation: client-
   generated `deviceID` plus a label, stored with the subscription; per-
   subscription revoke. Avoid a server-side device registry until Phase 8.
   Owner: A4.
10. **Assistant model config.** Reuse the `reply` block or add one? The G6
    spike used a 27B model and the reply block points at a 4B. Recommendation:
    a separate `assistant` block (baseUrl, model, timeoutMs, maxSteps) that
    defaults to the operator's existing OpenAI-compatible endpoint, so reply
    drafting stays fast and the assistant can be stronger. Owner: M1.

## First sprint (two weeks)

Goal: a blocking question reaches a phone with the app closed and opens the
exact item. This proves the loop end to end before adding channels or offline.

1. **Day 1–2 — A1.** Contracts, config schema, OpenAPI regeneration.
2. **Day 3–4 — A2.** Notification service: routing, coalescing, quiet hours,
   delivery log, unit tests.
3. **Day 5–7 — A3.** Web Push transport, VAPID keys, expiry cleanup, fake
   receiver test.
4. **Day 8 — A4.** Subscription and settings routes, client methods, auth tests.
5. **Day 9–10 — A5.** Service worker, registration, deep links.
6. **Day 11 — A6 (minimal).** Settings panel: enable, test, device revoke.
7. **Day 12 — A9 (partial).** e2e: subscribe, trigger, deliver, click through.
8. **Day 13–14 — Docs and release.** `deployment.md`, `ui-ia.md`,
   `interaction-contract.md`; cut `0.1.29`.

Sprint exit criteria:

- A synthetic blocking attention produces exactly one push.
- Tapping it opens `/sessions/<ref>?attention=<id>`.
- A revoked subscription receives nothing.
- Quiet hours suppress a normal-priority item.
- All gates pass.
