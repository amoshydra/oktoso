# G2 Glass UX Audit

**Date:** 2026-11-09
**Implemented:** 2026-11-10
**Scope:** the Even G2 glass flow and the phone fallback that supports it.
**Sources:** `apps/even-realities-g2/src/main.ts`, `layout.ts`, `labels.ts`,
`answer-model.ts`, `chat-model.ts`, `input.ts`, `failure.ts`, `pending-send.ts`,
`voice.ts`, `index.html`, `docs/glass-ux.md`, `docs/g2-question-flow.md`, and the
G2 README.
**Status:** implemented. Findings 1–18 are addressed; see
[Implementation status](#8-implementation-status). The Even Hub simulator passed
the new flows; real-hardware validation is still pending.

## 1. Screen inventory

The glass uses one event-capturing container per frame. Lists and text pages are
the only two layouts. The phone surface is a separate long page.

| Screen | Header | Main content | Footer | Back goes to |
|---|---|---|---|---|
| `pairing` / no client | `OKTOSO · v<version>` | Pair in phone, scan QR, paste code, connect | `Phone setup` | none |
| `home` | `OKTOSO · v<version>` | Inbox, Unsent?, Retry/failure?, Recent, Current?, Symbols, Settings | `Tap open · Swipe move · Live/Polling` | none |
| `inbox` | `ATTENTION <shown>/<total>` | all blocking rows, capped unread rows, `More · n` | `Tap open · Swipe move · Back ×2 · Live` | Home |
| `sessions` | `RECENT <n>` | five root sessions + failure row | `Tap open · Swipe move · Back ×2 · Live` | Home |
| `attention` | `glyph title` | summary (2 lines) + action list | `Tap choose · Back ×2` | Inbox |
| `glass-form` | `FORM · <attention title>` | fields + `Submit answer` | field error or `Tap change · Back ×2` | Attention |
| `glass-options` | `SELECT · <field label>` | option rows | `Tap choose · Back ×2` | Form |
| `chat` | `project · title` (or title) | six wrapped lines; body tap is gate-aware | one prioritized line: `? Answer`/`Tap actions`, line/message, activity, stream state, failure, `New below`, hint | origin (home/inbox/recent) |
| `answer` | `ANSWER · title` or `ANSWER · n questions` | question summary + choices + `Type answer` / `Answer on phone` / `More` / `Read chat` | `Swipe choose · Tap send · Back ×2` | Chat |
| `answer-more` | `MORE · title` | `Q  <question>` + `More replies` / `Read chat` / `Stop` | `Tap choose · Back ×2` | Answer |
| `answer-type` | `TYPE · title` | `Type on the phone` | `Tap to focus phone · Back ×2` | Answer |
| `answer-sent` | `ANSWER · title` | `Sent` + text / count | `Tap to return · Back ×2` (auto-return) | Chat |
| `answer-confirm` | `CONFIRM · title` | `Send this answer?` + quoted text | `This cannot be undone.` | Answer |
| `answer-stale` | `ANSWER · changed` or `ANSWER · resolved` | changed/resolved copy | `Tap choose · Back ×2` | Chat |
| `session-actions` | `SESSION` | `Stop` (running) / `Phone keyboard` | `Tap choose · Back ×2` | Chat or More |
| `reply` | `REPLY n/N` + ` · Suggested` on a model page | model answer / `Alt:` / `Ask:` first, then canned | `Tap choose · Back ×2` (or `Sending…`) | Chat or More |
| `choices` | `CHOOSE n` + ` · Suggested` | choice labels | `Tap choose · Back ×2` | Reply |
| `voice` | `VOICE` | `Listening…` / tap to stop / Back cancels | `Tap to stop` | Chat |
| `failure` | `SESSION EXPIRED` / `HUB OFFLINE` / `AGENT OFFLINE` / `TIMEOUT` | failure message | `Pair again…` or `Tap choose · Back ×2` | origin |
| `pending` | `UNSENT · n` | target session + first lines | `Tap choose · Back ×2` | Home |
| `legend` | `SYMBOLS` | 12 glyph rows | `Swipe · Back ×2` | Home |
| `settings` | `SETTINGS` | actions `Refresh data`, `Reload app`; body with connection/version/last refresh | `Tap choose · Back ×2` | Home |
| `settings-reload` | `RELOAD APP` | reload warning | `Tap choose · Back ×2` | Settings |

The phone surface contains, in order: brand/version, pairing/token panel or
connected state, question card, form card, phone keyboard, glasses preview,
symbol guide, and bridge diagnostics.

## 2. Flow map

```text
Start
└─ pairing / token
   └─ connect ───────────────────────────────────────────────► Home

Home
├─ Inbox ───────────────────────────────────────────────────► Inbox
│  └─ attention row ────────────────────────────────────────► Attention
│     ├─ Answer on glass ─► Glass form ─► Glass options ─┐
│     ├─ Answer on phone ─► Phone form                   │
│     ├─ Approve / Deny / Mark read / Retry / Dismiss ───┤
│     └─ Answer in chat / Open chat ─► Chat (back here)  │
│                                                        └─► Inbox
├─ Recent sessions ────────────────────────────────────────► Recent
│  └─ session row ─────────────────────────────────────────► Chat (back Recent)
├─ Current row (when a session exists) ────────────────────► Chat (back Home)
├─ Symbols ────────────────────────────────────────────────► Legend (back Home)
├─ Settings ───────────────────────────────────────────────► Settings (back Home)
├─ Unsent · n ─────────────────────────────────────────────► Pending (back Home)
└─ Retry · <state> / Pair this phone ──────────────────────► retry or failure

Chat
├─ tap body, pending question ─────────────────────────────► Answer
├─ tap body, decision moment (reply gate) ─────────────────► Reply
├─ tap body, gate says wait/done ──────────────────────────► Session actions
├─ scroll ──────────────────────────────────────────────────► chat line movement
└─ Back ×2 ─────────────────────────────────────────────────► origin

Answer
├─ choice tap ───────────────► SENT ── tap / 1.2 s ────────► Chat
├─ destructive choice ───────► CONFIRM ─ Send/Cancel ──────► Answer
├─ Type answer ──────────────► TYPE ── phone send ─────────► SENT
├─ Answer on phone (batch) ──► phone batch form ───────────► SENT
├─ More ─────────────────────► MORE
│  ├─ More replies ──────────► Reply (back to MORE)
│  ├─ Read chat ─────────────► Chat
│  └─ Stop ──────────────────► Chat
└─ Read chat ────────────────► Chat

Reply
├─ answer / opposite / ask ──► send ───────────────────────► Chat
├─ Continue / Explain / alternatives ──────────────────────► send / interrupt
├─ Find choices ─────────────► CHOOSE ── send ─────────────► Chat
├─ Phone keyboard ───────────► Chat + phone focus
├─ Voice reply ──────────────► VOICE ── stop ──────────────► Chat
└─ Back ×2 ──────────────────► Chat or MORE

Any request / stream failure ──► FAILURE
├─ Retry ────────────────────► original screen and retry
├─ Pair this phone ──────────► phone pairing
└─ Back ─────────────────────► origin

Event stream
├─ Live ─────────────────────► home/inbox refresh, chat append
├─ Polling / Reconnecting ───► home/inbox/settings status
└─ Auth / offline ───────────► failure or inline failure row
```

## 3. Interaction grammar

| Input | Behavior |
|---|---|
| Tap / R1 tap | Open, select, reply, send, toggle a form field, or stop voice |
| Double tap | Back to the origin screen |
| Scroll / swipe | Move list selection or chat lines |
| No long press | The SDK exposes no reliable long-press event |

- One event-capturing container per frame: the list, or the text body on
  `type`/`sent`/`voice`/loading screens. The footer is never a button.
- Chat is six lines. A tap on the body opens Answer, Reply, or the `SESSION`
  action list depending on the gate; scroll moves lines.
- Chat scroll acceleration is `1, 1, 2, 2, 4` within a 500 ms window.
- The transcript stays put while streaming unless the reader is at the bottom;
  then it follows. `New below` marks unseen messages.
- Read markers are hub-backed; opening a chat marks it read.
- SSE is primary; polling runs only while SSE is disconnected.
- Pending sends are persisted and retried with the original idempotency key.
- The phone surface mirrors question, batch, form, and keyboard fallbacks so a
  long answer does not have to be entered on the glasses.

## 4. What already works well

- The six-line viewport and three-option list are a good fit for 576×288.
- One capture container keeps input handling predictable and avoids footer
  buttons.
- Back always follows the origin; the chat/reply/More branches preserve it.
- Question discovery on Home/Recent/Inbox and the inline attention card keep
  blocking questions visible before the chat is opened.
- Child sessions use `›` without adding unread noise.
- The failure taxonomy is distinct and actionable.
- Idempotent sends, unsent persistence, and stale-question protection are solid.
- The phone surface is a genuine fallback, not a stub.
- The glyph legend is discoverable and read-only in the right way.

## 5. Findings, prioritized

### P0 — fix before calling the glass UX complete

**1. Inbox can hide blocking items beyond the first five.**
`state.attention = page.data.slice(0, 5)` trims permissions, questions, and
errors as well as unread sessions. A sixth blocking permission is invisible on
the glass; the Home count still says there is more, but there is no way to reach
it on the glass.
Fix: keep all `priority: "blocking"` items, cap only unread items, sort blocking
first, and show `ATTENTION 5/12` with a `More` row or allow the list to scroll.
This is the highest-risk finding.

**2. Provider-native questions are not part of the chat question flow.**
`QuestionService.get` parses assistant text questions only. A `question` tool
part (the Android session is the live example) appears in the Inbox form, but
`GET /sessions/:ref/question` returns `null`; the chat footer never shows
`? Answer`, and tapping chat opens the reply menu instead of the answer screen.
Fix: share the tool-question extraction with `QuestionService`, map it to a
`QuestionPrompt`, and keep the Inbox form as the formal alternative. This
removes the split between “Answer in Inbox” and “answer from chat”.

**3. Tap-to-reply is gate-blind and produces a contradictory screen.**
`handleTextClick` opens Reply whenever there is no question. With the new reply
gate, a running or finished session returns `state: wait` / `done`; `openReply`
sets a notice but still shows the canned list, including `Continue`,
`Show alternatives`, and `Explain risk`. `Stop` is on a later page.
Fix: make the chat tap state-aware:
- pending question → Answer
- decision moment → Reply
- wait/done → a small `SESSION` actions screen (`Stop` when running,
  `Phone keyboard`, `Back`) or a transient status with no screen
Also make the canned list state-aware so `Stop` is first while running and
`Read chat`/`Phone keyboard` replace `Continue` when there is no decision.

**4. Settings mixes actions with read-only rows and puts Reload first.**
The list is `Reload app`, `Refresh data`, `Connection`, `Version`, `Last
refresh`. Only the first two act. The footer says `Tap open`; tapping
`Connection` or `Version` highlights the row and does nothing. `Reload app` is a
full webview reload with no confirmation and loses the current screen.
Fix: keep the list to actions only, put connection/version/last refresh in the
body or footer, put `Refresh data` first, and add a confirm step for
`Reload app`.

**5. Home puts failure and unsent rows below navigation.**
The order is Inbox, Recent, Current?, Symbols, Settings, failure, Unsent. A
failed send or a retryable failure can be pushed below the fold by adding a
Current row.
Fix: Inbox, Unsent, failure/Retry, Recent, Current, Symbols, Settings. State
rows belong above navigation, not after it.

### P1 — polish that materially improves daily use

**6. The chat footer is overpacked and truncated.**
`chatView` joins sending/question, line range, message range, activity, failure,
`New below`, and the swipe hint, then clamps the whole string to 60 characters.
Long sessions lose the hint or the activity. Fix: two-line footer, or prioritize
`? Answer`/`Tap reply`, line/message, activity; move the swipe hint to a
dedicated short label; use `L`/`M` compactly.

**7. There is no visible reply affordance on chat.**
The footer only adds `? Answer` for questions. The tap-to-reply gesture is
documented but not shown. Fix: show `Tap reply` when the gate says reply, and
`Tap actions` when it says wait/done.

**8. Reply roles are not visually distinct.**
Only the page header says `Suggested`; the answer and ask rows look like canned
rows. The opposite has an `Alt:` prefix, the ask has no marker, and the ask
often lands on page 2. Fix: one small per-row model marker (verify a font-safe
glyph), keep `Alt:`, and consider putting the ask on the first page when it is
the only real decision.

**9. The phone pairing panel stays expanded after pairing.**
The pairing/token section is always visible and is several hundred pixels tall.
It pushes the question card, form, and keyboard down the page.
Fix: collapse to a compact `Connected · Pair another` row after connection, with
the pairing form behind a disclosure.

**10. The Inbox count is misleading.**
`ATTENTION 5` is the number of rows shown, not the total. Combined with filtering
at five, a user cannot tell whether there are hidden blocking items. Fix:
`ATTENTION 5/12` plus a `More` action or a scrollable list.

**11. The Current session is lost on reload.**
`sessionRef`, title, project, and parent ref are in memory only. `Reload app`
and a webview restart clear the Current row, so the user must find the session
again. Fix: persist the last session metadata in localStorage and restore the
Current row; optionally reopen the chat only on explicit tap.

**12. Loading pages have no escape.**
`showLoading` and the chat loading page use `Please wait` as the footer. The
back event works but is not advertised. Fix: add `Back ×2` or a `Cancel` row to
the loading page.

### P2 — consistency and copy

**13. `answer-stale` says `ANSWER · changed` even when the reason is resolved.**
Use `ANSWER · resolved` for the resolved branch.

**14. Footer verbs are inconsistent.**
`Tap open`, `Tap select`, `Tap choose`, and `Back ×2` are used for similar
actions. Standardize: `Tap open` for navigation, `Tap choose` for a list
selection or send, `Double-tap back` (or a short `Back ×2` with a legend) for
back.

**15. The phone “Refresh glasses” label is ambiguous.**
On Settings it refreshes data; it does not reload the app. Rename to
`Refresh data`, and add a `Reload app` action only if the phone should own that
operation.

**16. The chat screen does not show the connection mode.**
Home, Inbox, Recent, and Settings show `Live`/`Polling`/`Reconnecting`; Chat
does not. Add a compact non-live indicator to the header or footer.

**17. `answer-sent` uses the session header, not `SENT`.**
The body says `Sent`; the docs describe a `SENT` state. Either use a `SENT`
header or update the docs and keep `ANSWER` consistent.

**18. Settings info hierarchy is weaker than its actions.**
Version already appears in the Home header; `Connection`, `Version`, and
`Last refresh` do not need to look like selectable rows. Put them in a body
summary or footer, as in P0-4.

## 6. Recommended target flow

Keep the existing IA for tasks and questions. Change only the ambiguous entry
from chat:

```text
Chat
├─ question exists ─────────► ANSWER
├─ reply gate says reply ───► REPLY
└─ reply gate says wait/done ► SESSION
                               ├─ Stop (running)
                               ├─ Phone keyboard
                               ├─ Read chat? (already here; omit)
                               └─ Back
```

The `SESSION` screen uses the existing list pattern with one primary action
(`Stop` when running), one fallback (`Phone keyboard`), and the standard
`Back ×2`. It is state-aware, not a new destination for questions or replies.

Home order:

```text
Inbox · total
Unsent · n           (when present)
Retry · <state>      (when present)
Recent sessions
Current · marker title (when present)
Symbols
Settings
```

Settings layout:

```text
SETTINGS
[Refresh data]
[Reload app]         (confirm)
Connection · Live
Version · v0.1.25
Last refresh · 17:14
```

The first two rows are the only list actions; the last three are informational
body text.

Inbox behavior:

- blocking items first, all of them
- unread items after blocking, capped
- `More` row when there are more items
- header `ATTENTION <shown>/<total>`

## 7. Implementation order

1. **Attention safety:** keep all blocking items, add `More`, fix the count.
2. **Question parity:** tool questions in `QuestionService`; chat `? Answer`.
3. **Chat tap:** gate-aware Answer/Reply/Session actions; state-aware canned
   reply list.
4. **Settings:** action/info split; reload confirmation; home order.
5. **P1 UI:** chat footer, reply affordance/roles, phone pairing collapse,
   Current persistence, loading escape.
6. **P2 copy:** stale header, hint vocabulary, phone refresh label, chat
   connection status, sent header.

Steps 1–4 changed behavior or IA and were approved before implementation.
Steps 5–6 were visual/copy refinements that followed without changing the
navigation model.

## 8. Implementation status

All findings are implemented in the G2 app and hub services. Verification covers
code-level checks, the phone surface, and the Even Hub simulator; the new screens
have not yet been exercised on G2 hardware.

| # | Finding | Resolution |
|---|---|---|
| 1 | Inbox hid blocking items | `visibleAttention` keeps every blocking item, caps unread, sorts blocking first, and adds `More · n`. |
| 2 | Tool questions missing from chat | Shared `tool-question.ts` is used by `QuestionService` and the reply service; running `question` calls produce a chat prompt and `? Answer`. |
| 3 | Gate-blind chat tap | `openReply` routes wait/done to `SESSION` (`Stop`/`Phone keyboard`), questions to `ANSWER`, decisions to `REPLY`. |
| 4 | Settings mixed actions and info | `SETTINGS` lists only `Refresh data` and `Reload app`; info moved to the body; reload opens `RELOAD APP` with `Reload` / `Cancel`. |
| 5 | Home state rows below navigation | Order is Inbox, Unsent, Retry/failure, Recent, Current, Symbols, Settings. |
| 6 | Chat footer overpacked | One prioritized line: action, line/message, activity, stream, failure, `New below`, then the hint if it fits whole. The 42 px footer cannot fit two lines at G2 type size. |
| 7 | No visible reply affordance | Footer shows `? Answer` for questions and `Tap actions` otherwise. |
| 8 | Reply roles not distinct | Model roles sort first; ask is labelled `Ask:` and opposite `Alt:`. |
| 9 | Pairing panel stayed expanded | Phone panel collapses to `Connected · <hub>` with `Pair another`; expires/failures expand it again. |
| 10 | Inbox count misleading | Header is `ATTENTION <shown>/<total>` whenever items remain hidden. |
| 11 | Current lost on reload | Last session metadata persists in `oktoso-even-g2-current` and restores the Home `Current` row. |
| 12 | Loading had no escape | Loading pages show `Please wait · Back ×2`. |
| 13 | Stale header always `changed` | Resolved branch reads `ANSWER · resolved`. |
| 14 | Footer verbs inconsistent | Selection and send use `Tap choose`; navigation keeps `Tap open`. |
| 15 | Phone refresh label ambiguous | Phone button reads `Refresh data`. |
| 16 | Chat hid connection mode | Chat footer shows non-live `Polling`/`Reconnecting`/`Offline`/`Pair` state. |
| 17 | Sent screen reused the session header | Sent screen header is `SENT`. |
| 18 | Settings info looked selectable | Connection, version, and last refresh are body text, not rows. |

Verification run: `pnpm typecheck`, `pnpm test` (405 passing), web build, G2
build, hosted G2 build, browser checks driving the glass handlers through the
phone preview, and Even Hub simulator captures of Home (including Current), Inbox,
Settings, Reload confirmation, Chat (one-line footer), SESSION with `Stop`, and
ANSWER. The phone surface was checked for pairing collapse and re-expansion.
Still pending: real G2 hardware input, latency, and rendering.
