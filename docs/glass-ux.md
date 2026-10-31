# Glass UX

The glasses are a glanceable **attention and reply surface**. The phone owns setup,
long forms, search, and session management.

## Screen map

The app is served by the hub at `/apps/even-g2/`; the hub API is same-origin at `/api`. A paired browser skips setup; otherwise pair the phone browser with the hub terminal QR or enter the owner or session token.

```text
Home
├─ Inbox            attention items
├─ Recent           five most recent sessions
└─ Current          last opened session, when available

Inbox
└─ Attention        permission / form / error / unread detail

Chat
├─ Answer           pending question: choices + Type answer / More / Read chat
├─ More             More replies / Read chat / Stop
├─ Type             phone keyboard handoff
├─ Reply            canned, 4B, and numbered choices
└─ Phone keyboard   longer text fallback
```

Back always follows where you came from:

- chat → inbox, recent, or home
- answer → chat
- answer more / type / confirm → answer
- sent → chat
- reply / choices → chat or More, depending on where reply was opened
- attention → inbox
- inbox / recent → home

## Interaction grammar

| Input | Action |
|---|---|
| Tap / R1 tap | open, select, or reply |
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
- The footer reports visible line and readable-message position, plus compact
  agent activity when present:
  `L456-461/461 · M30/30 · Working · 3 steps`.
- The header reports `project · session title` so the glass shows which home the session belongs to.

## Question reply

When the latest completed assistant message ends in a question, the chat footer
adds `? Answer`. Tapping the chat opens `ANSWER` instead of the generic reply
menu.

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
- Retries reuse the same idempotency key. A changed answer draft gets a new key.
- The hub derives the question from the transcript at
  `GET /api/v1/sessions/:ref/question`. No provider-side question API is needed.
- Multiple questions are deferred; the parser returns no prompt until the phone
  batch flow exists. Provider-native question forms still use the attention
  inbox.

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

The glass shows the first five attention rows. The home screen shows the total
count. Older unread sessions are intentionally not pushed onto the glasses.

## Text policy

- No Markdown rendering on the glass. Strip formatting that cannot render and keep
  paragraph breaks.
- Keep tool/reasoning noise out of chat; show a compact activity summary instead.
- Truncate titles and action labels rather than wrapping controls.
- Use one blank line between paragraphs, not between every message.

## Reliability

- SSE is the primary update path; polling remains a fallback.
- Reconnect and resync must preserve the reader's line unless new content is being
  followed intentionally.
- Auth, offline, provider failure, and timeout need distinct short messages.
- Back must always work, including on error screens.

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

Frame signatures and scroll acceleration now have unit coverage. Hardware input and
rendering still require the scripted hardware checklist.

## Planned order

1. Question reply: multiple-question batches and broader parser coverage.
2. Voice capture and STT if the SDK exposes microphone input.
3. Frame snapshot tests against recorded hardware frames.
4. Scripted hardware checklist for input cadence, reconnect, and latency.
