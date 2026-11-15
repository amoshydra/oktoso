# Oktoso — naming and roadmap

Status: Phase 0, Phase 1, and Phase 2 complete; Phase 3 complete; Phase 4
complete except real-provider validation. `v0.2.0` is published. This revision is the 2026-11-14 project audit and re-plan. The
phase-level work breakdown is in [`roadmap-execution.md`](roadmap-execution.md).

## Name

**Final name: Oktoso**

**Package:** `@amoshydra/oktoso`
**Binary:** `oktoso`
**Invocation:** `npx @amoshydra/oktoso`

Tagline:

> The agent hub and control surface.

### Why Oktoso

Oktoso is a coined name: a playful, many-armed hub that is easy to say and does
not describe a single provider, model, or client. It fits the current session hub
and leaves room for the MCP control plane:

- **Today:** sessions from OpenCode, Open WebUI, Hermes, and wearable clients meet
  in one place.
- **Next:** MCP servers and tools become additional connections.
- **Later:** an LLM agent watches events and controls providers through explicit,
  permissioned connections.

The name is short enough for `npx @amoshydra/oktoso` and broad enough to survive
the product growing beyond chat sessions.

### Shortlist

| Name | Fit today | Future MCP/control | Distinctive | `npx` readability | Verdict |
|---|---|---|---|---|---|
| **Oktoso** | Strong | Strong | Strong | Strong | **Chosen** |
| MechBay | Strong | Strong | Strong | Strong | Finalist; not chosen |
| Gantry | Strong | Strong | Strong | Strong | Rejected: used by AI agent projects |
| Agentarium | Good | Good | Strong | Medium | Rejected: several AI projects use it |
| Ringmaster | Strong | Strong | Strong | Medium | Rejected: several AI products use it |
| Orrery | Strong | Strong | Strong | Good | Rejected: multiple AI orchestration projects |
| Rookery | Strong | Strong | Strong | Good | Rejected: multiple AI agent products |
| Patchbay | Strong | Strong | Strong | Good | Rejected: audio-hardware collision |

### Availability check

Checked against the public npm registry and GitHub:

- `oktoso` is not published on npm, scoped or unscoped.
- `@amoshydra/oktoso` is unpublished.
- `github.com/amoshydra/oktoso` is available at the time of writing.
- Oktoso is close to **Okteto AI**, a Kubernetes development platform. The scoped
  package and product are distinct, but search/discovery may still confuse them.
- Domains are not part of this rename.
- Trademark clearance is **not** done.

Before publishing, verify that the npm account or org owns the `@amoshydra`
scope:

```sh
npm whoami
npm org ls amoshydra
```

If the scope is not owned, create it or use the account scope that npm assigns.
Publish a scoped package publicly with:

```json
{
  "name": "@amoshydra/oktoso",
  "publishConfig": { "access": "public" }
}
```

## Where the project is

The 2026-11-14 audit read the repository at `199624a` plus the reply slice that
followed it. It was static: source, tests, contracts, and docs. No load test and
no real-hardware run.

### Snapshot

- 46k lines of TypeScript across `packages/` and `apps/`.
- 54 HTTP endpoints in 16 route files, plus the hosted `/mcp` surface.
- 63 test files, 459 unit tests, and 14 Playwright end-to-end tests against fake
  providers.
- Three live surfaces over one API: web, Even G2, and the terminal dashboard.
- `v0.1.28`, published to npm with release-please and OIDC provenance.
- 17 capability flags negotiated per provider.

### Strengths

| Strength | Why it matters |
|---|---|
| Contracts-first (`zod` → generated OpenAPI, CI-checked) | New fields stay safe; clients can version independently |
| Capabilities over assumptions | A partially capable provider does not break the UI |
| Thin clients, hub-owned credentials | Surfaces are replaceable; secrets live in one place |
| Deterministic fake providers plus e2e | Rare regression safety for a project this size |
| Three shipping surfaces | G2 is a real differentiator, not a mockup |
| MCP northbound already done | Scopes, allowlists, rate limits, audit, and resource subscriptions |
| Design-lock and interaction contract | Objective UI review and no silent redesign |

### Gaps, ranked by user impact

1. **No push notifications.** The only way to learn that a question is waiting is
   to open the app or look at the glasses. This is the largest product hole for a
   mobile-first user.
