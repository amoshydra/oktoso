# Oktoso — naming and roadmap

Status: name and package rename applied. Publishing setup is the remaining Phase 1 work.

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

## Roadmap

### Phase 0 — Foundation (done)

- Provider registry and capability model.
- Stateless owner/session auth, pairing, refresh.
- Session index, transcript, prompt send, create, interrupt.
- Event bus, attention, drafts, settings.
- Web client, terminal dashboard, Even G2 question/reply flow.
- Question detection, stale revisions, idempotent answer retry.

### Phase 1 — Publishable Oktoso

- [x] Rename package to `@amoshydra/oktoso`; binary `oktoso`.
- [x] Rename workspace packages to `@amoshydra/oktoso-*`.
- [x] Add `publishConfig`, `files`, and `prepublishOnly`.
- [x] Add the tag-driven GitHub Actions workflow with npm OIDC publishing and provenance.
- [x] Verify `npx` from a clean temporary directory after publishing.
- [x] Rename the GitHub repository to `oktoso`.
- Keep **agent hub** as the descriptive subtitle, not the package name.

Acceptance:

```sh
npx @amoshydra/oktoso
npx @amoshydra/oktoso status
npx @amoshydra/oktoso pair
```

Starts without native modules, prints the dashboard, and serves the web/G2 apps
from the package.

### Phase 2 — MCP northbound: agents control Oktoso

Expose Oktoso as an MCP server so external LLM agents can use it.

Tools/resources:

- `providers.list`, `providers.check`
- `sessions.list`, `sessions.get`, `sessions.messages`
- `sessions.send`, `sessions.create`, `sessions.interrupt`
- `attention.list`, `attention.act`
- `questions.get`
- `events.follow` or an MCP resource/subscription for session and attention events

Security:

- Scoped MCP tokens, not the owner token.
- Per-tool and per-provider allowlists.
- Human approval for destructive actions.
- Audit every tool call with request ID, agent identity, and result.
- Rate limits and timeouts.

Acceptance:

An external agent connects over MCP, lists sessions, reads a transcript, answers
a pending question, and observes an attention event. Destructive actions are
blocked or require approval.

### Phase 3 — MCP southbound: providers and tools as patch points

Oktoso also acts as an MCP client:

- Connect to provider-exposed MCP servers.
- Discover tools and capabilities.
- Route tool calls through one policy layer.
- Normalize timeouts, retries, idempotency, and error mapping.
- Surface provider tools to northbound agents without exposing raw credentials.

Acceptance:

An agent can call a provider tool through Oktoso. A denied tool never reaches
the provider and appears in the audit log.

### Phase 4 — Continuous control

This is the “LLM agent continuously controls providers” layer.

- Watchers and triggers:
  - new attention item
  - pending question
  - error session
  - schedule/cron
  - session idle/running transitions
- Policies:
  - auto-answer only low-risk questions
  - escalate destructive or sensitive actions
  - quiet hours
  - max actions per session/hour
  - budget and iteration limits
- Multi-agent coordination:
  - leases so two agents do not answer the same question
  - queues and handoffs
  - explicit ownership
- Human-in-the-loop:
  - approve/deny from web, CLI, or G2
  - pause all automation with one control

Acceptance:

A watcher answers a safe question, escalates a destructive one, and never sends
duplicate actions when two agents are connected.

### Phase 5 — Surfaces and ecosystem

- Web control plane: MCP connections, policies, audit, automation status.
- G2: voice answers, suggested answers, question discovery in the inbox.
- Provider adapter SDK and MCP tool packs.
- Templates for common control loops.
- Hardware validation and packaging.

## Architecture rule

Oktoso is a **control plane**, not an agent runtime and not a model host.

- It owns connections, permissions, sessions, events, and audit.
- Agents and models live outside it.
- Providers remain authoritative for their sessions and tools.
- Every autonomous action must be attributable, bounded, and reversible where
  possible.

## Name decision

Use **Oktoso** for the product and `@amoshydra/oktoso` for the package.
Keep **agent hub** as the explanatory subtitle in the README:

> Oktoso — the agent hub and control surface.
