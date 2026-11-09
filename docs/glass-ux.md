# Glass UX

The glasses are a glanceable **attention and reply surface**. The phone owns setup,
long forms, search, and session management.

## Screen map

The app is served by the hub at `/apps/even-g2/`; the hub API is same-origin at `/api`. A paired browser skips setup; otherwise pair the phone browser with the hub terminal QR or enter the owner or session token.

```text
Home
├─ Inbox            attention items
├─ Unsent           failed sends, when present
├─ Retry / Pair     inline failure, when present
├─ Recent           five most recent root sessions
├─ Current          last opened session, when available
├─ Symbols          glyph legend
└─ Settings         data refresh, reload, connection, version

Inbox
├─ Attention        permission / form / error / unread detail
└─ More             additional items beyond the glass cap

Attention
├─ Answer on glass  simple boolean / select forms
├─ Answer on phone  text or complex forms
├─ Provider action  approve / deny / mark read / retry / dismiss
└─ Open chat        read the transcript

Chat
├─ Answer           pending question: choices + Type answer / More / Read chat
├─ Batch            two or more questions: Answer on phone / More / Read chat
├─ Session          wait/done: Stop (running) / Phone keyboard
├─ More             More replies / Read chat / Stop
├─ Type             phone keyboard handoff
├─ Reply            answer / opposite (`Alt`) / ask, plus canned
└─ Phone keyboard   longer text fallback

Failure (any screen)
└─ Auth / offline / provider / timeout   Retry or Pair this phone, Back
```

The phone surface owns pairing, the multi-question batch form, and the
keyboard. It accepts a pairing QR, a pairing link, a raw pairing code, or a
token.

Back always follows where you came from:

- chat → inbox, recent, or home
- session → chat or More
- answer → chat
- answer more / type / confirm → answer
- sent → chat
- reply / choices → chat or More, depending on where reply was opened
- attention → inbox
- inbox / recent → home
- symbols → home
- settings → home
- reload confirmation → settings
- unsent → home
- failure → the screen that started the action

## Interaction grammar

| Input | Action |
|---|---|
| Tap / R1 tap | open, select, reply, or run a session action |
| Double tap | back |
| Scroll / swipe | move selection or chat line |

There is no long-press event. Do not hide required actions behind gestures the SDK
does not expose.

## Chat viewport

- Six visible lines.
- Chat opens at the start of the latest readable message.
- Streaming updates never chase the last line. The reader keeps their line.
- A new message jumps to its start only when the reader is already at the bottom.
  Otherwise the position is preserved and the footer shows `New below`.
- Scrolling to the bottom clears the unseen-message marker.
- Slow swipes move one line.
- Several rapid swipes accelerate within a 500 ms window: `1, 1, 2, 2, 4` lines.
- Newlines and paragraph breaks are preserved. Multiple spaces within a line are
  collapsed.
- The footer is one line. The 42 px footer container fits one line at G2 type
  size, so it prioritizes `? Answer` or `Tap actions`, then the line range,
  readable-message range, compact agent activity, non-live connection state,
  failure, `New below`, and the swipe/back hint. The hint is dropped whole when
  the line is full; it is never cut mid-word. The action affordance and position
  stay first.
- The header reports `project · session title` so the glass shows which home the session belongs to.
- Tapping the body opens `ANSWER` when a question is pending, `REPLY` when the
  reply gate says a decision is ready, and `SESSION` otherwise. `SESSION` is a
  short action list: `Stop` while running and `Phone keyboard`. It never calls
  the reply model.

## Question reply

When the latest completed assistant message ends in a question, or its latest
`question` tool call is still running, the chat footer adds `? Answer`. Tapping
the chat opens `ANSWER` instead of the reply menu. Provider-native questions use
the same answer screen as text questions; the Inbox form remains the formal
alternative for complex fields.

- One event-capturing list owns input. The footer is a hint, never a button.
  The G2 page builder accepts only one capture container, and a text tap has no
  container identity; do not reintroduce footer buttons or split capture zones.
- The list contains the agent's choices, then `Type answer`, `More`, and
  `Read chat`. Four rows are visible; the list scrolls to the rest.
- A choice sends in one tap. Destructive choices open `CONFIRM` with `Send` /
  `Cancel`.
- `Type answer` opens `TYPE` and focuses the phone keyboard. The phone question
  card shows the full question and choice buttons above the existing composer.