2. **No installable offline PWA.** `design.md` calls the web client a PWA, but
   there is a manifest and no service worker, offline shell, or queued send.
3. **Hermes is health-only.** `provider-registry.ts` checks
   `/v1/capabilities`, but only the OpenCode and Open WebUI adapters exist. The
   README promise is ahead of the code.
4. **Search is sessions-only.** `contracts/search.ts` advertises
   `scope: "messages"`, and no route implements it. A dangling contract is worse
   than no contract.
5. **No session-family tree.** `parentRef` and subagent children exist, but no
   lineage view. Still an open Milestone 1 item.
6. **No cost or token rollups.** Every session carries cost and tokens; nothing
   aggregates them.
7. **`App.tsx` is 7,219 lines** and `styles.css` is 4,094. `reply-service.ts` is
   1,740. Not urgent, but every UI change pays the tax.
8. **No metrics endpoint.** `/api/v1/diagnostics` is not a substitute for
   `/metrics`.
9. **Local state grows without retention.** Drafts, read markers, and reply
   feedback are JSON stores with no TTL or per-record delete. Reply feedback
   has an export route; nothing else does.
10. **No device-management screen.** Pairing exists, but token rotation revokes
    every session and there is no per-device revoke.

### Verdict

Oktoso is a strong multi-provider **dashboard** with a genuine control-plane
foundation. It observes a lot and acts on very little automatically. The next
phase is not more read surfaces; it is closing the loop between "the hub saw
something" and "the hub did something about it."

## Strategy

The product moves through three modes, in this order:

1. **Dashboard** — see every session and what needs attention. Largely done.
2. **Supervisor** — wake you only when it matters, and handle the safe cases.
3. **Delegated operator** — act under explicit policy, with audit and a kill
   switch.

Four assets are under-exploited and determine the roadmap:

- **Attention is the product.** The inbox is the only screen that creates a daily
  habit. Notifications, dedupe, quiet hours, and one-tap answers beat new browse
  views.
- **The write path is half-built.** Send, fork, retry, edit, answer, and a reply
  model with a feedback store already exist. What is missing is a policy layer.
- **Data gravity is unexploited.** The hub sees every transcript and stores
  almost none of it. A write-through cache (providers stay canonical) unlocks
  message search, cost visibility, and export.
- **The capability model is an SDK waiting to happen.** Extracting it turns
  "supports three providers" into "anyone can add one."

The strategic fork:

- **A. Personal command center** (now): notifications, PWA, G2, automation,
  recall. Deep and excellent for one operator.
- **C. Agent infrastructure** (next): watchers, policy, MCP southbound, provider
  SDK. This is where the "control plane" claim becomes true.
- **B. Team control plane** (defer): multi-user, RBAC, shared provider pools.
  It is a different product and breaks a deliberate non-goal.

Sequence A → C. Defer B until there is demand.

### Re-sequencing note

This revision changes the earlier plan:

- Old Phase 3 (MCP southbound) becomes **Phase 7**. The mobile loop comes first.
- Old Phase 4 (continuous control) splits into **Phase 3 (notifications)** and
  **Phase 4 (supervisor)**.
- Old Phase 5 (surfaces and ecosystem) becomes **Phase 9**, with the provider SDK
  promoted to **Phase 6** and Hermes folded into it.

## Roadmap

### Phase 0 — Foundation (done)

- Provider registry and capability model.
- Stateless owner/session auth, pairing, refresh.
- Session index, transcript, prompt send, create, interrupt.
- Event bus, attention, drafts, settings.
- Web client, terminal dashboard, Even G2 question/reply flow.
- Question detection, stale revisions, idempotent answer retry.

### Phase 1 — Publishable Oktoso (done)

Published as `v0.1.11` on npm.

- [x] Rename package to `@amoshydra/oktoso`; binary `oktoso`.
- [x] Rename workspace packages to `@amoshydra/oktoso-*`.
- [x] Add `publishConfig`, `files`, and `prepublishOnly`.
- [x] Add release-please and the GitHub Actions workflow for npm OIDC publishing and provenance.
- [x] Verify `npx` from a clean temporary directory after publishing.
- [x] Rename the GitHub repository to `oktoso`.
- [x] Keep **agent hub** as the descriptive subtitle, not the package name.

Acceptance:

