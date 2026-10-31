# Oktoso

Oktoso is a hub-first session hub for AI agents. One place to see what needs attention, browse sessions, start chats, and reply across OpenCode, Open WebUI, Hermes, and other providers.

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
- Development token: `dev-token-oktoso` (prefilled in the dev login; run `pnpm pair:dev` to use a link instead)
- OpenCode read/write: session index, transcript, composer, new sessions, and interrupt
- Open WebUI: chats, current branches, models, new chats, and prompt sends
- Providers: OpenCode and Open WebUI adapters; Hermes remains a health-only fake
- Attention: permissions, forms, unread sessions, failures, provider-backed actions, and live navigation badges
- Wearables: `apps/even-realities-g2` (Oktoso G2), shared wearable core, phone pairing/keyboard, and hub-side reply assistance settings

`pnpm dev` starts the hub, Vite, fake Open WebUI/Hermes servers, and a fake OpenCode server. Real provider credentials belong in the ignored `.env.local` file:

```bash
OPENCODE_BASE_URL=http://127.0.0.1:4096
OPENCODE_USERNAME=opencode
OPENCODE_PASSWORD=...
OPENWEBUI_BASE_URL=https://openwebui.example
OPENWEBUI_API_KEY=...
```

When those variables are present, the matching providers use the real instances instead of the fake ones. Omitting a provider's base URL leaves that provider on its local fake endpoint. The dev command does not start the frozen prototype.

`.env.local` and `.data/` are ignored. Keep `.env.local` at mode `0600`. The committed `dev-token-oktoso` is a local-only owner token; generate a long random `HUB_TOKEN` for any reachable deployment. Rotating it revokes every paired session.

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
```

Starting without a config bootstraps an empty local workspace:

```sh
pnpm start
```

It creates `hub.config.json` with no providers, generates a persistent owner token, prints it once, and starts the hub. On that first start it also prints a one-time pairing link once the server is listening. Add providers to the config and restart. An explicitly requested `--config` or `HUB_CONFIG` path is never created implicitly.

`pnpm start` runs the built `dist/hub.js`. The same entry point is exposed as the `oktoso` bin for an npx install: `npx @amoshydra/oktoso` starts the hub, and `npx @amoshydra/oktoso pair` connects to a running hub.

## Pairing a browser or wearable

Pairing avoids copying the owner token into every client.

On the first start that creates a config, the TUI opens a setup panel with the owner token shown once. Press `p` to open the pairing QR. Plain and non-TTY modes print a first-run pairing link instead. Later starts print a one-line reminder rather than a link. The link opens a confirmation page; it does not pair until you press **Pair this device**.

In a foreground terminal, type `p` and press Enter at any time to print a fresh link. The server keeps running. This is the normal path when the hub was started with `npx` or `pnpm start`.

For a background process or a second terminal, run:

```sh
pnpm pair
```

With the packaged CLI, that is `npx @amoshydra/oktoso pair`. It prints one-time links for loopback and LAN addresses. The links expire in five minutes and work once. The owner token is never shared. For the built server:

```sh
node dist/hub.js --pair
```

When the terminal is a TTY and there is a LAN address, the command also prints a **Scan to pair** QR code. Scan it with the phone camera to open the confirmation page. On supported secure-context browsers, the login screen also offers **Scan pairing QR** using the browser Barcode Detection API. On plain-HTTP LAN origins or browsers without that API, use the phone camera app instead.

Use `--url https://hub.example.com` when the hub is behind a proxy. The CLI authenticates with the owner token from the config and must run on a host that can reach the hub. If the hub is bound to a loopback address, bind `0.0.0.0` or pass `--url` to pair another device. If you start the hub with `HUB_HOST` or `HUB_PORT` overrides, pass the same variables to the `pair` command so the printed links match. For the dev configuration, use `pnpm pair:dev`.

Paired browsers use the 30-day HttpOnly session cookie and do not store the token in JavaScript. The session refreshes automatically while the browser is active; an idle browser re-pairs after expiry. API clients can call `POST /api/v1/auth/refresh` with their session token. Packaged apps loaded from another origin can still paste the owner or session token. Rotate `HUB_TOKEN` to revoke every paired session.