- `More` opens `More replies`, `Read chat`, and `Stop` (when interruptible).
- `SENT` shows the exact text sent; tap it or wait to return to chat.
- Every answer carries the question ID, message ID, and revision. The hub returns
  `409` if the question changed or was already answered. The glasses show
  `ANSWER · changed` with `Review` / `Read chat`; the old choice list is never
  sent silently. `Review` reloads the question.
- Every send carries an idempotency key, including answers, canned replies,
  numbered choices, and phone messages. Retries reuse the key; changed text
  gets a new key.
- A send shows `Sending…` immediately and times out after 30 seconds. A timeout
  or failure keeps the draft and key for Retry; it is never silently dropped.
- The hub derives the question from the transcript at
  `GET /api/v1/sessions/:ref/question`. No provider-side question API is needed.
- Multiple questions are returned together. The glass header reads
  `ANSWER · 2 questions`; the list is `Answer on phone`, `More`, `Read chat`.
  The phone card shows every question with its own choices and text field, then
  sends one numbered message. The hub validates all question IDs against the
  shared revision and rejects a partial batch with `question_incomplete`.
- Provider-native question forms still use the attention inbox.

## Read state

Unread is provider-owned, not derived from message counts:

- OpenCode: unread when `viewed` is missing or `viewed < idle`.
- Open WebUI: unread when `last_read_at < updated_at`.

The hub also stores a read marker per session (`readAt`, `updatedAt`). A provider
session is treated as read when its `updatedAt` is not newer than the marker. This
keeps web and glass consistent and covers providers without a reliable provider
mark-read API.

Opening a chat marks the session read. New provider activity after the marker makes
it unread again.

## Inbox policy

Attention contains:

1. provider permissions and forms;
2. error sessions;
3. unread sessions updated within 24 hours, newest first, capped at 10;
4. minus acknowledged items.

The glass shows **every blocking item** (permissions, questions, approvals,
errors) and fills the remaining initial slots with unread sessions. If more items
exist, the Inbox header reads `ATTENTION <shown>/<total>` and a `More · n` row
expands the list. The home screen shows the total count. Unread sessions are
still capped by the attention policy; blocking items are never hidden behind the
cap.

### Subagents

Sessions with `parentRef` are child sessions. They are implementation detail for
the parent task and do not create `UNREAD` or `ERROR` attention items by default.
The phone's Recent list requests `scope=root`, so it shows primary sessions only.

Provider-native permissions and questions from child sessions are still shown,
because they can block the parent task. They carry `parentRef`, and the glass
prefixes the row with `›`. This matters for OpenCode: child permission prompts
are not reliably propagated to the parent UI, and a dropped prompt can leave the
parent's turn busy indefinitely. The hub's global permission/form poll is the
fallback path for those child prompts. A plain-text question from a child is not
a blocking form; it returns to the parent as task output and is not surfaced as a
separate question marker.

## Question discovery

The home, recent, and inbox surfaces mark pending questions without creating a
new attention type:

- `GET /api/v1/questions?ref=…` returns compact summaries for up to ten recent
  sessions. The hub caches summaries briefly and reports provider failures
  separately, so an outage never looks like an answered question.
- The home current row reads `Current · ? <session>`.
- A recent-session row uses `?` for a pending question and `●` for unread.
- An unread inbox row becomes `? <session>`, its detail shows the question text,
  and its chat action reads `Answer in chat`.
- Opening the chat loads the full prompt and clears the marker when the question
  is gone. Answering from any client removes the marker on the next refresh.

## Glyphs

The G2 font was checked in the simulator. These single-cell glyphs render:

| Glyph | Meaning |
|---|---|
| `●` | unread |
| `?` | question |
| `■` | permission |
| `▲` | approval |
| `!` | error |
| `▶` | running |
| `▼` | offline |
| `◇` | idle |
| `◆` | generic attention |
| `›` | subagent / child session |

`⚿`, `✓`, `↳`, `✕`, `✖`, and `✔` do not render and must not be used. The row
prefix is `glyph + space` for a primary session and `› + glyph` for a child.

The legend is always discoverable:

- Home has a `Symbols` row. It opens a `SYMBOLS` list with every glyph and its
  meaning, including the `›?` and `›■` child examples.