```sh
npx @amoshydra/oktoso
npx @amoshydra/oktoso status
npx @amoshydra/oktoso pair
```

Starts without native modules, prints the dashboard, and serves the web/G2 apps
from the package.

### Phase 2 — MCP northbound: agents control Oktoso (done)

The `oktoso mcp` stdio bridge and the hub-hosted `/mcp` Streamable HTTP endpoint
are implemented. Read-only is the default; `--allow-write` and hosted token
scopes gate writes. Hosted tokens carry provider and tool allowlists, per-client
rate limits, and call timeouts. Every hosted tool call is audited without
logging prompts or message text. `oktoso://attention` and `oktoso://sessions`
resources support subscriptions. OAuth remains a follow-up.

Tools/resources:

- `providers_list`, `providers_check`
- `sessions_list`, `sessions_get`, `sessions_messages`
- `sessions_send`, `sessions_create`, `sessions_interrupt`, `sessions_mark_read`
- `attention_list`, `attention_act`
- `questions_get`
- `oktoso://attention` and `oktoso://sessions` resources with subscriptions

Acceptance (met): an external agent connects over stdio or hosted `/mcp`, lists
sessions, reads a transcript, and acts on an attention item; writes to its own
session are rejected, destructive actions require approval, and resource
subscribers see attention updates.

### Phase 3 — Always-on attention (complete)

Goal: the hub reaches you. A blocking question, a failed run, or a finished
long-running session arrives on the phone with the app closed, and tapping it
opens the exact item.

This is the highest-leverage phase because the product's daily habit is the
inbox, and the current loop requires opening the app.

Deliverables:

- Web Push (VAPID) from the hub, with a service worker, subscription lifecycle,
  and `410 Gone` cleanup.
- Web Push is the only outbound channel. There is no ntfy, Telegram, or
  webhook sender, and none is planned.
- Routing rules: blocking immediate, unread/error digest, quiet hours, and
  coalescing ("3 questions from 2 sessions").
- Installable PWA: offline shell, cached session list, queued sends, and a
  visible connection state.
- Deep links into the exact attention item from a notification.
- Settings → Notifications: enable, test, per-type routing, quiet hours, devices.
- An `oktoso notify test` CLI path for operators.

Acceptance:

- A blocking question reaches a phone with the app closed in under five seconds.
- Four events from one session produce one notification.
- Quiet hours suppress non-blocking notifications and queue a digest.
- Tapping a notification opens the exact item, not the inbox root.
- A revoked or expired subscription is removed and never retried forever.
- The app installs to a home screen and opens the last screen offline.

### Phase 4 — Supervisor (in progress)

Goal: the hub handles the safe cases and escalates the rest. This is the
continuous-control layer, reduced to something shippable: declarative watchers,
a risk policy, an approval queue, and a kill switch.

Deliverables:

- Watchers on the event bus: `question.arrived`, `session.error`,
  `session.idle`, and schedule.
- Actions: notify, auto-answer, escalate, retry, and start-from-template.
- Risk policy: allowlist of low-risk question shapes, destructive and sensitive
  escalation, quiet hours, and actions per hour and per day.
- Approval queue reusing the inbox grammar, with an audit trail per run.
- Dry-run mode on by default for every new watcher.
- Global and per-watcher pause.
- MCP tools for automations and approvals for northbound agents.

Acceptance:

- A watcher answers a safe yes/no question and escalates a destructive one.
- Two watchers never answer the same question twice.
- Dry-run records the intended action and sends nothing.
- The kill switch stops a watcher mid-flight.
- Every autonomous action is attributable to a watcher, a policy, and a run.

### Phase 5 — Recall and lineage (planned)

Goal: the sessions the hub has already seen become usable memory.

Deliverables:

- Write-through transcript cache. Providers stay canonical; the cache is
  invalidated by provider `updatedAt` and a TTL.
- Message search implementing the existing `scope: "messages"` contract, with
  snippets and filters.
- Session-family tree: forks, branches, subagent lineage, and "open in tree".
- Cost and token visibility computed from the session list. No new aggregation
  endpoint.
- Retention and export: Markdown/JSON per session, configurable TTL for drafts,
  read markers, and reply feedback.

Acceptance:

- Search finds a phrase from three weeks ago in under 200 ms.
- A fork tree shows ancestry and opens any node.
- Export round-trips a transcript without losing roles or timestamps.
- Deleting local state does not touch the provider.

