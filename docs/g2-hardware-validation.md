# G2 Hardware Validation

This is the scripted acceptance run for the Even G2 client. The simulator and
the phone preview drive the same handlers, but hardware remains authoritative
for input feel, frame latency, reconnects, and long-session reading position.

Record one row per test in the results table. A failed row blocks release even
when the simulator passes.

## What this validates

- ring and temple input mapping;
- double-tap timing and accidental-back behavior;
- scroll cadence and acceleration;
- first-frame and input-to-frame latency;
- reconnect after backgrounding, network loss, and hub restart;
- long-session reading position and `New below`;
- pairing, token refresh, and expired credentials;
- single-question, free-form, stale, and multi-question answers;
- home, recent-session, and inbox question discovery;
- idle behavior: no page rebuilds and no repeated polling while SSE is live.

## Preflight

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm openapi:check
pnpm build:single-port
pnpm hardware:check
```

`hardware:check` verifies the G2 manifest version matches the root package, the
network whitelist is valid, and the built assets are present.

Start the local hub:

```sh
pnpm start:local
```

The app URL is:

```text
http://<hub-host>:8787/apps/even-g2/
```

For a packaged hardware build:

```sh
VITE_HUB_URL=https://hub.example.com \
  pnpm --filter @amoshydra/oktoso-even-g2 build