Opening a pairing page does not consume the code, so chat link previews are safe. Pressing **Pair this device** consumes it. After five minutes, the page shows an expired message telling you to press `p` in the hub terminal; if that browser is already paired, it goes straight to the app.

## Terminal UI

In a foreground TTY, the hub renders a full-screen dashboard:

```text
╭─ Oktoso ──────────────────────────────── v0.1.0 ─╮
│ http://127.0.0.1:8787        up 12m 04s   json       │
├──────────────────────────────────────────────────────┤
│ Providers 2/3   Sessions 12   Attention 3    1 SSE   │
│ Event 1042      Requests 142  Errors 0                │
├──────────────────────────────────────────────────────┤
│ Activity                                             │
│ 18:52:01  desktop-opencode  online                   │
│ 18:52:04  attention         permission · Fix auth    │
├──────────────────────────────────────────────────────┤
│ p pair · l logs · r refresh · o open · ^C quit · ? help│
╰──────────────────────────────────────────────────────╯
```

Keys:

- `p` — pair a device; opens the QR/link modal
- `l` — toggle activity and logs; `j`/`k` scroll
- `r` — re-check providers and refresh caches
- `o` — open the web UI, or the pairing link while the modal is open
- `c` — copy the pairing link or the first-run owner token
- `?` — key help
- `Ctrl+C` — quit

On first run the hub opens a setup panel with the owner token shown once. Press `p` to pair. The pairing modal keeps the QR and primary LAN link while the countdown updates.

### Running the command again

If Oktoso is already listening on the configured host and port, a second `npx @amoshydra/oktoso` does not crash with `EADDRINUSE`. It prints a status card and exits:

```text
Oktoso 0.1.0 is already running at http://127.0.0.1:8787
  pid 1234 · up 12m 04s · event seq 1042

  Web UI   http://127.0.0.1:8787
  Pair     npx @amoshydra/oktoso pair
  Status   npx @amoshydra/oktoso status
  Stop     Ctrl+C in the original terminal, or kill 1234
```

Useful forms:

```sh
npx @amoshydra/oktoso status          # is it running, and where?
npx @amoshydra/oktoso pair            # pair a device against the running hub
npx @amoshydra/oktoso --port 8788     # after stopping the current hub
npx @amoshydra/oktoso --host 0.0.0.0  # override the bind host on next start
```

A second instance needs its own state and log directories; stop the current hub first, or run it with separate directories:

```sh
HUB_DATA_DIR=.data-8788 HUB_LOG_DIR=.logs-8788 npx @amoshydra/oktoso --port 8788
```

If the port is occupied by a different process, the command says so and suggests another port. No stack trace.

Structured logs do not appear in the dashboard. In TUI mode they go to the platform log directory:

```text
Linux/Termux  $XDG_STATE_HOME/oktoso/logs/hub.log
macOS         ~/Library/Logs/Oktoso/hub.log
Windows       %LOCALAPPDATA%\Oktoso\Logs\hub.log
```

Only two files are kept: `hub.log` for the current run and `hub.log.prev` for the previous run. A run rotates at 25 MiB, replacing the previous file if a single run is that long. `--log-file`, `--log-dir`, `--no-log-file`, and `HUB_LOG_MAX_BYTES` override the defaults.

Use `--plain` for a scrollback-friendly session; human output stays on stdout and JSON logs go to stderr. Use `--log-json` for services and process managers. A non-TTY process never starts the TUI; pair it with `npx @amoshydra/oktoso pair` from any terminal. `--help` lists all flags.

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

Open a pairing link, or enter a token if the app is loaded from another origin. The app uses the same origin for `/api`, so a paired browser uses the HttpOnly session cookie and needs no CORS or separate Vite server.

The optional `.ehpk` flow still exists:

```sh
VITE_HUB_URL=https://hub.example.com pnpm --filter @amoshydra/oktoso-even-g2 build
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

Provider credentials, owner tokens, pairing links, and runtime state stay out of Git. See [`SECURITY.md`](SECURITY.md) for reporting and deployment guidance.

## License

MIT. See [`LICENSE`](LICENSE).

## Next

Milestone 1 continues with the OpenCode V2 adapter, the real session/chat slice, and attention. The implementation shape is in `docs/code-structure.md`.
