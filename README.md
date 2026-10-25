# Agent Hub

A hub-first session hub for AI agents. One place to see what needs attention, browse sessions, start chats, and reply across OpenCode, Open WebUI, Hermes, and other providers.

The hub is a small Node/TypeScript HTTP service. Clients are thin and replaceable: web, mobile, desktop, Even G2 glasses, and VR.

## Status

Design phase. The architecture, delivery plan, and UI/IA design are in `docs/`.

## Documents

- [`docs/design.md`](docs/design.md) - architecture, domain model, provider adapters, API, security, deployment
- [`docs/plan.md`](docs/plan.md) - phased delivery plan and acceptance criteria
- [`docs/ui-ia.md`](docs/ui-ia.md) - information architecture, screens, flows, responsive and glasses/VR adaptations
- [`docs/visual-audit.md`](docs/visual-audit.md) - contrast audit, visual tokens, and component rules
- [`docs/openapi.yaml`](docs/openapi.yaml) - draft API contract
- [`docs/prototypes/index.html`](docs/prototypes/index.html) - interactive UI prototype with mock data

## Principles

- The hub owns provider credentials, session indexing, normalization, attention, and event fan-out.
- Clients consume one HTTP/SSE API. No client owns business logic.
- Provider APIs are the source of truth. The hub caches and indexes.
- No ACP requirement and no local agent processes on the hub.
- No networking assumptions. WireGuard, Tailscale, LAN, and TLS are operator concerns.
- One codebase runs on Termux, Linux, macOS, a Raspberry Pi, or a VPS.

## Prototype

```sh
python3 -m http.server 4173 --directory docs/prototypes
```

Open `http://127.0.0.1:4173`. Resize the window to see the mobile layout.

## Stack

- Node.js 22+
- TypeScript
- Hono or `node:http`
- Pure JavaScript dependencies, no native modules
- JSON or SQLite persistence
- A bundled `dist/hub.js` for portable deployment

## Next

Milestone 1 starts with the hub core, the OpenCode V2 adapter, and the web client. See `docs/plan.md`.
