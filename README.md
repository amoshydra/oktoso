# Agent Hub

A hub-first session hub for AI agents. One place to see what needs attention, browse sessions, start chats, and reply across OpenCode, Open WebUI, Hermes, and other providers.

The hub is a small Node/TypeScript HTTP service. Clients are thin and replaceable: web, mobile, desktop, Even G2 glasses, and VR.

## Status

Implementation phase. OpenCode and Open WebUI are live, the web hub has search, drafts, attention, the newest-first transcript, and incremental message streaming, and the Even G2 client has its first inbox/chat/reply slice. Desktop notifications, real Hermes, and voice STT remain pending. The approved UI reference is frozen as `design-v1.1`.

## Documents

- [`docs/design.md`](docs/design.md) - architecture, domain model, provider adapters, API, security, deployment
- [`docs/plan.md`](docs/plan.md) - phased delivery plan and acceptance criteria
- [`docs/code-structure.md`](docs/code-structure.md) - implementation systems, repository layout, API additions, and task sequencing
- [`docs/ui-ia.md`](docs/ui-ia.md) - information architecture, screens, flows, responsive and glasses/VR adaptations
- [`docs/visual-audit.md`](docs/visual-audit.md) - contrast audit, visual tokens, and component rules
- [`docs/design-lock.md`](docs/design-lock.md) - frozen `design-v1.1` reference and change policy
- [`AGENTS.md`](AGENTS.md) - UI/design contract and repository instructions for agents
- [`docs/openapi.yaml`](docs/openapi.yaml) - generated API contract
- [`docs/wearables.md`](docs/wearables.md) - Even G2 setup, packaging, and device limits
- [`docs/glass-ux.md`](docs/glass-ux.md) - glass screen map, interaction grammar, and validation plan
- [`SECURITY.md`](SECURITY.md) - credential handling and vulnerability reporting
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
- Wearables: `apps/even-realities-g2` (Agent Hub G2), shared wearable core, phone pairing/keyboard, and hub-side reply assistance settings

`pnpm dev` starts the hub, Vite, fake Open WebUI/Hermes servers, and a fake OpenCode server. Real provider credentials belong in the ignored `.env.local` file:

```bash
OPENCODE_BASE_URL=http://127.0.0.1:4096
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=...
OPENWEBUI_BASE_URL=https://openwebui.example
OPENWEBUI_API_KEY=...
```

When those variables are present, the matching providers use the real instances instead of the fake ones. Omitting a provider's base URL leaves that provider on its local fake endpoint. The dev command does not start the frozen prototype.

`.env.local` and `.data/` are ignored. Keep `.env.local` at mode `0600`. The committed `dev-token-agent-hub` is a local-only token; generate a long random `HUB_TOKEN` for any reachable deployment.

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

## Even G2 URL hosting

The hub can serve the glass app under a generic app prefix, alongside the web UI and API:

```text
http://localhost:8787/          web UI
http://localhost:8787/api       hub API
http://localhost:8787/apps/even-g2/
```

Build the hub, web UI, and hosted G2 app in one pass:

```sh
pnpm build:single-port
pnpm start:local
```

`start:local` loads `.env.local`, uses the dev provider config, binds `0.0.0.0:8787`, and starts the built hub. For a real production config, use `HUB_CONFIG=./hub.config.json node dist/hub.js` instead.

Load the glass app from `.../apps/even-g2/` and enter only the token. The app uses the same origin for `/api`, so no CORS or separate Vite server is needed.

The optional `.ehpk` flow still exists:

```sh
VITE_HUB_URL=https://hub.example.com pnpm --filter @agent-hub/even-realities-g2 build
HUB_ORIGIN=https://hub.example.com pnpm pack:even-g2
```

## Stack

- Node.js 24+
- TypeScript
- Hono on Node.js 24+
- React + Vite for the reference web client
- Pure JavaScript dependencies, no native modules
- JSON state store first; optional `node:sqlite` adapter later
- A bundled `dist/hub.js` for portable deployment

## Security

Provider credentials, hub tokens, and runtime state stay out of Git. See [`SECURITY.md`](SECURITY.md) for reporting and deployment guidance.

## License

MIT. See [`LICENSE`](LICENSE).

## Next

Milestone 1 continues with the OpenCode V2 adapter, the real session/chat slice, and attention. The implementation shape is in `docs/code-structure.md`.