- The phone surface has a collapsible **Symbol guide** below the glasses preview.
- The legend is read-only; swipe to see all rows and double-tap Back to leave.

## Settings

Home has a `Settings` row. The header is `SETTINGS`. The list contains only
actions:

- `Refresh data` — refetch attention, unread sessions, and pending-question
  summaries. The result appears in the footer as `Refreshed just now.` or
  `Refresh failed · <state>`.
- `Reload app` — opens `RELOAD APP` with `Reload` / `Cancel`. `Reload` reloads
  the entire webview with a cache-busting query so a newly deployed build is
  loaded without touching the phone. The current screen and chat position are
  lost.

The body shows `Connection · Live | Polling | Reconnecting | Offline | Pair`,
`v<app version>`, and the last data refresh time. The version also appears in the
Home header as `OKTOSO · v<app version>`. Settings does not change pairing;
pairing stays on the phone.

The phone pairing panel collapses to a compact `Connected · <hub>` row after a
successful connection. `Pair another` expands it again.

## Text policy

- No Markdown rendering on the glass. Strip formatting that cannot render and keep
  paragraph breaks.
- Keep tool/reasoning noise out of chat; show a compact activity summary instead.
- Truncate titles and action labels rather than wrapping controls.
- Use one blank line between paragraphs, not between every message.

## Reliability

- SSE is the primary update path. The four-second polling loop runs only while
  SSE is disconnected.
- The home footer reports `Live`, `Polling`, or `Reconnecting`, so the reader
  knows whether updates are pushed or polled. The phone connection pill reports
  the same state. Chat shows a non-live state in its first footer line.
- The last opened session is persisted locally and restored as the Home
  `Current` row after a reload.
- Loading screens advertise `Please wait · Back ×2`; Back still follows the
  normal origin chain.
- Reconnect and resync must preserve the reader's line unless new content is being
  followed intentionally.
- Auth, offline, provider failure, and timeout have distinct states:
  - `SESSION EXPIRED` → `Pair this phone`, `Back`
  - `HUB OFFLINE` → `Retry`, `Back`
  - `AGENT OFFLINE` → `Retry`, `Back`
  - `TIMEOUT` → `Retry`, `Back`
- A failed listen action uses the failure screen. A failed background refresh
  keeps the current list and appends a `Retry · <state>` row.
- Failed sends are kept locally and surface as an `UNSENT · n` row on Home.
  The `UNSENT` screen shows the target session and first lines of the oldest
  pending message. `Retry send` reuses the original idempotency key;
  `Discard` removes the entry. The queue survives a webview reload, is capped
  at ten entries, and expires after 30 days.
- Back must always work, including on failure screens.
- Recent sessions and chat open immediately show a loading panel; provider calls
  may take longer than the first frame. The list refresh is cached for 30 seconds
  on the hub, but a cold refresh waits for every provider.

## Testing

Browser preview controls drive `Up`, `Down`, `Select`, and `Back` through the same
handlers as hardware. Hardware validation remains authoritative for:

- scroll cadence and acceleration feel;
- tap/double-tap reliability;
- screen refresh latency;
- reconnect after backgrounding;
- long-session reading position;
- no-op frames while idle.

## Attention forms

Simple forms with only boolean and select fields can be completed on the glass.
Tap a field to change it; select fields open a short option list. The glass validates
required fields and submits explicitly.

Forms with text, textarea, number, or multiselect fields use the phone surface. The
glass offers `Answer on phone`. The phone form supports every field type, validates
required fields, and submits through the existing
`actOnAttention(..., "answer", { fields })` path. Forms are never submitted
automatically. Successful submission removes the attention item and refreshes the
inbox.

Frame signatures, scroll acceleration, and container-level layout snapshots now
have unit coverage. The layout tests pin the 576×288 bounds, footer position, list
item mapping, and the single event-capturing container. Hardware input, latency,
reconnect behavior, and long-session reading position still use the scripted
checklist in [`g2-hardware-validation.md`](g2-hardware-validation.md). Run
`pnpm build:single-port && pnpm hardware:check` before the hardware session.

## Planned order

1. Voice capture and STT if the SDK exposes microphone input.
2. Hardware acceptance for model-assisted reply suggestions and choices
   (implemented; the reply menu and `Find choices` are wired).
3. Frame snapshot tests against recorded hardware frames.
4. Hardware acceptance using the scripted checklist.