### Phase 6 — Provider platform (planned)

Goal: make the multi-provider claim true and make adding a provider a solved
problem.

Deliverables:

- Hermes adapter: health, sessions, messages, runs, streaming, approvals,
  clarify questions, and the TUI gateway for existing sessions.
- Provider adapter SDK and a conformance suite covering the 17 capability flags.
- One community adapter as proof, chosen for the lowest integration cost.
- Capability and health badges in the Providers screen.
- `docs/provider-adapters.md` with a worked example.

Acceptance:

- The hub lists Hermes sessions, streams a reply, and answers an approval.
- A Hermes restart does not lose session references.
- A third-party adapter passes the conformance suite with no hub changes.

### Phase 7 — MCP southbound: providers and tools as patch points (planned)

Goal: Oktoso also acts as an MCP client, so provider tools pass through one
policy layer.

Deliverables:

- Connect to provider-exposed MCP servers and discover tools and capabilities.
- Route tool calls through the Phase 4 policy layer.
- Normalize timeouts, retries, idempotency, and error mapping.
- Surface provider tools to northbound agents without exposing raw credentials.
- Deny-by-default policy, per-tool allowlists, and audit.

Acceptance:

- An agent can call a provider tool through Oktoso.
- A denied tool never reaches the provider and appears in the audit log.

### Phase 8 — Hardening and observability (planned)

Goal: production confidence, not new surface area.

Deliverables:

- `/metrics` in Prometheus text format, structured logs with redaction, and
  automation run history.
- Backup and restore for `dataDir`.
- Docker image, Termux archive, and systemd unit.
- The real Termux/cross-host acceptance run and TLS/VPN validation.
- Load test for SSE fan-out and event bursts.
- Security review: token handling, pairing codes, CSRF, CORS, rate limits,
  redaction.
- A Rust-port decision record.

Acceptance:

- The hub survives provider restarts and client reconnects.
- No secret appears in logs.
- The bundle runs on a clean Node 24 install.
- Metrics expose provider health, event lag, notification delivery, and action
  counts.

### Phase 9 — Surfaces and bets (planned)

Goal: extend the surfaces only after the loop is closed.

- Cross-provider handoff: continue a conversation on another provider.
- Templates and recipes: saved agent/model/directory/prompt, one-tap start, and
  recurring schedules.
- G2 ambient mode: glanceable background count, haptic or voice alert on
  blocking attention, and an offline queue.
- Local reply drafting through Ollama behind the hub, feeding the existing
  feedback loop.
- VR client, only after G2 hardware acceptance.
- Multi-user and teams, only with demonstrated demand.

Acceptance is defined per bet when it is scheduled, not now.

## Architecture rule

Oktoso is a **control plane**, not an agent runtime and not a model host.

- It owns connections, permissions, sessions, events, and audit.
- Agents and models live outside it.
- Providers remain authoritative for their sessions and tools.
- Every autonomous action must be attributable, bounded, and reversible where
  possible.

## Explicit non-goals

- Running agent CLIs, ACP servers, or model weights inside the hub.
- Tunnels, DNS, TLS termination, or provider discovery.
- Replacing OpenCode, Open WebUI, or Hermes as a runtime.
- Multi-user identity before single-owner is excellent.
- A native mobile app before the PWA is solid.
- VR before G2 hardware acceptance.
- A background aggregation endpoint. Summaries are computed from data the
  client already fetches.

## Execution

[`roadmap-execution.md`](roadmap-execution.md) holds the ordered work breakdown,
dependencies, phase acceptance, release map, and the first sprint. Every phase
follows the same definition of done:

- Contracts first, with generated OpenAPI and a schema test.
- Hub behavior covered by unit tests; user flows covered by e2e with fake
  providers.
- Docs updated in the same change (`design.md`, `ui-ia.md`,
  `interaction-contract.md`, `visual-audit.md`, `deployment.md` as applicable).
- No regression in `pnpm test`, `pnpm test:e2e`, `pnpm brand:check`, or
  `pnpm openapi:check`.
- The change is releasable on its own.

## Name decision

Use **Oktoso** for the product and `@amoshydra/oktoso` for the package.
Keep **agent hub** as the explanatory subtitle in the README:

> Oktoso — the agent hub and control surface.
