# Glass UX

The glasses are a glanceable **attention and reply surface**. The phone owns setup,
long forms, search, and session management.

## Screen map

```text
Home
├─ Inbox            attention items
├─ Recent           five most recent sessions
└─ Current          last opened session, when available

Inbox
└─ Attention        permission / form / error / unread detail

Chat
├─ Reply            canned, 4B, and numbered choices
└─ Phone keyboard   longer text fallback
```

Back always follows where you came from:

- chat → inbox, recent, or home
- reply / choices → chat
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
- Chat opens at the latest lines and follows new content while the reader is at
  the bottom.
- Scrolling up stops following and preserves the reading position through
  refreshes and streaming updates.
- Slow swipes move one line.
- Several rapid swipes accelerate within a 500 ms window: `1, 1, 2, 2, 4` lines.
- Newlines and paragraph breaks are preserved. Multiple spaces within a line are
  collapsed.
- The footer reports visible line and readable-message position:
  `L456-461/461 · M30/30`.
- The header reports `project · session title` so the glass shows which home the session belongs to.

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

## Planned order

1. Project/title context in the chat header.
3. Simple attention forms on glass; complex forms hand off to phone.
4. Compact agent activity state.
5. Voice capture and STT if the SDK exposes microphone input.
6. Frame snapshot tests and a scripted hardware checklist.