HUB_ORIGIN=https://hub.example.com pnpm pack:even-g2
```

Install the package through Even Hub, then open **Oktoso G2**.

If the webview has a different cookie jar, pair with the phone surface instead
of relying on the browser cookie. The G2 app accepts a pairing QR, a pairing
link, a raw pairing code, or a hub token.

## Pairing and onboarding

Create a code in the hub terminal with `p` and Enter.

| ID | Action | Expected |
|---|---|---|
| P1 | Open the G2 phone surface while disconnected. | Pairing panel is visible; glasses show `Pair in phone`. |
| P2 | Scan the terminal QR with **Scan QR**. | Camera opens, QR is recognized, the phone pairs without typing a token. |
| P3 | Paste the full pairing link and press **Pair this phone**. | Pairing succeeds; the session token is stored on the phone. |
| P4 | Paste only the pairing code and pair. | Same result as P3. |
| P5 | Reuse the same pairing code. | `That pairing link expired or was already used`; no session is stored. |
| P6 | Pair, close the app, and reopen it. | The stored session restores; the glasses go to Home. |
| P7 | Pair a browser through the hub `/pair/<code>` page, then open `/apps/even-g2/` in that browser. | Cookie restore connects without a token. |
| P8 | Enter an invalid token and press **Connect with token**. | `Connection failed`; the previous valid token is not overwritten. |
| P9 | Let a session token reach its refresh window, reopen the app, and open a chat. | The token refreshes silently; no re-pair is required. |

## Input and timing

Use a stopwatch or the phone **Glasses bridge** counters. The counters report
input handling time and the last page rebuild time.

| ID | Action | Expected |
|---|---|---|
| I1 | Ring tap on a list row. | The row opens; no double action. |
| I2 | Right temple tap on a list row. | Same as ring tap. |
| I3 | Double tap with a 250–600 ms gap. | Back exactly once. |
| I4 | Two slow taps more than 900 ms apart. | Two separate selects, not Back. |
| I5 | Double tap on an error screen. | Back still works. |
| I6 | Long-press the temple or ring. | No hidden action; the app does not depend on long-press. |
| I7 | Swipe slowly through a chat. | One line per swipe. |
| I8 | Swipe four times quickly. | Acceleration caps at four lines: `1, 1, 2, 2, 4`. |
| I9 | Tap a footer hint. | Nothing happens; the footer is not a capture target. |

Targets on hardware:

- input-to-frame: under 150 ms for a list selection;
- page rebuild: under 300 ms on the local hub;
- first frame after launch: under 500 ms with the hub reachable;
- scroll update: under 100 ms.

## Reconnect and backgrounding

| ID | Action | Expected |
|---|---|---|
| R1 | Background the app for 30 seconds, then resume. | SSE reconnects; the current screen is preserved. |
| R2 | Background for 10 minutes, then resume. | The session refreshes; no duplicate messages. |
| R3 | Disable Wi-Fi for 30 seconds while on Chat. | The app stays usable; polling resumes only while SSE is down. |
| R4 | Re-enable Wi-Fi. | The stream recovers and the chat updates. |
| R5 | Restart the hub while the app is open. | The app reconnects with the stored token or cookie; no crash. |
| R6 | Open Chat, scroll up, then receive a new message. | The reading position is preserved and the footer shows `New below`. |
| R7 | Scroll back to the bottom after R6. | The marker clears and the next message follows the bottom. |
| R8 | Leave the app idle for 60 seconds with SSE connected. | No page rebuilds, no repeated list refreshes, no log spam. |

## Long session reading position

Seed or open a session with at least 300 readable lines.

| ID | Action | Expected |
|---|---|---|
| L1 | Open the session. | The viewport starts at the latest readable message, not the oldest line. |
| L2 | Scroll to the top, close Chat, and reopen. | Chat reopens at the latest message; deliberate back-navigation is explicit. |
| L3 | Scroll to the middle and wait for a streaming update. | The reader keeps their line; no jump to the newest line. |
| L4 | Scroll to the bottom and receive a message. | The viewport follows the new message start. |
| L5 | Check the footer. | Line and message position are readable and do not clip at 576 px. |

## Question answers

| ID | Action | Expected |
|---|---|---|
| Q1 | Open a session whose latest message asks a yes/no question. | Footer shows `? Answer`; tap opens `ANSWER` with Yes/No. |
| Q2 | Tap a choice. | `SENT` shows the exact text; the hub accepts it once. |
| Q3 | Select a destructive choice. | `CONFIRM` appears with Send/Cancel; Cancel returns to the choices. |
| Q4 | Choose **Type answer**. | The phone keyboard focuses; sending updates the chat. |
| Q5 | Answer on the phone card instead of the glasses. | The same question is resolved; the glasses return to chat. |
| Q6 | Answer on the web, then tap the stale choice on the glasses. | `ANSWER · changed`; Review reloads or Read chat exits. |
| Q7 | Retry a failed send. | The same idempotency key is reused; no duplicate message appears. |
| Q8 | Answer a question with a provider-native form. | The glasses route to `Answer in Inbox`; the form is authoritative. |

## Multi-question batches

| ID | Action | Expected |
|---|---|---|
| B1 | Open a session whose latest message asks two questions. | Footer shows `? Answer`; the ANSWER header shows `ANSWER · 2 questions`; rows are `Answer on phone`, `More`, `Read chat`. |
| B2 | Tap **Answer on phone**. | The phone question card scrolls into view and shows every question. |
| B3 | Select choices and type free-form answers. | Each question keeps its own selection; typing clears only that question's choice. |
| B4 | Press **Send answers** before answering all questions. | The send is blocked and names the missing question. |
| B5 | Answer every question and send. | The hub receives one message with numbered answers; `SENT` reports two answers. |
| B6 | Check the provider transcript. | The message is `1. …` / `2. …`; answer metadata carries both question IDs and the shared revision. |
| B7 | Answer one question on the web while the batch card is open, then send. | `409` becomes `ANSWER · changed`; no partial batch is sent. |
| B8 | Use `More` from the batch screen. | `More replies`, `Read chat`, and `Stop` still work. |

## Question discovery

| ID | Action | Expected |
|---|---|---|
| D1 | Leave a session with a pending question, then open Home. | The `Current` row starts with `?`. |
| D2 | Open Recent with a pending question in one of the five sessions. | That row reads `QUESTION · <session>`. |
| D3 | Open Inbox with an unread session whose latest message asks a question. | The row reads `QUESTION` instead of `UNREAD`. |
| D4 | Open that attention item. | The summary shows the question text; the action reads `Answer in chat`. |
| D5 | Answer the question and return to Home/Inbox. | The marker clears without reopening the session. |
| D6 | Put the hub behind a slow or failing provider. | Discovery omissions do not clear existing markers; the app stays usable. |

## Attention and forms

| ID | Action | Expected |
|---|---|---|
| A1 | Approve and deny a permission request. | The inbox updates and the glasses return to the list. |
| A2 | Complete a boolean/select form on the glass. | Required-field validation works; submit is explicit. |
| A3 | Complete a text/textarea/number/multiselect form on the phone. | The phone form validates and submits; the item disappears. |
| A4 | Trigger a provider error session. | The inbox shows `ERROR`; dismiss works. |

## Connection failures

| ID | Action | Expected |
|---|---|---|
| F1 | Stop the hub while the app is open. | The existing screen remains readable; a failed action shows `HUB OFFLINE` with Retry/Back, and background refresh adds an inline retry row. |
| F2 | Start the hub again and tap Retry. | The app reconnects without a relaunch when credentials are still valid. |
| F3 | Revoke the owner token and restart the hub. | A request shows `SESSION EXPIRED` with `Pair this phone`; no crash loop. |
| F4 | Make a provider fail while opening Recent. | The loading state ends with an inline `Retry · Agent offline` row; Back returns Home. |
| F5 | Open Chat while a provider is slow. | `Opening session…` appears immediately; Back still works. A timeout shows `TIMEOUT` with Retry/Back. |
| F6 | Drop SSE while keeping HTTP available. | The home footer changes from `Live` to `Polling` or `Reconnecting`; the phone pill matches. |
| F7 | Trigger a 429 from the hub. | The failure reads `HUB BUSY` and offers Retry. |

## Results

Copy this table into the hardware run notes.

| ID | Result | Latency | Notes |
|---|---|---|---|
| P1–P9 |  |  |  |
| I1–I9 |  |  |  |
| R1–R8 |  |  |  |
| L1–L5 |  |  |  |
| Q1–Q8 |  |  |  |
| B1–B8 |  |  |  |
| D1–D6 |  |  |  |
| A1–A4 |  |  |  |
| F1–F5 |  |  |  |

Record the device, firmware, Even Hub version, hub version, and network path
(LAN, tunnel, or local) at the top of the notes. Attach the phone bridge
counters for any latency failure.

## Current limits

- The glass page has one event-capturing container. The list owns input and the
  footer is a hint.
- There is no long-press event in the SDK. Do not add a required long-press.
- Four rows are visible; longer lists scroll.
- Voice capture and STT are not implemented. The phone remains the keyboard for
  long or free-form answers.
- Hardware validation cannot run in CI. The preflight script checks the
  manifest and build artifacts, and `layout.test.ts` snapshots container
  geometry, footer position, and the one-capture rule. Real input, latency, and
  reconnect behavior still need the glasses.
