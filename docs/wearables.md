# Wearables

The hub API is the shared surface for all wearable clients. Device apps are thin display/input adapters; they never talk to providers directly and never hold provider credentials.

## Even G2

- App: `apps/even-realities-g2`
- Package: `@agent-hub/even-realities-g2`
- Display name: **Agent Hub G2** (manifest limit is 20 characters; the phone surface says “Agent Hub for Even G2”)
- Target: Even Hub plugin for Even G2
- Shared logic: `packages/wearable-core`

The first slice is deliberately narrow:

- phone pairing for hub URL and bearer token
- inbox with up to five attention items
- permission / unread / failure detail and actions
- chat view of the latest transcript context with a full-response line viewport
- reply menu with canned and 4B-assisted suggestions
- numbered-choice extraction for agent replies
- full chat responses kept in memory and read through a six-line viewport; swipe moves one line and refresh never rebuilds the page or resets the reading position
- hub SSE updates chat immediately, with a four-second polling fallback
- stable message retention prevents line shifts when the rolling provider page changes
- overlapping chat fetches are sequenced, and chat rendering is serialized
- phone keyboard fallback
- offline/retry polling
- unchanged attention lists are not rebuilt, so the G2 selection index is preserved across polls

Voice capture, inline forms, session browsing, and long-running stream updates are follow-ups.

## Run locally

```sh
pnpm dev            # hub + web at 5175
pnpm dev:even-g2    # Even G2 web app at 5176
```

The G2 app uses the Vite `/api` proxy to `127.0.0.1:8787` in development. The phone must be able to reach the laptop's LAN address. The phone setup screen can also take an absolute hub URL for a packaged/private build.

```sh
pnpm simulate:even-g2
```

The native EvenHub simulator requires a desktop GTK session. In headless environments, use the phone-side **Glasses preview** controls, which drive the same input handlers (`Up`, `Down`, `Select`, `Back`) against the current screen logic. Hardware/simulator input remains the final validation.

For hardware sideloading, use the Even Hub scanner/QR flow and set the phone connection values. For a private packaged build:

```sh
pnpm --filter @agent-hub/even-realities-g2 build
pnpm --filter @agent-hub/even-realities-g2 pack
```

## Hub settings

The web Settings screen configures assistant behavior for wearable clients:

- **Reply assistance** — OpenAI-compatible endpoint, model, optional key, timeout, model thinking toggle
- **Voice transcription** — OpenAI-compatible STT endpoint, model, optional key, timeout

The current development defaults are:

- Reply endpoint: `http://127.0.0.1:8080/v1`
- Reply model: `gemma-3-4b-it`
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
