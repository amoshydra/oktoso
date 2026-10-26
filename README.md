# Agent Hub

A hub-first session hub for AI agents. One place to see what needs attention, browse sessions, start chats, and reply across OpenCode, Open WebUI, Hermes, and other providers.

The hub is a small Node/TypeScript HTTP service. Clients are thin and replaceable: web, mobile, desktop, Even G2 glasses, and VR.

## Status

Implementation phase. OpenCode read/write and attention are live, and Open WebUI now uses a real provider adapter. Session index, transcript, composer, new-session creation, provider permissions/forms, attention inbox, live badges, and background reconciliation are in place. Desktop notifications remain pending. The approved UI reference is frozen as `design-v1`.

## Documents

- [`docs/design.md`](docs/design.md) - architecture, domain model, provider adapters, API, security, deployment
- [`docs/plan.md`](docs/plan.md) - phased delivery plan and acceptance criteria
- [`docs/code-structure.md`](docs/code-structure.md) - implementation systems, repository layout, API additions, and task sequencing
- [`docs/ui-ia.md`](docs/ui-ia.md) - information architecture, screens, flows, responsive and glasses/VR adaptations
- [`docs/visual-audit.md`](docs/visual-audit.md) - contrast audit, visual tokens, and component rules
- [`docs/design-lock.md`](docs/design-lock.md) - frozen `design-v1` reference and change policy
- [`AGENTS.md`](AGENTS.md) - UI/design contract and repository instructions for agents
- [`docs/openapi.yaml`](docs/openapi.yaml) - generated API contract
- [`docs/prototypes/index.html`](docs/prototypes/index.html) - interactive UI prototype with mock data

## Principles

- The hub owns provider credentials, session indexing, normalization, attention, and event fan-out.
- Clients consume one HTTP/SSE API. No client owns business logic.
- Provider APIs are the source of truth. The hub caches and indexes.
- No ACP requirement and no local agent processes on the hub.
- No networking assumptions. WireGuard, Tailscale, LAN, and TLS are operator concerns.
- One codebase runs on Termux, Linux, macOS, a Raspberry Pi, or a VPS.

## Development

```sh
pnpm install
pnpm dev
```

- Web: `http://localhost:5175`
- Hub API: `http://127.0.0.1:8787`
- Development token: `dev-token-agent-hub` (prefilled in the dev login)
- OpenCode read/write: session index, transcript, composer, new sessions, and interrupt
- Open WebUI: chats, current branches, models, new chats, and prompt sends
- Providers: OpenCode and Open WebUI adapters; Hermes remains a health-only fake
- Attention: permissions, forms, unread sessions, failures, provider-backed actions, and live navigation badges

`pnpm dev` starts the hub, Vite, fake Open WebUI/Hermes servers, and a fake OpenCode server. Real provider credentials belong in the ignored `.env.local` file:

```bash
OPENCODE_BASE_URL=http://127.0.0.1:4096
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=...
OPENWEBUI_BASE_URL=https://openwebui.example
OPENWEBUI_API_KEY=...
```

When those variables are present, the matching providers use the real instances instead of the fake ones. Omitting a provider's base URL leaves that provider on its local fake endpoint. The dev command does not start the frozen prototype.

## Prototype

```sh
pnpm prototype
```

Open `http://127.0.0.1:4174` in a browser. Resize the window to see the mobile layout.

## Build

```sh
pnpm typecheck
pnpm test
pnpm openapi:check
pnpm build
HUB_TOKEN=... node dist/hub.js --config ./hub.config.json
```

## Stack

- Node.js 24+
- TypeScript
- Hono on Node.js 24+
- Preact + Vite for the reference web client
- Pure JavaScript dependencies, no native modules
- JSON state store first; optional `node:sqlite` adapter later
- A bundled `dist/hub.js` for portable deployment

## Next

Milestone 1 continues with the OpenCode V2 adapter, the real session/chat slice, and attention. The implementation shape is in `docs/code-structure.md`.
