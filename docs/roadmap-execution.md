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
- `App.tsx` is already 7,219 lines. New UI lands in its own module and mounts
  from `App.tsx`; do not grow the monolith.

## Workstreams and dependencies

```text
W1 Mobile loop      Phase 3 (notifications/PWA) ──> Phase 4 (supervisor) ──> Phase 9 (G2 ambient)
W2 Memory           Phase 5 (recall/lineage) ─────────────────────────────> Phase 8 (hardening)
W3 Platform         Phase 6 (providers) ──> Phase 7 (MCP southbound) ─────> Phase 8
```

- Phase 3 is independent. Start there.
- Phase 4 depends on the attention events (already shipped) and optionally the
  Phase 3 notification channel.
- Phase 5 is independent and can run in parallel with Phase 3/4 if there is
  capacity.
- Phase 6 is independent. Hermes is the first task because it closes a
  documented gap.
- Phase 7 depends on the Phase 4 policy layer and the Phase 6 capability model.
- Phase 8 lands last, but `/metrics` can be pulled forward at any time.
- Phase 9 depends on all of the above.

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
- [x] A form that offers a free-text answer is never auto-answered. OpenCode
  forms always add that option, so on OpenCode every `answer` watcher escalates;
  only an approved or always-allowed shape answers.

**Phase done:** the acceptance in `roadmap.md` passes on fake providers and one
real session.

## Phase 5 — Recall and lineage

Target: 3–4 weeks. Release: `v0.3.0`.

### C1. Transcript cache

- [ ] Write-through on message reads; keyed by session ref and provider
  `updatedAt`.
- [ ] TTL and size cap; evict least recently used.
- [ ] Opt-in in settings, with a clear privacy note.
- [ ] Never serve cache as authoritative when the provider is reachable.

### C2. Index

- [ ] Choose the index: a pure-JS package or a small hand-rolled inverted
  index. See open decisions.
- [ ] Index message text, role, session title, and project.
- [ ] Update incrementally; rebuild on schema change.
- [ ] Persist under `dataDir`; bounded memory.

### C3. Search route

- [ ] Implement `GET /api/v1/search?q=&scope=&provider=&status=&cursor=`.
- [ ] Return sessions and messages with snippets; keep the existing
  `zSearchResult` shape and extend it only additively.
- [ ] Rank title matches above body matches; dedupe sessions.
- [ ] Cap result size and paginate.

### C4. Search UI

- [ ] Add the messages scope to `SearchView`.
- [ ] Show snippets with the matched term highlighted.
- [ ] Keep filters and the back stack intact.

### C5. Lineage

- [ ] `GET /api/v1/sessions/:ref/lineage` resolving `parentRef` chains with
  cycle protection.
- [ ] Show forks, branches, and subagent children.
- [ ] Open any node from the tree.

### C6. Cost view

- [ ] Compute per-provider, project, model, and day from the sessions the client
  already fetches.
- [ ] No new aggregation endpoint.
- [ ] Show tokens and cost with tabular figures.

### C7. Retention and export

- [ ] `GET /api/v1/sessions/:ref/export?format=md|json`.
- [ ] TTL and delete for drafts, read markers, reply feedback, and cache.
- [ ] Document what is local and what is provider-owned.

**Phase done:** search finds an old phrase in under 200 ms on a 500-session
fixture; export round-trips; deleting local state leaves the provider untouched.

## Phase 6 — Provider platform

Target: 6–8 weeks. Release: `v0.4.0`.

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

Target: 6–8 weeks. Release: `v0.5.0`.

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

Target: 2–3 weeks. Release: `v0.6.0`.

### F1. Metrics

- [ ] `/metrics` in Prometheus text format.
- [ ] Provider health, event lag, SSE clients, notification delivery, action
  counts, run durations. No message content.

### F2. Logs and redaction

- [ ] Structured logs with a central redaction pass.
- [ ] A test that asserts tokens and message bodies never appear at info level.

### F3. Backup and restore

- [ ] Snapshot `dataDir` and restore it into a fresh hub.
- [ ] Document what is safe to copy and what must be re-paired.

### F4. Packaging

- [ ] Docker image, Termux archive, systemd unit.
- [ ] Clean Node 24 install check.

### F5. Acceptance runs

- [ ] Real Termux and cross-host run.
- [ ] TLS/VPN validation.

### F6. Load and security

- [ ] SSE fan-out and event-burst load test.
- [ ] Security review with a written record.

### F7. Rust decision

- [ ] Decision record, with contract tests as the gate if the answer is yes.

## Phase 9 — Surfaces and bets

Schedule one bet at a time, each with its own acceptance before it starts.

- [ ] G1. Cross-provider handoff.
- [ ] G2. Templates and recipes.
- [ ] G3. G2 ambient mode and hardware acceptance.
- [ ] G4. Local reply drafting through Ollama.
- [ ] G5. Multi-user decision. Default answer: defer.

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
| `0.3.0` | Phase 5: recall and lineage | search/export acceptance |
| `0.4.0` | Phase 6: Provider platform and Hermes | conformance suite |
| `0.5.0` | Phase 7: MCP southbound | policy acceptance |
| `0.6.0` | Phase 8: hardening | acceptance runs |

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
4. **Search index.** Add a pure-JS dependency (for example MiniSearch) or
   hand-roll a small inverted index? Recommendation: measure with a hand-rolled
   index on the 500-session fixture; adopt a package only if relevance is poor.
   Owner: C2.
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
