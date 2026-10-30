# Wearables

The hub API is the shared surface for all wearable clients. Device apps are thin display/input adapters; they never talk to providers directly and never hold provider credentials.

## Even G2

- App: `apps/even-realities-g2`
- Hosted path: `/apps/even-g2/`
- Package: `@agent-hub/even-realities-g2`
- Display name: **Agent Hub G2** (manifest limit is 20 characters; the phone surface says “Agent Hub for Even G2”)
- Target: Even Hub plugin for Even G2
- Shared logic: `packages/wearable-core`

The first slice is deliberately narrow:

- phone pairing for the bearer token; the hub is the app origin
- home with inbox count, recent sessions, and the current session
- inbox with up to five attention items
- permission / unread / failure detail and actions
- attention forms render on the phone surface with an explicit `Answer on phone` action on the glass
- chat view of the latest transcript context with a full-response line viewport
- reply menu with canned and 4B-assisted suggestions
- numbered-choice extraction for agent replies
- full chat responses kept in memory and read through a six-line viewport; newlines and paragraph breaks are preserved, the footer shows both line and readable-message position, chat opens at the latest lines and follows new content, slow swipes move one line, several rapid swipes accelerate gradually, and refresh never rebuilds the page or resets the reading position
- Markdown formatting is stripped for glass display; fenced code keeps its content and paragraph breaks are preserved
- hub message snapshots update chat immediately, with a four-second polling fallback
- stable message retention prevents line shifts when the rolling provider page changes
- overlapping chat fetches are sequenced, and chat rendering is serialized
- phone keyboard fallback
- opening a session stores a hub read marker so web and glass agree on unread state
- offline/retry polling
- unchanged attention lists are not rebuilt, so the G2 selection index is preserved across polls
- a glass-content signature skips page rebuilds and text upgrades when the visible header, body, footer, and list are unchanged

Voice capture, inline forms, and full session management are follow-ups. The screen and interaction contract is in [`glass-ux.md`](glass-ux.md).

## Run locally

```sh
pnpm dev            # hub + web at 5175
pnpm dev:even-g2    # Even G2 web app at 5176
```

The G2 app uses the Vite `/api` proxy to `127.0.0.1:8787` in development. The phone must be able to reach the laptop's LAN address. The setup screen asks only for the token because the hub is the origin that served the app.

```sh
pnpm simulate:even-g2
```

The native EvenHub simulator requires a desktop GTK session. In headless environments, use the phone-side **Glasses preview** controls, which drive the same input handlers (`Up`, `Down`, `Select`, `Back`) against the current screen logic. Hardware/simulator input remains the final validation.

For hardware testing without packaging, load the built app from the hub:

```sh
pnpm build:single-port
pnpm start:local
```

`start:local` uses `.env.local` and the dev provider config. For production, use `HUB_CONFIG=./hub.config.json node dist/hub.js`.

The URL is:

```text
http://<hub-host>:8787/apps/even-g2/
```

Enter only the token. The app and API share an origin.

The hub serves `/apps/<app-id>/` generically, so future glass or watch apps can use `/apps/watch/`, `/apps/vision/`, and so on. Each app is built with its own Vite base and stored under `dist/apps/<app-id>/`.

For the optional packaged build, provide the hub at build time and whitelist its origin. The committed `app.json` only contains local and placeholder origins:

```sh
VITE_HUB_URL=https://hub.example.com pnpm --filter @agent-hub/even-realities-g2 build
HUB_ORIGIN=https://hub.example.com pnpm pack:even-g2
```

`HUB_ORIGIN` must include the scheme and any non-default port. The pack script writes the generated whitelist to an ignored `.app.pack.json`, packs `dist`, and removes the temporary manifest.

Packaged Even Hub builds may run under a different webview origin than the dev server. For trusted local hardware testing, start the hub with `HUB_CORS=*`; do not use wildcard CORS on a reachable deployment.

## Hub settings

The web Settings screen configures assistant behavior for wearable clients:

- **Reply assistance** — OpenAI-compatible endpoint, model, optional key, timeout, model thinking toggle
- **Voice transcription** — OpenAI-compatible STT endpoint, model, optional key, timeout

The repository defaults are examples; set your own endpoint and model in Settings:

- Reply endpoint: `http://127.0.0.1:8080/v1`
- Reply model: configure the model served by that endpoint
- Thinking disabled through `chat_template_kwargs.enable_thinking = false`
- Voice transcription disabled until an STT endpoint is configured

Settings are hub-owned. API keys are write-only from the browser and are not returned by the settings API or included in the glasses package.

## Interaction model

| Input | Action |
|---|---|
| Tap / R1 tap | primary action |
| Left temple tap | back/secondary |
| Double tap | back |
| Swipe | move/scroll/page |
| R1 double tap | back/deny where applicable |

The current Even Hub SDK exposes click, double-click, scroll, foreground/background, and IMU events. It does not expose a hold/long-press event, so contextual menus use normal actions or the phone surface.

The display is 576×288 monochrome and container-based. The app uses text/list containers with partial text upgrades where possible; it does not draw arbitrary pixels.

## Future devices

`packages/wearable-core` contains device-neutral formatting, choice paging, and numbered-choice parsing. New clients should add a device app (for example `apps/<device>`) with its own bridge/input adapter and reuse the core plus the hub API. Smartwatches do not inherit Even Hub assumptions.
