# G2 Question Flow

Status: **design + implemented**. Revised after the isolated G2 answer-flow
spike. Question detection, the ANSWER response surface, phone handoff, stale
revision checks, idempotent retry, voice, and model-written suggested answers are
implemented. Does not modify `glass-ux.md`, `wearables.md`, or `ui-ia.md`; those
need a short amendment when this is approved.

Scope: answering AI-agent questions from Even G2 glasses and the G2 phone
companion. The glasses support choices, sentinel-aware free text, voice, a short
list of suggested answers, and a multi-question batch answered one question at a
time; the phone remains the keyboard and the batch fallback.

---

## 0. Recommendation in one page

Adopt a **dedicated, question-first ANSWER screen that is a mode of chat, not a
replacement for it**.

The chat remains the reading surface. When the latest *completed* assistant
message ends in a question, chat opens at the question line and the footer
advertises `? Answer`. Tapping opens a single-purpose screen containing:

- the question in a two-line summary,
- **one event-capturing list** containing the agent's choices followed by the
  action rows (`› Type answer`, `› Speak answer`, `› Suggested answers`, and
  `› Failure` when the chat has one),
- a non-interactive footer hint.

The list, not the footer, owns input. This is a measured SDK constraint: only one
container per page may capture events, and a tap on a text container does not
identify which container was hit. The spike confirmed that a four-container page
(header, summary, list, footer hint) rebuilds when only the list captures, and a
six-item list scrolls and selects beyond the visible four rows.

A choice opens `REVIEW`; only its `Send` row sends. Destructive choices open a `CONFIRM` screen first;
sensitive questions add a text warning but still send normally. Free text hands
off to the phone card, which puts the existing composer into answer mode. A
multi-question prompt opens the same screen with `› Answer N questions` (one
question per glass screen, then review) and `› Answer N questions on phone` as
the fallback. A sentinel choice such as `Other` becomes `Type your own answer`
instead of a row that would send the literal word. When transcription or the
reply model is configured, the same screen offers `Speak answer` and 2–3
`Suggested answers`; both reuse the normal message path. Every send carries the
question revision and an idempotency key; if the question changed, the hub
rejects the send and the glasses ask the user to review instead of silently
answering the wrong question.

This is better than the draft because it:

1. puts question detection on the read path, not on reply generation;
2. makes the question visible before the user answers it;
3. works with the SDK's single-capture constraint instead of assuming footer
   hit-testing;
4. lets the list scroll: six choices plus action rows are reachable without
   paging;
5. adds stale-question protection and idempotent retry;
6. keeps the transcript one back away and preserves the exact reading line;
7. handles free-form, multiple questions, voice, and suggestions through one
   answer model rather than one screen per question type.

### The five-step interaction

1. Open the session. Chat starts at the pending question; the footer reads
   `? Answer · L…/…`.
2. Tap the chat body. `ANSWER` shows the question and the agent's choices in the
   list; the first four rows are visible.
3. Swipe to a choice and tap. Destructive choices open `CONFIRM`.
4. `SENT` shows the exact text sent. Tap the body, or wait 1.2 s, to return to
   chat.
5. Scroll if needed to `Type answer`, `Speak answer`, `Suggested answers`, or
   `Read chat` and tap. Typing hands off to the phone, voice opens the
   microphone, suggestions list candidate answers, and `Read chat` returns to
   the transcript.

| Action from an open chat | Taps | Scroll |
|---|---:|---|
| Common choice / yes/no | 2 (chat, choice) | none for the first four rows |
| Typing | 2 (chat, `Type answer`) + phone send | only if the row is below the fold |
| Voice | 2 (chat, `Speak answer`) + stop | follows the choices |
| Suggested answer | 2 (chat, `Suggested answers`, candidate) | none for three candidates |
| `Read chat` | 2 (chat, `Read chat`) | only if the row is below the fold |
| `Stop agent` | 3 (chat, `Stop agent`, confirm) | only if the row is below the fold |
| Destructive answer | 3 (chat, choice, `Send`) | none for the first rows |

No long-press, no color on the glasses, no new gesture.

---

## 1. Problem and principles

### 1.1 The problem

**Terminology.** A **chat question** is derived from the latest assistant
message text. An **attention question** is a provider-native form/clarify item
with `attention.type = "question"` and structured fields. The chat answer flow
never replaces the attention form flow.

An agent asks a question mid-conversation. The user is on the glasses, possibly
walking or in a meeting, and has no keyboard. They need to understand what is
being asked, choose an answer, and confirm it was sent without losing their place
in the transcript.

The hard parts are not rendering a list:

- **Detection is unreliable.** Agents write plans, status updates, quoted user
  text, and rhetorical questions. Treating every numbered list as choices can
  send a wrong answer.
- **The question is long.** A two-line summary may omit the condition that makes
  the answer safe.
- **The screen is small.** Question + three choices + three actions do not all fit
  the 156 px list area; only four rows are visible at once.
- **Taps are cheap.** A walking user can tap the wrong row. Sending a chat message
  cannot be undone.
- **The transcript moves.** A question answered from a stale snapshot may no
  longer be the agent's pending question.
- **The phone is nearby but not always in hand.** The glasses must handle the
  common cases alone; the phone is the keyboard, not the primary surface.

### 1.2 Principles

1. **Answer where the question is.** The question is the anchor. Chat opens at
   the question line, not the start of a 60-line message.
2. **One decision per screen.** Choices are the decision. Typing is the escape
   hatch, not a second form on the same screen.
3. **Two taps for the common answer, three for a risky one.** Speed matters, but
   never at the cost of a destructive send. Action rows may require one scroll;
   do not spend a tap to reveal them.
4. **Never guess a choice from prose.** A list is a choice list only when it is
   adjacent to the question and passes the plan/task filters. Low confidence
   becomes free text, not a button.
5. **The transcript is never more than one back away.** `Read chat` is always on
   the answer screen; back returns to the exact line.
6. **The phone is the keyboard, not the product.** Choices work on the glasses.
   Free text hands off to the phone; a batch is answered question by question on
   the glass, with the phone form kept as the fallback.
7. **Monochrome state uses position and borders.** No color-only meaning; no
   icons without labels.
8. **No hidden gestures.** Tap, double tap, scroll. No long-press requirement.
9. **Never answer a stale question.** Carry the question revision; reject with a
   review path.
10. **One answer model.** Choice, yes/no, free text, voice, and suggestions all
    become the same `AnswerDraft`; the renderer reads capabilities, not a
    per-kind screen.
11. **One capture container; actions live in the list.** The list (or a status
    text body) is the only event target. The footer is a hint. Do not design
    split footers, per-container hit testing, or footer buttons.

### 1.3 What is wrong with the draft

| Draft assumption | Problem | Fix in this spec |
|---|---|---|
| Question metadata on `reply-options` | Reading chat would trigger reply generation or require a generation endpoint just to know a question exists. | Hub-owned `QuestionService` + `GET /sessions/:ref/question`. |
| `ANSWER` shows 3 choices + Type + More replies + Read chat | Six rows cannot all be visible in 156 px; the draft did not specify what happens below the fold. | Choices + action rows in one scrolling list; four rows visible; footer is a hint. No `More` detour: free text is a first-class row. |
| Tapping chat opens `ANSWER` | Fine, but chat still opens at the start of the latest message, so the question may be off-screen. | Chat opens at the question line when pending. |
| Tap a choice sends | A walking tap or ring tap can send the wrong answer. | A choice opens `REVIEW`; only `Send` sends. |
| Extract numbered/bulleted choices | Agent plans and task lists become buttons. | Adjacency, plan, task, code, and quote filters; confidence floor. |
| Phone card above keyboard | Duplicates the existing composer and two send paths. | One composer in answer mode; the card only adds question/choices. |
| No stale handling | A send can answer a question that was replaced. | `revision` + `409 question_changed` + `Review`. |
| No idempotency | Retrying after a timeout can duplicate the answer. | `Idempotency-Key`; hub dedupes identical retries for 30 days. |

### 1.4 Spike constraints (measured)

The temporary isolated spike, driven through the EvenHub simulator, measured
these constraints. They supersede the earlier split-footer design. The spike
harness was removed from the repository after validation; the measurements are
recorded here.

| Observation | Result |
|---|---|
| 5 containers, 3 captures (header, summary, list, two capturing footers) | `rebuildPageContainer` returned `false`. |
| 4 containers, 2 captures (two capturing footers) | `false`. |
| 4 containers, 2 captures (list + one footer capture) | `false`. |
| 4 containers, 1 capture (footer-left capture + footer-right hint) | `true`. |
| 5 containers, 1 capture (list + two footer hints) | `true`. |
| Tap on the only capturing text container | `sysEvent`, `eventSource = 1`, no container ID. |
| 6-item list in 156 px | 4 rows visible; five `down` inputs reached index 5; the window moved to rows 3–6. |
| `click` after scrolling | `listEvent.currentSelectItemIndex = 5`. |

Conclusions:

1. **One event-capturing container per page.** Container count is not the limit;
   captures are. Do not plan for two footer buttons or per-container hit testing.
2. **A single text capture has no container identity.** It is only "the page was
   tapped"; route it by screen state, not by container.
3. **The list scrolls and selects beyond the visible rows.** Paging is optional;
   a single list can hold choices plus actions.
4. **The four-container answer layout works:** header 32 + summary 56 + list 156
   + footer hint 42, with the list as the only capture.

---

## 2. Recommended interaction

### 2.1 User story

Maya is walking into a meeting. Her phone buzzes; the agent has finished a
review and asked whether to squash three fix commits. She taps her right temple.
The glasses show the session's current chat, positioned at the question, with
`? Answer` in the footer. She taps once. The `ANSWER` screen shows:

```
Q  Should I squash the three fix commits into one?
   Branch: fix/auth-race

▸ Yes, squash them
  No, keep them separate
  Let me review the diff first
  Type answer
  ...
```

Four rows are visible; the free-text and utility rows are below the fold. The
first row is selected by border. She swipes once to `No, keep them separate` and
taps. The screen says `SENT` with the exact text, then returns to chat. Total:
three taps, one swipe, about four seconds.

Later, the agent asks which branch to target. There are no choices, so the list
starts with `Type answer`. She may need one scroll if the list has scrolled
before; she taps `Type answer`; the phone in her hand opens the question card and
keyboard. She types `release/2.4` and taps `Send answer`. The glasses show
`SENT`. She never reads the full transcript, and back always returns to where she
was.

### 2.2 Step by step with screen states

1. **Chat, question pending.** The chat shows the latest message, scrolled to the
   question line with two context lines above it. The footer is
   `? Answer · L456-461/461 · M30/30`. Tap anywhere in the body.
2. **`ANSWER`.** Header `ANSWER · oktoso`. Summary `Q  <question>` plus one
   context line. The only capture is the list: choices in the agent's order,
   then `Type answer` (when free text is allowed), `Speak answer`,
   `Suggested answers`, and `Read chat`. Four rows are visible; the rest are
   below the fold. Footer hint:
   `Swipe choose · Tap to review · Back ×2` when there are choice rows, otherwise
   `Tap choose · Back ×2`.
3. **Choose.** Swipe moves the selection border. Tap the selected row. Normal
   choice → `SENDING`. `requiresConfirmation` choice → `CONFIRM`.
4. **`CONFIRM`.** Summary `Send this answer?` plus the exact text and a one-line
   consequence (`This cannot be undone.`). List `Send` / `Cancel`; footer hint
   `Tap choose · Back ×2`. Back returns to `ANSWER`.
5. **`SENDING`.** Summary `Sending…` plus the exact text. The text body captures
   but ignores input; back is ignored until the hub accepts or fails (short
   timeout). Footer hint `Sending…`.
6. **`SENT`.** Summary `Sent` plus the exact text. The text body is the only
   capture; tap it, or wait 1.2 s, to return to chat. The question marker is
   kept until a question refresh confirms what the provider did with it. Footer
   hint `Tap to return · Back ×2`.
7. **`ANSWER_ERROR`.** Summary `Couldn’t send.` + reason on line 1 and the exact
   answer on line 2. List `Retry`, `Choose again`, `Read chat`; footer hint
   `Tap choose · Back ×2`. Back → `ANSWER`.
8. **Optional rows.** `Speak answer` when transcription is configured (after the
   choices), 2–3 `Suggested answers` from the local reply model, `Failure ›`
   when the chat has a recoverable failure, `Read chat`, and a confirmed
   `Stop agent`. Footer hint `Tap choose · Back ×2`. Back → `ANSWER`.
9. **`TYPE`.** Summary question. Body `Type on the phone.` / `The answer sends
   from there.` The text body is the only capture; tapping it re-focuses the
   phone handoff. Footer hint `Tap to focus phone · Back ×2`. Back → `ANSWER`.
10. **Phone send.** The glasses move to `SENT`; the phone card shows `Sent` and
    keeps the text until dismissed. Back on the glasses → `ANSWER`.

### 2.3 Why this is better than the alternatives

- **Versus replacing chat entirely:** the answer screen is a mode with a clear
  back path and the same session header. The transcript is not hidden
  permanently, and the reading position is preserved.
- **Versus an overlay:** an overlay that shows the question plus three choices
  needs about 200 px, leaving two chat lines and an ambiguous focus target. A
  dedicated screen is calmer and cheaper to implement.
- **Versus inline choice rows in the transcript:** the chat body is a single
  text container. Choices need a list container; splitting the body would break
  the six-line viewport and the scroll model. A synthetic answer card at the
  bottom would consume most of the transcript.
- **Versus phone-first:** requiring the phone for every answer defeats the
  glasses. The phone remains the fallback for typing and long lists, and for a
  batch it is always one row away, but it is not the only way to answer.
- **Versus reply-menu-first:** the generic reply menu hides the question and
  mixes `Continue`, `Explain risk`, and the actual choices. The question screen
  shows the decision first. The reply menu remains the no-question path.

---

## 3. Screen-state machine

### 3.1 States

| State | Purpose | Layout |
|---|---|---|
| `chat` | Read transcript. Footer advertises a pending question. | Existing six-line chat, text containers. |
| `answer` | Choose or start a free-form answer. | Header, summary, one list (choices + action rows), footer hint. List is the only capture. |
| `batch` | Answer one question of a multi-question prompt. | Same layout as `answer`; header `ANSWER · Q1/N`, question summary, numbered choices + `Type answer` / `Speak answer` / `Suggested answers` / `Answer on phone` / `Back`. |
| `batch-review` | Review every batch answer and send them together. | Header `REVIEW · N answers`, one numbered answer row per question, `Send all` / `Back`. |
| `suggested` | Pick a model-written candidate answer. | Header, question summary, one list of 2–3 suggestions, footer hint. Back → `ANSWER`. |
| `confirm` | Review a destructive answer. | Header, summary, list `Send`/`Cancel`, footer hint. |
| `type` | Wait for the phone keyboard. | Header, summary, text body (only capture), footer hint. |
| `sending` | Lock input until the hub accepts or fails. | Header, status summary, text body (capture ignores input), footer hint. |
| `sent` | Confirm the exact text went to the hub. | Header, summary, text body (tap returns), footer hint. |
| `error` | Preserve the answer and offer retry/rechoose. | Header, error summary, list `Retry`/`Choose again`/`Read chat`, footer hint. |
| `stale` | Question changed or was answered elsewhere. | Header `ANSWER · changed` or `ANSWER · resolved`, warning summary, list `Review`/`Read chat`, footer hint. |
| `reply` | Existing generic reply menu. | Model roles first; the gate may route wait/done to `SESSION` instead. |
| `choices` | Existing manually extracted choices. | Unchanged. |

State identifiers are lower-case; screen headers use the corresponding
upper-case label (`ANSWER`, `SUGGESTED`, `CONFIRM`, `TYPE`, `SENT`, `SESSION`).
`sending` keeps the `ANSWER` header as a status state; `sent` uses `SENT`.

Every state has **exactly one event-capturing container**. `answer`,
`suggested`, `confirm`, `error`, and `stale` use the list. `type`, `sending`,
and `sent` use a text body. The footer is always `isEventCapture: 0` and is a
hint, not an action.

`answer`, `suggested`, `confirm`, `type`, `sending`, `sent`, `error`, and
`stale` are sub-states of the answer flow, not new navigation destinations.
They are entered from chat and always return to chat or `answer`.

### 3.2 Transitions

| From | Input | To | Notes |
|---|---|---|---|
| `chat` no question | Tap body | `reply` or `session` | The reply gate decides. `reply` only when a decision is ready; `wait`/`done` opens `session` actions. |
| `chat` question | Tap body | `answer` | No send. Question captured with revision. |
| `chat` question | Scroll | `chat` | Reading only. |
| `chat` any | Double tap | origin | Existing back. |
| `answer` | Tap choice row | `sending` | Unless `requiresConfirmation`. |
| `answer` | Tap confirm choice row | `confirm` | Exact text + consequence shown. |
| `answer` | Tap `Type answer` row | `type` | Focus phone composer. |
| `answer` | Tap `Answer N questions` row | `batch` | Multiple questions; opens Q1 on the glass. |
| `answer` | Tap `Answer N questions on phone` row | `type` | Whole-batch phone form; the entries stay in the batch. |
| `batch` | Tap numbered choice | `batch` / `batch-review` | Stores `{choice, text}` and advances; review after the last question. |
| `batch` | Tap `Type answer` row | `type` | Batch mode: the phone save stores the entry and advances. |
| `batch` | Tap `Speak answer` row | `voice` | Batch mode: `Send` stores the transcript and advances, never a reply. |
| `batch` | Tap `Answer on phone` row | `batch` | Phone form for the whole batch, entries preserved; Back stays in the batch. |
| `batch` | Double tap / back | `batch` / `answer` | Previous question, or `ANSWER` at Q1. |
| `batch-review` | Tap a numbered answer | `batch` | Jumps to that question to edit it. |
| `batch-review` | Tap `Send all` | `sent` | Validates every entry first; never sends a partial batch. |
| `batch-review` | Double tap / back | `batch` | Returns to the last question. |
| `answer` | Tap `Answer in Inbox` row | `attention` (existing) | Provider-native question wins. |
| `answer` | Tap `Speak answer` row | `voice` | Recording; back/cancel returns to `answer`. |
| `answer` | Tap `Suggested answers` row | `suggested` | Model candidates; back returns to `answer`. |
| `answer` | Tap `Failure ›` row | `failure` / `turn-failed` | The failure screen, with back to `answer`. |
| `answer` | Tap `Read chat` row | `chat` | Opens at question line. |
| `answer` | Tap `Stop agent` row | `interrupt-confirm` | Confirm/cancel return to `answer`. |
| `answer` | Scroll | `answer` | List scroll/selection only; no send. |
| `answer` | Double tap | `chat` | Exact line preserved. |
| `confirm` | Tap `Send` | `sending` | Reuses the same draft/idempotency key. |
| `confirm` | Tap `Cancel` / back | `answer` | Selection resets to first row; note below. |
| `suggested` | Tap a suggestion | `chat` | Sends it as ordinary free text. |
| `suggested` | Back | `answer` | Candidates are not a draft. |
| `type` | Phone send | `sending` → `sent` | Shared app state; glasses update. |
| `type` | Tap body | `type` | Re-focus phone handoff; no other action. |
| `type` | Double tap / back | `answer` | Composer keeps text. |
| `sending` | 202 | `sent` | Input locked; back ignored. |
| `sending` | Error | `error` | Answer preserved. |
| `sent` | Tap body / 1.2 s | `chat` | Load latest; keep the marker until the question refresh settles it. |
| `error` | Tap `Retry` | `sending` | Same draft and idempotency key. |
| `error` | Tap `Choose again` | `answer` | Same question if not stale. |
| `error` | Tap `Read chat` | `chat` | Question line; answer not sent. |
| `error` | Back | `answer` | Return to the choices; answer preserved. |
| `answer` | Revision changed | `stale` | Freeze list; do not swap choices. |
| `stale` | Tap `Review` | `answer` | Load new revision, reset selection. |
| `stale` | Tap `Read chat` / back | `chat` | New question visible in transcript. |
| any answer state | Answered elsewhere | `stale` | Copy `Answered already.` |

**Back is always available**, including on error and stale screens. During
`sending` only, back is ignored until the hub returns; the hub call is bounded
(hub acceptance, not provider completion).

#### 3.2.1 Row plan and action indices

`listEvent.currentSelectItemIndex` is an index into the rendered list. Build the
list as an ordered `AnswerRow[]`; route a tap by `rows[index].kind`, never by a
hard-coded footer index.

| Layout | Rows, in index order |
|---|---|
| Provider-native question (`attentionID`) | `Answer in Inbox`, then optional `Failure ›`, then `Read chat`, `Stop agent` |
| Multiple questions (`answer`) | `Answer N questions`; `Answer N questions on phone`; optional `Failure ›` |
| Each batch question (`batch`) | choices numbered from 1; `Type answer` when free text or a sentinel; `Speak answer` when configured; `Suggested answers` when configured; `Answer on phone`; `Back` |
| Batch review (`batch-review`) | one numbered answer row per question; `Send all`; `Back` |
| Free-form, no choices | optional `Speak answer` first, then `Type answer` (or `Type your own answer` for a sentinel), optional `Suggested answers`, optional `Failure ›`, `Read chat`, `Stop agent` |
| Choices, free text allowed | choices; `Type answer` (or `Type your own answer`); `Speak answer`; `Suggested answers`; `Failure ›`; `Read chat`; `Stop agent` |
| Choices, no free text | choices; `Speak answer`; `Suggested answers`; `Failure ›`; `Read chat`; `Stop agent` |
| More than six choices | first six choices, then the same action rows; the phone shows all |

`C = min(primary.choices.length, 6)`. A choice row sends; an action row performs
its labelled action. A free-answer sentinel (`Other`, `Something else`, `Custom`,
`Type your own…`) is never a choice row: it becomes `Type your own answer`, and
the literal sentinel is never sent. Voice follows the choices so a stray first
tap cannot open the microphone; it may lead only when the question has no
choices. Suggested answers are model text and always send as free text. The
`Failure ›` row is present only when the chat has a recoverable failure, and the
`Stop agent` row keeps the same confirmation screen as the chat menu. In the
batch, every question renumbers from 1, a sentinel becomes `Type answer`, and
the review rows are edit targets rather than send targets.

If a future variant adds a row, append it before `Read chat` and `Stop agent`,
and do not renumber existing rows without updating the routing and tests.

The footer hint never receives the click. If the list is the only capture, a tap
outside the list (the footer) produces no list event; this is intentional.

### 3.3 Send, failure, offline

- **Accept path.** Tap → `sending` → hub `202` → `sent` → chat. The hub queues
  the provider send; `202` means "accepted", not "agent replied".
- **Synchronous failure.** Show `error` with the exact answer. The question and
  revision are preserved. `Retry` reuses the same idempotency key.
- **Provider failure after 202.** The answer is already accepted; the session
  shows an error attention item. The glasses do not show a send error. This
  boundary is important: the glass would otherwise ask the user to retry a send
  that already happened.
- **Offline.** Do not queue silently. `error` copy `Offline. Check the hub
  connection.` Keep the answer. Retry when connected. A stale question is worse
  than a missed send.
- **Auth expired.** `Session expired. Reconnect in phone.` Keep the answer in
  app state; the setup panel is on the same page. After reconnect, retry.
- **Timeout.** `Send timed out.` Retry with the same key; the hub dedupes.
- **Rate limit.** `Too many requests. Wait a moment.` Retry.
- **Provider offline.** `Agent is offline. Retry when it reconnects.`
- **Unsupported send.** `This provider can’t receive replies.` No retry.

### 3.4 Stale and changed questions

The question prompt carries an opaque `revision` derived from the assistant
message ID plus its completed text hash (or `updatedAt` when reliable). The send
includes `questionId`, `messageId`, and `revision`.

- **Changed revision while on `answer`.** Do not rebuild the list under the
  user's finger. Set `stale = true`; header becomes `ANSWER · changed`; replace
  the list with `Review` / `Read chat`; footer hint becomes
  `Tap choose · Back ×2`. The old choices are not selectable.
- **Already answered.** The header reads `ANSWER · resolved` and the body says
  `Answered already.` The list offers `Read chat` only.
- **Send with stale revision.** Hub returns `409` with
  `details.reason = "question_changed"` and the current prompt. Glasses show
  `stale` with `Review` / `Read chat`. No `Send anyway` in v1.
- **Answered elsewhere.** Hub returns `409 question_resolved`, or the client sees
  a user message after the question. Show `Answered already.` + `Read chat`.
- **Question message still streaming.** Do not expose a prompt. Footer keeps
  `Working`; no answer screen. Once complete, SSE/poll produces the prompt.
- **Question message edited but text unchanged.** Ignore. Compare the normalized
  question text and choices, not only the revision, to avoid false stale states.

### 3.5 Real-time rules

- On `chat`, `message.created` / `message.updated` for the session triggers a
  debounced question refetch (500 ms). The footer marker updates without a page
  rebuild if only the footer changed.
- On `answer` or any sub-state, do not live-update the question. Set `stale` on a
  real change. This is deliberate.
- On `type`, a question change disables `Send answer` on the phone and shows
  `Question changed. Review.`; the typed text stays.
- On `sent`, ignore updates; return to chat.
- Opening chat marks the session read (existing). Read does not mean answered:
  the `?` marker is driven by the question prompt, not unread state.
- **Opening at the question.** After `buildChat`, search `chatLines` from the
  latest assistant message start for the first line that contains the first 32
  normalized characters of `question.text`. Set
  `chatOffset = max(0, lineIndex - 2)` so two context lines stay visible. If the
  text is not found (wrapping/truncation), fall back to `latestMessageStart`.
  `Read chat` uses the same helper; `SENT` returns to the latest message instead.

### 3.6 Page rebuild and selection rules

- Entering `answer` rebuilds once. Scrolling within the list does not rebuild.
  There is no paging; the list is one scrollable surface.
- A rebuild resets list selection to the first row. After `Cancel` from
  `confirm`, or returning from `more`, the selection is row 1 again. The user
  must re-select. This is a known SDK limitation; copy and layout make the
  selected row obvious.
- Do not rebuild on phone keystrokes. The glasses show only `Typing…` if needed,
  never the draft text.
- Frame signature includes state, question revision, row labels, summary, and
  footer hint, so unchanged frames are skipped.

---

## 4. Wireframes

Pixel bands match the current list page: 32 px header, 56 px summary, 156 px
list, 42 px footer. The list shows **four rows at a time** and scrolls; the
footer is a **non-interactive hint**. `▸` marks the platform selection border,
not a rendered glyph. `[ … ]` in the phone wireframe is a button.

### 4.1 Choice question

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · oktoso                                           │ 32  header
├──────────────────────────────────────────────────────────────┤
│ Q  Should I squash the three fix commits into one?           │ 56  summary
│    Branch: fix/auth-race                                     │
├──────────────────────────────────────────────────────────────┤
│ ▸ Yes, squash them                                           │ 156 list
│   No, keep them separate                                     │
│   Let me review the diff first                               │
│   Type answer                                                │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Swipe choose · Tap send · Back ×2                            │ 42  hint
└──────────────────────────────────────────────────────────────┘
```

The first four rows are visible: three choices plus `Type answer`. `Read chat` is
below the fold. The list is the only capture; the footer hint is not tappable.

### 4.2 Yes/no

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · oktoso                                           │ 32
├──────────────────────────────────────────────────────────────┤
│ Q  Continue with the failing test?                           │ 56
│    Last run: 1 failed, 2 passed                              │
├──────────────────────────────────────────────────────────────┤
│ ▸ Yes                                                        │ 156
│   No                                                         │
│   Type answer                                                │
│   Read chat                                                  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Swipe choose · Tap send · Back ×2                            │ 42
└──────────────────────────────────────────────────────────────┘
```

Synthesized choices send exactly `Yes` or `No`. `Speak answer`, `Suggested
answers`, and `Stop agent` follow below the fold. Do not invent a third answer.

### 4.3 Free-form question

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · oktoso                                           │ 32
├──────────────────────────────────────────────────────────────┤
│ Q  Which branch should I target for the release?             │ 56
│    No options suggested.                                     │
├──────────────────────────────────────────────────────────────┤
│ ▸ Type answer                                                │ 156
│   Speak answer                                               │
│   Read chat                                                  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap choose · Back ×2                                         │ 42
└──────────────────────────────────────────────────────────────┘
```

The free-form screen is still a list, not a text body. Tapping `Type answer`
opens the phone handoff. `Speak answer` appears when transcription is
configured and may lead the list when there are no choices; `Suggested answers`
follows it. The list is the only capture.

### 4.4 Long question, many choices

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · oktoso                                           │ 32
├──────────────────────────────────────────────────────────────┤
│ Q  The migration will drop legacy_users. Which backup do     │ 56
│    you want first?                                           │
├──────────────────────────────────────────────────────────────┤
│ ▸ Snapshot now, then migrate                                 │ 156
│   Migrate without a snapshot                                 │
│   Cancel and open the plan                                   │
│   Ask for a dry run                                          │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Swipe choose · Tap send · Back ×2                            │ 42
└──────────────────────────────────────────────────────────────┘
```

Rows 5–6 (for example `Restore from backup`, `Skip legacy users`) are below the
fold, followed by the free-text, voice, suggested, and read rows. More than six
choices: show the first six, then the same action rows; the phone shows all.
There is no paging; one list scrolls. The header never shows `1/2`.

### 4.4.1 No free text

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · oktoso                                           │ 32
├──────────────────────────────────────────────────────────────┤
│ Q  Which region should receive the release?                  │ 56
│    Strict choice; no free text.                              │
├──────────────────────────────────────────────────────────────┤
│ ▸ ap-southeast-1                                              │ 156
│   eu-west-1                                                  │
│   us-east-1                                                  │
│   Read chat                                                  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Swipe choose · Tap send · Back ×2                            │ 42
└──────────────────────────────────────────────────────────────┘
```

No `Type answer` row. `Read chat` stays on the same list; voice and suggested
answers follow it when configured.

### 4.5 No question: existing reply menu

```text
┌──────────────────────────────────────────────────────────────┐
│ REPLY 1/2                                                    │ 32
├──────────────────────────────────────────────────────────────┤
│ ▸ Continue                                                   │ 212 list
│   Show alternatives                                          │
│   Explain risk                                               │
│   More choices →                                             │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap choose   Back ×2                                         │ 42
└──────────────────────────────────────────────────────────────┘
```

No summary container. This screen pages three options at a time (`Stop`,
`Find choices`, and `Phone keyboard` are on page 2). `Find choices` remains the
manual escape hatch when detection misses.

When the hub's reply model is configured, the reply menu puts the grounded model
roles first: an **answer**, an **opposite** labelled `Alt: …`, a **next** step
labelled `Next: …`, a **verify** check labelled `Check: …`, an **extend**
follow-up labelled `More: …`, and an **ask** labelled `Ask: …`. The canned
actions follow, starting with `Continue`. The hub still classifies the moment,
but it calls the model for `reply`, `wait`, and `done`; a running or finished
turn is still a conversation. A page containing a model suggestion is headed
`REPLY 1/3 · Suggested`. Model suggestions never replace `Continue`, `Stop`,
`Find choices`, or `Phone keyboard`; when generation fails or the session has
no transcript, the canned list is shown alone.

The same rule applies to `CHOOSE`: choices parsed from the assistant text keep
the header `CHOOSE n`, while a page containing model-extracted choices reads
`CHOOSE n · Suggested`. Model extraction never invents an option; wording that
does not appear in the assistant text is dropped.

### 4.6 Sending, sent, error, stale

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · oktoso                                           │ 32
├──────────────────────────────────────────────────────────────┤
│ Sending…                                                     │ 56
│ “Yes, squash them”                                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │ 156 text body
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Sending…                                                     │ 42
└──────────────────────────────────────────────────────────────┘
```

The `sending` body is the single capture but ignores input; the footer is a hint.

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · oktoso                                           │ 32
├──────────────────────────────────────────────────────────────┤
│ Sent                                                         │ 56
│ “Yes, squash them”                                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │ 156 text body
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap to return · Back ×2                                      │ 42
└──────────────────────────────────────────────────────────────┘
```

Tapping the `sent` body returns to chat; it also auto-returns after 1.2 s.

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · oktoso                                           │ 32
├──────────────────────────────────────────────────────────────┤
│ Couldn’t send. Agent is offline.                             │ 56
│ “Yes, squash them”                                           │
├──────────────────────────────────────────────────────────────┤
│ ▸ Retry                                                      │ 156 list
│   Choose again                                               │
│   Read chat                                                  │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap choose · Back ×2                                         │ 42
└──────────────────────────────────────────────────────────────┘
```

`error` is a list, not a pair of footer buttons. The summary keeps the reason and
the exact answer. Back returns to `ANSWER` (or chat via `Read chat`).

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · changed                                             │ 32
├──────────────────────────────────────────────────────────────┤
│ Question changed.                                            │ 56
│ Review before answering.                                     │
├──────────────────────────────────────────────────────────────┤
│ ▸ Review                                                     │ 156 list
│   Read chat                                                  │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap choose · Back ×2                                         │ 42
└──────────────────────────────────────────────────────────────┘
```

`stale` replaces the answer list with `Review` / `Read chat`; the old choices are
not selectable. Back goes to chat.

### 4.7 Suggested answers

```text
┌──────────────────────────────────────────────────────────────┐
│ SUGGESTED · oktoso                                        │ 32
├──────────────────────────────────────────────────────────────┤
│ Q  Should I squash the three fix commits into one?           │ 56
├──────────────────────────────────────────────────────────────┤
│ ▸ Yes, squash them                                           │ 156
│   Keep the three commits                                     │
│   Squash, then rerun the tests                               │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap send · Back ×2                                           │ 42
└──────────────────────────────────────────────────────────────┘
```

The hub's reply model returns 2–3 candidates of at most 46 characters. They are
suggestions only: tapping one sends it as ordinary free text, no `answer`
metadata, and returns to chat. Back returns to `ANSWER`. The row is hidden when
the reply model is disabled or missing a base URL/model.

### 4.8 Confirm

```text
┌──────────────────────────────────────────────────────────────┐
│ CONFIRM · oktoso                                          │ 32
├──────────────────────────────────────────────────────────────┤
│ Send this answer? This cannot be undone.                      │ 56
│ “Delete the branch”                                          │
├──────────────────────────────────────────────────────────────┤
│ ▸ Send                                                       │ 156
│   Cancel                                                     │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap choose · Back ×2                                         │ 42
└──────────────────────────────────────────────────────────────┘
```

### 4.9 Type on phone

```text
┌──────────────────────────────────────────────────────────────┐
│ TYPE · oktoso                                             │ 32
├──────────────────────────────────────────────────────────────┤
│ Q  Which branch should I target for the release?             │ 56
│    Use the phone keyboard.                                   │
├──────────────────────────────────────────────────────────────┤
│ Type on the phone.                                           │ 156 text body
│ The answer sends from there.                                 │
│ Tap here to focus the phone again.                           │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap to focus phone · Back ×2                                 │ 42
└──────────────────────────────────────────────────────────────┘
```

The `type` body is the single capture. Tapping it retries the phone handoff; back
returns to `ANSWER` and keeps the composer text.

### 4.9.1 Batch question and review

```text
┌──────────────────────────────────────────────────────────────┐
│ ANSWER · Q1/2                                             │ 32
├──────────────────────────────────────────────────────────────┤
│ Which branch should I target for the release?                │ 56
│ The migration will drop legacy_users.                        │
├──────────────────────────────────────────────────────────────┤
│ ▸ release/2.4                                                │ 156
│   main                                                       │
│   Type answer                                                │
│   Speak answer                                               │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap choose · Back ×2                                         │ 42
└──────────────────────────────────────────────────────────────┘
```

`Answer on phone` and `Back` follow below the fold. Tapping a choice stores it
and opens `ANSWER · Q2/2`; `Back` steps to the previous question, or to `ANSWER`
at Q1. `Answer on phone` opens the whole-batch phone form without losing the
entries already chosen. `Suggested answers` asks the hub for candidates for this
question (`questionId`), and its header names the step (`SUGGESTED · Q2/2`).
Type, voice, and a suggested candidate save into the current question and
advance; none of them sends until `Send all`.

```text
┌──────────────────────────────────────────────────────────────┐
│ REVIEW · 2 answers                                        │ 32
├──────────────────────────────────────────────────────────────┤
│ ▸ 1 release/2.4                                              │ 156
│   2 No, do not force push                                    │
│   Send all                                                   │
│   Back                                                       │
│                                                              │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│ Tap edit · Send all                                          │ 42
└──────────────────────────────────────────────────────────────┘
```

A numbered review row jumps back to that question to edit it. `Send all` first
checks that every question has an answer; an incomplete batch shows
`Answer question N first.` in the footer and stays on review. The send composes
one numbered message and the per-question `answers` metadata, exactly like the
phone form.

### 4.10 Phone companion question card

```text
┌────────────────────────────────────────────┐
│ Oktoso for Even G2                      │
│ ┌────────────────────────────────────────┐ │
│ │ QUESTION                    oktoso  │ │
│ │ Should I squash the three fix commits  │ │
│ │ into one?                              │ │
│ │ Branch: fix/auth-race                  │ │
│ │                                        │ │
│ │ [ Yes, squash them                  ]  │ │
│ │ [ No, keep them separate            ]  │ │
│ │ [ Type a different answer…          ]  │ │
│ │                              [ Hide ]  │ │
│ └────────────────────────────────────────┘ │
│ Phone keyboard                             │
│ ┌────────────────────────────────────────┐ │
│ │ Answer: Should I squash…               │ │
│ │                                        │ │
│ └────────────────────────────────────────┘ │
│ [ Send answer ]  [ Cancel answer ]         │
└────────────────────────────────────────────┘
```

The card is directly above the composer. It never has its own textarea; tapping
`Type a different answer…` puts the existing composer into answer mode. The card
does not auto-focus on page load. `Hide` collapses it to one line
`Question · Show`. Choice buttons wrap; the full answer text is the button
label, not the 52-character glass label.

### 4.11 Container map

| Container | ID | x, y | w × h | Capture | Content |
|---|---:|---|---:|---:|---|
| header | 1 | 0, 0 | 576 × 32 | 0 | `ANSWER · <session>` |
| summary | 2 | 0, 32 | 576 × 56 | 0 | question + context / status |
| list | 3 | 0, 88 | 576 × 156 | **1** | choices + action rows |
| footer | 4 | 0, 246 | 576 × 42 | **0** | hint only |

`answer`, `batch`, `batch-review`, `more`, `confirm`, `error`, and `stale` use
this four-container layout with the list as the only capture. `sending`, `sent`,
and `type` replace the list with a text body at the same position (container 3,
capture 1); `sending` ignores input, `sent` returns to chat, and `type` retries
the phone handoff. `batch-review` uses the same layout with no summary body, so
the numbered answers and `Send all` get the full list height. Total containers
never exceed four.

Do not add a second footer text container with capture enabled. The spike showed
that any page with two captures returns `false`, and a tap on the only text
capture has no container ID. The footer is a hint only. A five-container visual
with a second non-capturing footer hint is possible but adds nothing; keep four.

---

## 5. Input mapping

### 5.1 Grammar

| Input | Chat | Answer list | `suggested` / `confirm` / `error` / `stale` list | Sending | Sent | Type |
|---|---|---|---|---|---|---|
| Tap / R1 tap | Open `answer` if pending, else `reply` when the gate allows a decision, else `session` actions | Activate the selected row: choice sends, action acts | Activate the selected row | Ignored | Return to chat | Retry phone focus |
| Double tap / left temple / R1 double | Back to origin | Back to chat | Back to answer or chat per §5.5 | Ignored | Back to chat | Back to `answer` |
| Scroll / swipe up | Previous chat line(s) | Previous row | Previous row | Ignored | Ignored | Ignored |
| Scroll / swipe down | Next chat line(s) | Next row | Next row | Ignored | Ignored | Ignored |
| Ring tap | Same as tap | Same as tap | Same as tap | Ignored | Same as tap | Same as tap |
| Ring scroll | Same as scroll | Same as scroll | Same as scroll | Ignored | Ignored | Ignored |
| Footer tap | No event | No event; footer is a hint | No event | No event | No event | No event |

No long-press event is required anywhere. The SDK declaration contains
`LONG_PRESS_EVENT`, but the current app contract (`glass-ux.md`,
`wearables.md`) says long-press is not reliable; this design does not use it.
The OS contextual menu (`menuObject`) is also not used in v1; its invocation
gesture is undocumented. Both are candidates for later hardware validation.

The footer is `isEventCapture: 0`. Do not attach actions to it and do not expect
a click when the user taps it.

### 5.2 Primary and secondary

- `answer`: the selected choice is primary. `Type answer`, `Speak answer`,
  `Suggested answers`, `Read chat`, and `Stop agent` are secondary action rows;
  they may require one scroll. The list is the only place to act. For a batch,
  `Answer N questions` is primary and the phone row is the fallback.
- `batch`: the selected choice is primary; `Type answer`, `Speak answer`,
  `Answer on phone`, and `Back` are secondary. The question itself is the
  decision, so only one question is on the screen at a time.
- `batch-review`: `Send all` is primary; a numbered answer row edits one entry,
  and `Back` returns to the last question.
- `confirm`: `Send` is row 1 and primary; `Cancel` is row 2 and secondary. The
  confirmation screen itself is the safety gate; the choice that opened it was
  already deliberate.
- `suggested`: every row is an equally weighted send; Back is the safe exit.
- `type`: the phone composer is primary. The glass body is a retry target for the
  handoff, not a second input.
- `phone`: `Send answer` is primary only when the composer has text; otherwise
  the choice buttons are the primary path. Never two accent-filled primaries.

### 5.3 Avoiding accidental sends

1. **Opening the answer screen is not a send.** A stray tap only changes screens.
2. **Scrolling never sends.** Selection changes; activation requires a tap.
3. **One row is selected and bordered.** The list uses the existing
   tap-to-activate grammar. Action rows are labelled (`Type answer`,
   `Speak answer`, `Suggested answers`, `Read chat`, `Stop agent`), not
   icon-only. If hardware testing shows first-time confusion, add a row count or
   a scroll cue to the footer hint when the list overflows, not a new action.
4. **Footer taps do nothing.** The footer is a hint. Do not move actions there;
   the spike showed only one capture is allowed and a text tap has no container
   identity.
5. **Destructive choices require `CONFIRM`.** Destructive verbs and affirmative
   answers to destructive questions are flagged by the hub; the list tap opens
   the confirm, not the send. Sensitive-data questions add a warning but do not
   block.
6. **Input locks during `sending`.** The text body captures but ignores taps; a
   double tap cannot fire twice.
7. **Back does not cancel a send that already reached the hub.** It is ignored
   during `sending`; after `202`, the answer is sent.
8. **No send on focus/blur.** Phone focus only opens the keyboard.
9. **No auto-send from voice or suggestions.** Both require an explicit `Send`.

### 5.4 Ring and temple

The ring and temple sources are treated as the same logical `tap`, `double tap`,
and `scroll` events. The app does not add ring-only gestures. A ring tap on a
list must produce the same `list-click` with the current index; validate this on
hardware. If ring input only produces sys events, the ring can still move the
selection if the OS maps it to list scroll, but activation may require a temple
tap. Document this limitation in the hardware checklist rather than designing
around an unverified behavior.

### 5.5 Back contract

- `answer` → `chat` at the exact `chatOffset` and `chatNewBelow` state.
- `more` → `answer`; `reply` from `more` → `more`; `choices` from `more` →
  `more`.
- `type` → `answer`; the phone composer keeps its text.
- `confirm` → `answer`; the question is preserved, selection resets to row 1.
- `sending` → ignored.
- `sent` → `chat`.
- `error` → `answer`; `stale` → `chat` (the old choices are no longer valid).
- `chat` → `returnScreen` (inbox, recent, sessions, or home), as today.

---

## 6. Content rules

### 6.1 Question extraction

Only the **latest completed assistant message** is eligible.

```text
1. Take the latest message. If it is not assistant, return null.
2. If streaming is true or completedAt is missing while the session is active,
   return `data: null`; the chat footer already shows `Working`.
3. Join only text parts. Strip Markdown, links, inline code, and fenced code
   blocks **for the question summary**. Keep a copy of the stripped code text
   for risk detection (for example `rm -rf`), but never use code content as the
   question or a choice. Keep paragraph breaks. Skip blockquotes and tables.
4. Work on the last non-empty paragraph. Split into sentences on . ! ? followed
   by whitespace or end.
5. Find the last sentence ending in "?". If none, return null.
6. Reject if the question is inside a quote, a code block, or a task list.
7. Reject closing courtesies: "Anything else?", "Does that make sense?",
   "Any questions?", "All good?".
8. Reject if more than two substantive sentences follow the question. A short
   closer ("Let me know.", "Thanks.") is allowed.
9. Question = that sentence, trimmed of surrounding quotes/brackets.
   Context = the preceding sentence, max 90 characters, only if it adds a
   condition, rationale, or destructive verb.
10. Detect choices (§6.2), yes/no (§6.3), or free-form.
```

Do not ask the model on the hot path in v1. The parser is deterministic and
unit-tested. Model extraction is an optional upgrade for medium/low confidence
(§6.10).

### 6.2 Choice extraction

A list becomes tappable choices only when **all** of these hold:

- 2–6 items;
- same message, adjacent to the question (within two lines, allowing one blank
  line), or in the immediately preceding paragraph when the question is a choice
  cue (`which`, `choose`, `pick`, `option`, `prefer`, `or`);
- each item is 2–80 characters after stripping numbering/bullets/Markdown;
- not a task list (`- [ ]`, `- [x]`, `TODO`);
- not a plan: items are full sentences (> 8 words) and the question is binary
  (`Should I proceed?`, `Shall I continue?`), or the items are a sequence of
  imperatives (`Read…`, `Fix…`, `Run…`) next to a binary question, or the lead-in
  says `plan`, `steps`, `next`, `todo`;
- not a table or code block.

Supported markers: `1.`, `1)`, `A.`, `A)`, `-`, `*`, `•`. Strip the marker and
trailing punctuation. Preserve the agent's wording; do not summarize with a
model in v1. Deduplicate identical text; keep the first.

Inline alternatives are allowed only when the question contains `or`/`either`
and splits into 2–4 parts of 2–40 characters each:

> `Should I deploy to staging or production?` → `staging`, `production`.

If the split produces clauses rather than nouns, fall back to free-form.

### 6.3 Yes/no

Synthesize `Yes` / `No` only when no explicit list exists and the question is a
clean binary:

- starts with `Should`, `Shall`, `Do`, `Does`, `Did`, `Can`, `Could`, `Would`,
  `Will`, `Is`, `Are`, `Was`, `Were`, `Has`, `Have`, `May`, `Am`;
- or starts with `Is it okay`, `Is it safe`, `Do you want me to`.

Do **not** synthesize for information requests:

- `Do you know …?`
- `Can you confirm …?`
- `Can you share/provide/send …?`
- `Do you have …?`
- `Are you able …?`

Those are free-form. `Why`, `How`, `What`, `Where`, `When`, `Who` are free-form.
The answer text is exactly `Yes` or `No`; do not embellish.

### 6.4 Free-form

`kind: "freeform"`, no choices, `allowsFreeText: true`. The glass list is
`Speak answer` (when transcription is configured and there are no choices),
`Type answer`, `Suggested answers` (when the reply model is configured),
`Read chat`, `Stop agent`. The phone card shows the full question and focuses
the composer. A provider sentinel choice (`Other`, `Something else`, `Custom`,
`Type your own…`) is not a choice; it becomes `Type your own answer` and the
sentinel text is never sent. There is no separate `More` list; free text,
suggestions, and Stop are first-class rows.

### 6.5 Multiple questions

The API returns `questions[]`, not a single object. If more than one question is
detected in the latest message:

- Glass entry: `ANSWER · N questions`; summary shows `Q1`; list is
  `Answer N questions`, `Answer N questions on phone`, with `Failure ›` when the
  chat has a recoverable failure.
- Glass batch: `ANSWER · Q1/N` shows one question with its numbered choices,
  `Type answer` (when free text or a sentinel applies), `Speak answer` (when
  configured), `Suggested answers` (when configured), `Answer on phone`, and
  `Back`. Choosing, typing, speaking, or picking a suggested candidate stores
  that question's entry and advances. The last answer opens
  `REVIEW · N answers`.
- Review: one numbered row per answer (tap to edit), `Send all`, and `Back`. A
  missing entry blocks the send with `Answer question N first.`; the hub rejects
  a partial batch with `question_incomplete` as a second guard.
- Phone: the fallback card shows every question, each with its choices or a text
  field; one `Send answers` composes the same numbered message. Entries chosen on
  the glass are preserved.
- The phone row remains on every batch question, so the user is never trapped on
  the glass.
- The composed message and batch metadata include every question ID; this is the
  same wire shape for both surfaces.

### 6.6 Truncation and formatting

- Question: two lines × 52 characters. If truncated, append `…`. The full text
  is in chat and on the phone.
- Context: one line × 52 characters, only if the question fits one line.
- Choice label: 52 characters, truncate at a word boundary, append `…`. The
  `text` sent is always the full choice text.
- Phone: no truncation; buttons wrap, max three lines; full text in
  `aria-label`.
- Preserve the agent's capitalization and punctuation in `text`. The label may
  drop a trailing period for visual calm; the sent text keeps it.
- Use `…`, `·`, `×`, `→` only if the G2 font renders them; all are already used
  in the app. Test `←`.
- Avoid Markdown, code fences, URLs, and tool names in the summary. The question
  sentence should already be plain text.

### 6.7 Ranking

- Preserve the agent's order. Do not re-rank by model likelihood or safety; the
  order may encode the agent's recommendation.
- Explicit choices come before model suggestions. Never merge them in v1.
- If more than six choices, show the first six; the phone shows all. The normal
  action rows follow the sixth choice; there is no `More on phone…` row.
- Do not move a destructive choice to the top or bottom. Keep order and rely on
  `CONFIRM`.

### 6.8 What not to show

- A question from a user message, tool part, reasoning part, or system message.
- A question inside a code fence, blockquote, table, or task list.
- A plan step list as choices.
- A question while the assistant message is streaming.
- A question when a newer user message exists.
- A question when a provider-native question attention item exists for the
  session; route to the attention form instead (`Answer in Inbox`).
- A closing courtesy question.
- Guessed choices with low confidence; show free text.
- Any answer option that was not in the agent's text or explicitly synthesized
  yes/no. No model-invented choices in v1.

### 6.9 Confidence

| Confidence | Conditions | Behavior |
|---|---|---|
| `high` | Explicit adjacent list; clean yes/no; no plan/task ambiguity. | Show choices. |
| `medium` | Inline alternatives; list before question; model-extracted after a deterministic miss. | Show choices; summary adds `Suggested`; `Type answer` remains first-class. |
| `low` | Question found but no reliable options, or irregular structure. | Free-form only. |

Question detection confidence is separate. If the question itself is low
confidence (quoted, courtesy, more than two substantive sentences after it), do
not show a prompt at all.

### 6.10 Model assistance (later)

When enabled and the deterministic result is `medium`/`low`, the hub may call the
configured reply model with a strict JSON schema:

```json
{
  "question": "string",
  "kind": "choice|boolean|freeform",
  "choices": [{ "label": "string", "text": "string" }],
  "confidence": "high|medium|low"
}
```

Rules:

- 2-second timeout; fall back to deterministic free-form.
- Label the result `Suggested`; never present it as the agent's exact words.
- Cache by message ID + text hash.
- Never let the model invent a destructive action; if it does, `CONFIRM`.
- The answer screen works with the model disabled.

---

## 7. Answer model

### 7.1 Types

```ts
export type QuestionKind = "choice" | "boolean" | "freeform";

export type AnswerSource =
  | "choice"
  | "boolean"
  | "text"
  | "voice"
  | "suggestion";

export interface AnswerChoice {
  id: string;
  label: string;                 // glass label, <= 52 chars
  text: string;                  // exact text sent; never truncated
  kind: "choice" | "boolean" | "suggestion";
  source: "explicit" | "heuristic" | "model";
  requiresConfirmation?: boolean;
  destructive?: boolean;
  sensitive?: boolean;
}

export interface PendingQuestion {
  id: string;                    // `${messageId}:${index}`
  text: string;                  // question sentence(s)
  context?: string;              // one preceding sentence
  kind: QuestionKind;
  choices: AnswerChoice[];
  allowsFreeText: boolean;
  allowsVoice: boolean;
  multiSelect: boolean;          // future; false in v1
  risk: "normal" | "destructive" | "sensitive";
  confidence: "high" | "medium" | "low";
  source: "explicit" | "heuristic" | "model";
}

export interface QuestionPrompt {
  sessionRef: string;
  messageId: string;
  revision: string;              // opaque; message id + completed text hash
  askedAt: number;
  questions: PendingQuestion[];  // 1..n
  attentionID?: string;          // provider-native question wins
  generatedAt: number;
}

export interface AnswerDraft {
  questionId: string;
  messageId: string;
  revision: string;
  choiceId?: string;
  text: string;
  source: AnswerSource;
}

// A batch is answered one question at a time on the glass and sent together:
// each draft repeats the shared message ID and revision so the hub can validate
// the whole batch. The phone form builds the same shape.
export interface AnswerBatch {
  answers: AnswerDraft[];
}

// One rendered list row. The list is the only capture; a tap is routed by kind.
export type AnswerRow =
  | { kind: "choice"; choice: AnswerChoice }
  | {
      kind: "action";
      action:
        | "type"
        | "voice"
        | "suggested"
        | "failure"
        | "batch"
        | "phone"
        | "read"
        | "stop"
        | "attention"
        | "send"
        | "back";
      label: string;
    }
  | { kind: "answer"; questionIndex: number; label: string };
```

`QuestionPrompt` is the only render input. `AnswerDraft` is the only send input.
The renderer derives everything else:

```ts
function rowsFor(
  prompt: QuestionPrompt,
  options: { voice?: boolean; suggested?: boolean; failure?: boolean } = {},
): AnswerRow[] {
  const primary = prompt.questions[0]!;
  if (prompt.attentionID) {
    return [
      { kind: "action", action: "attention", label: "Answer in Inbox" },
      ...(options.failure
        ? [{ kind: "action", action: "failure", label: "Failure ›" } as const]
        : []),
      { kind: "action", action: "read", label: "Read chat" },
      { kind: "action", action: "stop", label: "Stop agent" },
    ];
  }
  if (prompt.questions.length > 1) {
    return [
      { kind: "action", action: "batch", label: "Answer N questions" },
      { kind: "action", action: "phone", label: "Answer N questions on phone" },
      ...(options.failure
        ? [{ kind: "action", action: "failure", label: "Failure ›" } as const]
        : []),
    ];
  }

  const sentinel = primary.choices.some((choice) =>
    /^(other|type your own|something else|custom)\b/i.test(choice.label),
  );
  const choices: AnswerRow[] = primary.choices
    .filter((choice) => !isFreeAnswerSentinel(choice))
    .slice(0, 6)
    .map((choice) => ({ kind: "choice", choice }));

  const freeRow: AnswerRow | undefined = sentinel
    ? { kind: "action", action: "type", label: "Type your own answer" }
    : primary.allowsFreeText
      ? { kind: "action", action: "type", label: "Type answer" }
      : undefined;
  const voiceRow: AnswerRow | undefined = options.voice
    ? { kind: "action", action: "voice", label: "Speak answer" }
    : undefined;

  const rows: AnswerRow[] = [...choices];
  if (choices.length === 0) {
    if (voiceRow) rows.push(voiceRow);
    if (freeRow) rows.push(freeRow);
  } else {
    if (freeRow) rows.push(freeRow);
    if (voiceRow) rows.push(voiceRow);
  }
  if (options.suggested) {
    rows.push({ kind: "action", action: "suggested", label: "Suggested answers" });
  }
  if (options.failure) {
    rows.push({ kind: "action", action: "failure", label: "Failure ›" });
  }
  rows.push({ kind: "action", action: "read", label: "Read chat" });
  rows.push({ kind: "action", action: "stop", label: "Stop agent" });
  return rows;
}

const rows = rowsFor(prompt, { voice, suggested, failure });
const hint = rows.some((row) => row.kind === "choice")
  ? "Swipe choose · Tap send · Back ×2"
  : "Tap choose · Back ×2";
```

No `if (kind === "yesno")` screen. Yes/no is two synthesized choices followed by
the same action rows. Free-form is a list with zero choices. Multiple is a batch
of one list screen per question plus a review screen; the phone form is the
fallback. `Sent`/`Type` are text bodies with one capture; `Sending` captures but
ignores input.

### 7.2 Composition table

| Modality | Source | Draft | Glass | Phone |
|---|---|---|---|---|
| Choice | `choices[]` | `{ choiceId, text }` | List row; tap sends | Choice button |
| Yes/no | synthesized choices | `{ choiceId: "yes", text: "Yes" }` | Two list rows | Two buttons |
| Free text | `allowsFreeText` | `{ text: composer }` | `Type answer` list row → `type` | Composer answer mode |
| Sentinel | choice label `Other` etc. | `{ text: composer }` | `Type your own answer` row → `type` | Composer answer mode |
| Voice | configured transcription | `{ text: transcript }` | `Speak answer` → voice → Send | Transcript into the composer |
| Suggestion | reply model (`mode=answer`) | `{ text: candidate }` | `Suggested answers` → candidate | Chips above composer |
| Multiple | `questions.length > 1` | `AnswerBatch` | `batch` per question → `batch-review` → `Send all`; `Answer N questions on phone` fallback | Form of all questions |

Voice and suggestions are additive: both send ordinary text, so they reuse the
message and error paths rather than adding a second wire shape. A voice
transcript answers the open question only in the conversational sense; it carries
no `answer` metadata.

### 7.3 Hub API

Add a read endpoint separate from reply generation:

```http
GET /api/v1/sessions/:ref/question
```

```json
{
  "data": {
    "sessionRef": "desktop-opencode:ses_123",
    "messageId": "msg_42",
    "revision": "msg_42:8f3c1a",
    "askedAt": 1793000000000,
    "generatedAt": 1793000001000,
    "questions": [
      {
        "id": "msg_42:1",
        "text": "Should I squash the three fix commits into one?",
        "context": "Branch: fix/auth-race",
        "kind": "boolean",
        "choices": [
          {
            "id": "yes",
            "label": "Yes",
            "text": "Yes",
            "kind": "boolean",
            "source": "explicit"
          },
          {
            "id": "no",
            "label": "No",
            "text": "No",
            "kind": "boolean",
            "source": "explicit"
          }
        ],
        "allowsFreeText": true,
        "allowsVoice": false,
        "multiSelect": false,
        "risk": "normal",
        "confidence": "high",
        "source": "explicit"
      }
    ]
  }
}
```

`data` is `null` when there is no pending question. A running provider `question`
tool part is mapped to the same chat prompt as a text question, so the glass can
show `? Answer` and answer from chat. The Inbox form remains available for the
same provider request. Provider **form** questions keep `attentionID`; the glass
list then becomes `Answer in Inbox`, `Read chat`, and the footer hint is
`Tap choose · Back ×2`. `Answer in Inbox` opens the attention detail by ID, not
just the inbox list.

**Do not put this on `reply-options`.** Reply options are a generation endpoint;
the chat read path must not depend on the reply model, and generating a handful
of suggestions just to learn whether a question exists wastes latency and
tokens.
If a single request is later required, mirror the object on `reply-options`, but
the glass still reads `/question`.

The service:

- fetches the last 6 messages (`order=desc`);
- prefers a running `question` tool part, even while the message is streaming;
- otherwise requires the latest message to be assistant, completed, and
  text-bearing;
- caches text questions by `ref:messageId:textHash` for 30 s and tool questions
  by `ref:tool:messageId:revision`;
- caches discovery summaries for 15 s and reports provider failures separately;
- exposes a pure `parseQuestion(messages)` for unit tests;
- returns `null` for no question, a streaming text-only message, or a user
  message after the assistant;
- returns every question in the latest text message, not just the first.

Consider a short-lived shared message snapshot cache in `SessionService` so the
glass's parallel `messages` and `question` fetches do not hit the provider twice.
Not required for v1; target is under 800 ms total on LAN.

### 7.4 Send contract and idempotency

```http
POST /api/v1/sessions/:ref/messages
Idempotency-Key: 3f0c...
Content-Type: application/json

{
  "text": "Yes",
  "answer": {
    "questionId": "msg_42:1",
    "messageId": "msg_42",
    "revision": "msg_42:8f3c1a",
    "choiceId": "yes",
    "source": "boolean"
  }
}
```

For multiple questions, both the phone form and the glass review send one batch:

```json
{
  "text": "1. release/2.4\n2. No, do not force push",
  "answers": [
    {
      "questionId": "msg_42:1",
      "messageId": "msg_42",
      "revision": "msg_42:8f3c1a",
      "text": "release/2.4",
      "source": "text"
    },
    {
      "questionId": "msg_42:2",
      "messageId": "msg_42",
      "revision": "msg_42:8f3c1a",
      "choiceId": "no",
      "text": "No",
      "source": "boolean"
    }
  ]
}
```

`answer` and `answers` are mutually exclusive. The composed `text` is what the
provider receives; the metadata is for validation and audit.

Hub behavior:

1. If `answer`/`answers` is absent, send as a normal message (existing path).
2. If present, load the current prompt. Compare `messageId` + `revision`.
3. Mismatch → `409` with `code: "conflict"`,
   `details.reason: "question_changed"`, and the current prompt.
4. Already answered → `409` with `reason: "question_resolved"`.
5. A batch that omits a pending question → `409` with
   `reason: "question_incomplete"`.
6. Valid → send `text` through the provider; return the existing `202`.
   Strip `answer`/`answers` before the provider adapter; they are hub-only.
7. Cache `(sessionRef, Idempotency-Key)` → result for 30 days. The cache also
   stores a hash of the request; a reused key with different content is treated
   as a new send. A retry with the same key and payload returns the same result
   without a second provider send.
8. Optionally annotate the hub's message cache with the answer metadata for
   audit; provider message metadata is not required.

The glass generates one idempotency key per `AnswerDraft`. `Retry` reuses it;
`Choose again` creates a new draft and key.

### 7.5 Voice, suggestions, and autocomplete

**Voice.** `Speak answer` appears when transcription is configured. It is a
normal `AnswerDraft` method: the transcript is sent as ordinary text, not with
answer metadata. States: `LISTENING` (tap to stop), `TRANSCRIBING`, then the
result screen with `Send` / `Edit on phone`. Never auto-send; STT errors and
ambient speech are too likely. On the answer screen voice follows the choices;
it may lead only when there are no choices. Back and Cancel return to the screen
that opened the microphone. On a batch question the result offers `Send` /
`Back`; `Send` stores the transcript as that question's entry and advances
instead of sending a reply.

**Suggestions.** `Suggested answers` calls `reply-options` with `mode=answer`.
The hub passes the pending question (text + choices) and the last messages to
the configured reply model and returns 2–3 candidates of at most 46 characters.
On a batch question the call adds `questionId=<id>` so the model sees that
question, not Q1; the header names the step (`SUGGESTED · Q2/2`) and a tap
stores the candidate as that question's answer and advances without sending.
On a single question, tapping one sends ordinary free text and returns to
chat; Back returns to `ANSWER` (or to the batch question it came from). The row
is hidden when the reply model is disabled or missing a base URL/model. The
model never replaces the agent's choices.

**Autocomplete.** On the phone, debounce typing and show up to three suggestion
chips above the composer. Tap inserts, never sends. This remains a phone-only
convenience; the glasses use the `Suggested answers` list.

**Model extraction.** Same `AnswerChoice` shape with `source: "model"`; label
`Suggested` in the summary. The deterministic parser remains the baseline.

---

## 8. Phone handoff

### 8.1 When to hand off

Hand off to the phone when:

- the question has no choices (free-form);
- it has more than six choices;
- a batch is easier to fill in one form (the glass always keeps
  `Answer on phone` as the fallback);
- the answer needs more than ~200 characters (the user chooses to type);
- the glasses cannot show the question safely (sensitive data, very long);
- the user explicitly taps the `Type answer` / `Answer on phone` list row
  (possibly after one scroll).

Do not hand off automatically for ordinary choices. The glasses must be
self-sufficient for yes/no and short choice lists.

### 8.2 Card behavior

- The card sits directly above the `Phone keyboard` panel.
- It appears when a question prompt exists for the open session; it does not
  auto-focus or auto-scroll on page load.
- `Type a different answer…` calls `scrollIntoView` + `focus` on the composer and
  sets answer mode. The glasses move to `TYPE`. If the app is backgrounded or the
  phone is locked, focus does not land; after 1.5 s the glasses body changes to
  `Unlock phone to type.` (no new state, just copy).
- Choice buttons send immediately, except `requiresConfirmation` choices, which
  show an inline `Send this answer?` row with `Send` / `Cancel`.
- `Hide` collapses the card to a one-line `Question · Show` bar above the
  composer. The glasses are unaffected.
- After a successful send, the card shows `Sent: “<answer>”` with `Dismiss`.
  It collapses after 5 s or on dismiss. On a question change, it keeps the typed
  text and shows `Review`.
- The card is removed when the question resolves or the session changes.

For multiple questions, the card is a form: each question has its own choice
buttons or text field, selections are local until `Send answers`, and the whole
batch is reviewed before sending. A choice tap in this mode selects, not sends.
The glass review screen shares these entries.

### 8.3 One composer, not two

For a **single question**, the card has no textarea; the existing composer is the
only input. For **multiple questions**, the card becomes a compact form with one
choice set or one text field per question and a single `Send answers` button.
That is a deliberate exception: a batch must be composed and reviewed as a unit,
and the generic composer cannot represent two fields. The glass batch/type flow
uses the same entries and sends the same batch from `REVIEW`; the phone form is
the fallback for the whole batch.

The single-question composer modes are:

| Mode | Heading | Placeholder | Primary button |
|---|---|---|---|
| Normal | `Phone keyboard` | `Type a reply…` | `Send to session` |
| Answer | `Answer question` | `Answer: <question>` | `Send answer` |
| Answer, question changed | `Answer question` | unchanged | `Send answer` disabled; `Review` |

`Cancel answer` clears answer mode but keeps the text, so it can still be sent as
a normal reply. The answer mode is explicit; typing directly in the composer
without pressing `Type a different answer…` is a normal reply. This avoids
attaching `replyTo` to unrelated messages.

### 8.4 Sync rules

- The phone and glasses share the same app state because the G2 app runs in the
  Even Hub webview on the phone. No cross-device sync is required for v1.
- A second paired browser is a separate client. It shares messages, read state,
  and drafts through the hub, but the glasses cannot focus its keyboard. The
  `Type answer` action there shows `Open Oktoso on your phone`.
- When the phone sends, the glasses go to `SENT` if they are anywhere in the
  answer flow. If the glasses are on `CHAT`, the footer question marker clears.
- When the glasses send, the phone card shows `Sent` and keeps the text until
  dismissed.
- Do not mirror keystrokes to the glasses. The glasses show `Typing…` only if a
  status line is needed; no page rebuild per character.
- If the question changes while the user is typing, keep the text, disable
  `Send answer`, and show `Question changed.` + `Review` / `Send as reply`.

### 8.5 Drafts

- The answer draft uses the existing per-session draft API. Saving is debounced.
- After a successful send, clear the draft.
- If the question changes, keep the draft; do not clear it.
- If the session changes, the draft follows the session as today.
- The glasses never show the draft text; only the phone does.

### 8.6 Accessibility

- Card: `section` with `aria-labelledby`; heading `Question from <session>`.
- Question text: full, no truncation; `lang` inherited.
- Choice buttons: `aria-label="Send answer: <full text>"`; 44 px min height;
  text wraps.
- Status: `role="status" aria-live="polite"` for `Sending`, `Sent`, `Question
  changed`, and errors.
- Focus moves to the textarea only on explicit `Type a different answer…`.
- After send, focus returns to the card heading (or the composer if the user is
  continuing).
- Destructive choice: `aria-describedby` points to `This cannot be undone.` Do
  not rely on red.
- The glasses preview panel is marked as a preview/debug surface; the card is
  the accessible equivalent of the glasses answer screen.

---

## 9. Inbox and home integration

### 9.1 Recommendation

**Do not create a new attention item for every chat question in v1.** Attention
is for blocking provider work: permissions, approvals, provider-native forms,
errors, and unread sessions. A conversational question is a normal chat turn; it
does not block the provider, and many agents ask rhetorical or optional
questions. Adding each one would flood the inbox and break the priority order.

Instead:

- The chat footer carries `? Answer` while the question is pending.
- The home `Current` row gets a `?` prefix when the loaded session has a pending
  question: `Current · ? Fix auth race`.
- Opening the session marks it read; the question marker persists until answered.
- The existing `UNREAD` attention row remains the triage entry. The hub exposes
  compact summaries at `GET /api/v1/questions?ref=…` for up to ten sessions. The
  G2 home, recent, and inbox surfaces use it to show the question glyph (`?`)
  and the question text. Summaries are cached briefly and provider failures are
  reported separately so an outage does not clear a marker.

### 9.2 Labels

| Surface | Label |
|---|---|
| Home current row | `Current · ? <session>` |
| Chat footer | `? Answer · L456-461/461 · M30/30` |
| Inbox row (when cheap) | `? <session>` |
| Inbox summary (when cheap) | `<question text>` (clamp 54) |
| Provider-native question | `? <session>` (unchanged) |

Read the two `QUESTION` rows carefully: the provider-native one opens the
attention form, the chat-derived one opens chat at the question. The detail
screen and the `Answer` action distinguish them.

### 9.3 Implemented discovery

`GET /api/v1/questions?ref=…&ref=…` returns `PendingQuestionSummary` rows
(`sessionRef`, `messageId`, `revision`, `askedAt`, `questionCount`, `text`,
optional `context`, optional `attentionID`). It is a batch read, capped at ten
refs, and the hub caches each session summary for 15 seconds. The response also
returns `failed: string[]` so the client never treats a provider error as a
resolved question.

A `questions` filter on the session list remains a future addition. Do not create
a new blocking attention type for chat-derived questions.

Sessions with `parentRef` are child sessions. The G2 Recent list requests
`scope=root`, and child unread/error items are suppressed. Child provider-native
permissions and questions remain visible with `parentRef` so the glasses can mark
them as subagent work. This is deliberate for OpenCode, where a child permission
prompt may not propagate to the parent UI and can stall the parent turn.

---

## 10. Failure and edge cases

| Case | Behavior | Copy / state |
|---|---|---|
| No question | Chat tap opens `reply` for a decision, otherwise `session` actions (`Stop` when running, `Phone keyboard`). | `SESSION` |
| Question is streaming | No prompt; footer keeps `Working`. | `Working` |
| Multiple questions | Glass batch one question at a time, then `REVIEW` → `Send all`; the phone form is the fallback. | `ANSWER · Q1/2` → `REVIEW · 2 answers` |
| Question changed while answering | Freeze list; `stale`; no silent swap. | `Question changed. Review before answering.` |
| Answer sent elsewhere | `stale`; no retry. | `Answered already.` |
| Send fails (hub) | Keep answer; `Retry` / `Choose again`. | `Couldn’t send. <reason>` |
| Hub offline | Keep answer; no silent queue. | `Offline. Check the hub connection.` |
| Auth expired | Keep answer; phone reconnect. | `Session expired. Reconnect in phone.` |
| Provider offline | Keep answer; retry. | `Agent is offline. Try again.` |
| Timeout | Retry with same idempotency key. | `Send timed out.` |
| Duplicate retry | Hub dedupes by key. | `Sent` (same result) |
| Provider send after 202 fails | Chat shows error attention; glass does not claim failure. | Existing error item |
| Long question | Two-line summary; full text in chat/phone. | `…` |
| Long choice label | 52-char label; full text sent. | `…` |
| More than six choices | First six; the phone shows all. | Normal action rows follow |
| Long free text | Phone only; max length validated on phone. | `Too long (N/4000)` |
| Question with no options | Free-form list. | `Speak answer` / `Type answer` / `Suggested answers` / `Read chat` |
| Plan/task list next to a binary question | Not choices; yes/no synthesized. | `Yes` / `No` |
| Quoted/courtesy question | No prompt. | Chat only |
| Open `Why`/`How` question | Free-form, not yes/no. | `Speak answer` / `Type answer` / `Suggested answers` |
| Question in code block | No prompt. | Chat only |
| Provider-native question exists | Attention form wins. | `Answer in Inbox` |
| Session deleted / 404 | Back to inbox; short error. | `Session not found.` |
| App restart | Question refetched; glasses have no draft; phone draft persists. | Normal |
| User opens chat only to read | Chat opens at question; tap opens answer; back returns to line. | No send |
| Accidental tap on a normal choice | Sends. This is the accepted risk; destructive choices confirm. | — |
| Ring cannot activate list | Temple tap activates; note in hardware checklist. | — |
| Question asks for a secret | `risk: sensitive`; warning; still user-controlled. | `This may ask for sensitive information.` |
| Two clients answer at once | First 202 wins; second gets 409 resolved. | `Answered already.` |

### 10.1 Error copy rules

- Name the failing layer: hub, session/auth, provider, or question.
- Always give the next action: `Retry`, `Pair this phone`, `Review`, `Read chat`.
- Do not show HTTP status codes or stack traces on the glass.
- Keep the user's answer visible on every error screen.
- Back always works on `failure`, `error`, and `stale`.
- The failure screen copy is centralized in the G2 failure classifier:
  `SESSION EXPIRED`, `HUB OFFLINE`, `AGENT OFFLINE`, `PROVIDER SIGN-IN`,
  `TIMEOUT`, `HUB BUSY`, `NOT FOUND`, `CHANGED`, `HUB ERROR`, and a generic
  `ERROR` fallback.
- Background list failures stay inline as `Retry · <state>`; auth failures always
  open the pairing action.

### 10.2 Idempotency and duplicate sends

The hub cannot rely on providers to dedupe. It persists `Idempotency-Key`
results in its state file for 30 days. Each entry also stores a hash of the
request payload, so a reused key with different text, attachments, or answer
metadata is treated as a new send instead of returning a stale result. Concurrent
retries with the same key wait for the first attempt instead of reaching the
provider twice. If the hub state is lost between the send and the retry, a
duplicate is possible; this is rare and acceptable for chat. The key is scoped
to the session and the draft, not to the text alone; intentionally sending the
same text twice still works when each send uses a fresh key.

Reply options, numbered choices, and phone messages use the same idempotency
layer with their own key. Every send call has a 30-second client timeout, so a
hung request becomes a visible, retryable timeout rather than an indefinite
`Sending…` state.

### 10.3 Read state

Opening a chat marks the session read. The question prompt is independent of
read state: after opening, the transcript is read but the question is still
pending. The `?` marker remains until a user message follows or the question is
otherwise resolved. This avoids the common failure where opening the chat clears
the only reminder that an answer is owed.

---

## 11. Accessibility and safety

### 11.1 Monochrome and selection

- The list selection border is the only focus indicator. The first row is
  selected by default; the border is visible in the existing theme.
- State is conveyed by position, text, and border: `ANSWER`, `CONFIRM`, `Sent`,
  `Question changed`.
- No color is required to understand any glass state.
- All actions are labeled list rows, not icons. `Type answer`, `Speak answer`,
  `Suggested answers`, `Failure ›`, `Read chat`, and `Stop agent` follow the
  choices in a stable order; the footer is a hint and is not tappable.
- The `!` warning is text plus a sentence (`This cannot be undone.`), not a
  color-only signal.

### 11.2 Screen reader

The glasses have no screen reader. The phone companion is the accessible
equivalent of every state:

- the question card exposes the full question, context, and choices;
- `aria-live` announces `Sending`, `Sent`, `Question changed`, and errors;
- buttons include the full answer text in their accessible names;
- focus moves only on explicit user action;
- 44 px targets and 16 px inputs on mobile;
- the glasses preview is a debug surface, not the only content.

A blind user can complete the flow on the phone without the glasses. A low-vision
user can use the glasses for speed and the phone for detail.

### 11.3 Confirmation and destructive actions

- `requiresConfirmation` is set when the question or choice contains a
  destructive verb (`delete`, `remove`, `drop`, `reset`, `overwrite`, `wipe`,
  `truncate`, `force push`, `revoke`, `rotate`, `destroy`) or when an affirmative
  answer to a destructive question would authorize it.
- `risk: sensitive` is set for `password`, `token`, `secret`, `API key`,
  `credential`, `private key`. The screen warns; it does not block.
- The confirm screen repeats the **exact text** that will be sent, not the
  truncated label.
- `Send` is explicit; there is no timer.
- The phone uses the same rule, with an inline confirm row.
- `Stop` in `MORE` is destructive-ish; it uses the existing interrupt action and
  a clear label.

### 11.4 Permission boundary

The answer flow never grants a provider permission, approves a command, or
dismisses an attention item. It only sends a chat message. If the agent asks
"Can I run this command?", a chat answer of `Yes` is a message; the formal
permission request remains in the attention inbox. If a provider-native question
exists for the session, the attention form is the authoritative path and the
glass shows `Answer in Inbox`.

This boundary must be visible in copy: the screen says `ANSWER`, never `APPROVE`.
The attention screen keeps `Allow once` / `Deny`.

### 11.5 Privacy

- The question summary is the same content already shown in chat; the answer
  flow does not fetch new secrets.
- The phone card shows the question on the phone screen; it is only visible when
  the phone is unlocked and the page is open.
- Do not auto-focus the keyboard on page load; a keyboard popping up in public
  is distracting and can reveal the question.
- The draft may autosave to the hub draft store, but it is not a message until
  `Send`. Do not send the draft text as a chat message on focus/blur.
- Do not log answer text on the hub beyond the normal message content.

### 11.6 Timing

- `SENT` stays 1.2 s on the glasses; tap skips it. On the phone, the status stays
  until dismissed or the next action, so a screen reader can finish.
- `SENDING` blocks input only for the hub acceptance window; the hub returns 202
  quickly. If the hub does not respond within 10 s, go to `error` with
  `Send timed out.`
- No answer is ever sent on a timer.

---

## 12. Tradeoffs and recommendation

### 12.1 Models compared

| Model | Taps (yes/no from chat) | Context | Safety | Cost | Verdict |
|---|---:|---|---|---|---|
| **A. Dedicated `ANSWER` screen, opened from chat** | 2 (3 risky); actions may need one scroll | Question summary; transcript one back | Choice + confirm + stale check | Medium | **Choose** |
| B. Bottom-sheet overlay on chat | 2 | 2–4 chat lines | Same, but focus/scroll conflicts | Medium-high | Reject: cramped; two scroll surfaces |
| C. Inline choices at the bottom of chat | 1–2 | Full transcript | High accidental-tap risk; no list in a text container | Low-medium | Reject: breaks the six-line viewport |
| D. Phone-first | 3+ and a device switch | Full | High | Low on glass | Reject as default; keep for free text |
| E. Reply-menu-first | 2–3 | None | Medium | Low | Reject: hides the question; menu noise |
| F. Persistent question card in chat + expand | 2 | Full chat + card | Medium | Medium | Use only as the footer marker; the card consumes transcript |

### 12.2 Why A

- It gives the question the whole screen without hiding the transcript
  permanently.
- It reuses the list grammar and selection border the user already knows.
- It fits the measured one-capture constraint: header, summary, list, footer
  hint; the list owns input and the footer does not pretend to be a button.
- It is the same surface for choices, yes/no, free-form, multiple, voice, and
  suggestions.
- It is the cheapest to make safe: one place to confirm, one place to detect
  stale, one place to retry.

### 12.3 Fallbacks and deliberate omissions

- **One capture only (resolved).** Do not reintroduce split footer actions or
  per-container hit testing. All actions are list rows; the footer is a hint.
  The spike measured that two captures return `false`.
- **List scroll (resolved).** The list scrolls and selects beyond the visible
  four rows; paging is not required. Keep one list with up to six choices plus
  action rows. If a future firmware regresses scrolling, fall back to one
  `More choices` row at a time, but do not build a custom scroll container.
- **If ring input cannot activate a list:** temple tap is the activation path;
  ring remains a scroll source. Document the limitation.
- **No long-press:** even though the SDK declaration lists long-press events,
  the app contract says it is unreliable. No required action is behind it.
- **No contextual menu in v1:** `menuObject` exists, but its invocation gesture
  is undocumented. Revisit if hardware testing shows a reliable entry.
- **No inbox attention type:** see §9. This is deliberate; revisit with usage
  data.
- **No `Send anyway` for stale questions:** safe but occasionally annoying.
  Revisit only if low-risk changes are common and users ask for it.

---

## 13. Implementation slices

### Slice 0 — contracts and parser (hub only)

- Add `AnswerChoice`, `PendingQuestion`, `QuestionPrompt` to
  `packages/contracts`; register in `openapi.ts`. Keep `AnswerRow` in the G2
  client because it is a render concern, not a hub contract.
- Add `QuestionService` with pure `parseQuestion(messages)`.
- Add `GET /api/v1/sessions/:ref/question`.
- Add unit fixtures from §6 and Appendix B.
- No UI changes.

**Acceptance:** fixtures pass; endpoint returns `null` for no question, streaming,
user-latest, quoted/courtesy, and provider-native question; endpoint returns the
expected choices for explicit lists/yes-no; p95 under 800 ms on LAN with a warm
provider.

### Slice 1 — choice answer on glass

- Fetch `/question` on chat open, in parallel with messages.
- Open chat at the question line when pending; footer `? Answer`.
- Add `ANSWER` with **one capturing list** (choices + `Type answer`,
  `Read chat`, `Stop agent`) and a non-interactive footer hint.
- Add `SENDING`/`SENT` text bodies and `ERROR` list; no footer actions.
- Add the phone question card with full question and choice buttons.
- Wire the `Type answer` row to focus the existing composer (free-form works, but
  no dedicated `TYPE` screen yet).
- Add `requiresConfirmation` + `CONFIRM` list for destructive choices.

**Acceptance:** yes/no answers in two taps from chat; three choices + `Type
answer` visible in four rows; `Read chat` reachable by scrolling; send failure
preserves the answer in an error list; back returns to the same chat line; no
page is rebuilt on poll when the frame is unchanged; exactly one capture per
page.

### Slice 2 — free text, phone handoff, stale, idempotency

- Add `TYPE` text body and phone answer mode; tapping the body retries focus.
- Add `answer` metadata to `SendInput`; hub validation and `409` reasons.
- Add `Idempotency-Key` to the client and hub dedupe.
- Add `ERROR` copy/list for offline/auth/provider/timeout and `Retry` /
  `Choose again` / `Read chat`.
- Add stale detection while on `ANSWER`/`TYPE`; `stale` list `Review` /
  `Read chat`.
- Detect provider-native question attention and show `Answer in Inbox`.

**Acceptance:** type an answer on the phone and see `SENT` on the glasses;
tapping the sent body returns to chat; a stale send shows `Question changed` and
never sends; retry does not duplicate; offline keeps the answer; every status
screen has exactly one capture.

### Slice 3 — long lists, multiple questions, response surface

- Scroll rule: four rows visible; up to six choices; the normal action rows
  follow the sixth. No paging.
- Multiple questions open `ANSWER · N questions` with `Answer N questions` and
  `Answer N questions on phone`. The glass batch is one question per screen,
  then `REVIEW`; `Send all` sends one numbered message with per-question
  metadata. The phone form remains the fallback and shares the entries.
- Free-answer sentinels become `Type your own answer`; the literal sentinel is
  never sent. There is no separate `MORE` list.
- Voice, `Suggested answers`, and `Failure ›` are rows on `ANSWER`; voice follows
  the choices, and suggestions open a list that returns to `ANSWER`.
- Chat `Read chat` returns to the question line.

**Acceptance:** all six choices reachable with scrolling; two questions answered
on the glass and sent from `REVIEW`; the phone form answers the same batch when
preferred; `Stop agent` reachable from `ANSWER` and confirmed; voice and
suggestions never auto-send; a failure does not take the chat tap while a
question is open; back paths are correct.

### Slice 4 — inbox/home markers, accessibility, polish

- Home `Current · ? <session>`.
- Optional `QUESTION` relabel for unread rows when the hub has a cheap flag.
- Phone ARIA, `aria-live`, focus management, 44 px targets, 16 px input.
- Draft save/restore in answer mode; cancel behavior.
- Frame signature coverage for every answer state.

**Acceptance:** screen reader announces question and send status; no color-only
state; drafts survive a phone reload; no horizontal overflow at 320 px.

### Slice 5 — model suggestions and voice

- `Suggested answers` row; `reply-options?mode=answer` returns 2–3 candidates of
  at most 46 characters from the configured reply model.
- Model extraction fallback for medium/low confidence, labeled `Suggested`.
- Voice `Speak answer` with `LISTENING` → `TRANSCRIBING` → result; never
  auto-send, and Back/Cancel return to the screen that opened the microphone.
- Phone suggestion chips remain a follow-up.

**Acceptance:** suggestions never auto-send and send as free text; voice
transcript requires confirmation; model or transcription disabled still gives
the full deterministic flow.

### Test plan

- **Unit:** parser fixtures; revision/hash; action-row mapping and indices; risk
  flags; truncation at word boundaries.
- **Contract:** question endpoint shape; `SendInput.answer`; 409 reasons;
  idempotent retry.
- **Glass preview:** one snapshot per state; exactly one capture; container count
  4; footer hint ≤ 60 chars; header ≤ 40; no empty list.
- **Phone:** 390 px and 320 px; keyboard focus; card hide/show; no auto-focus.
- **Failure:** offline, auth, provider offline, timeout, duplicate, stale,
  answered elsewhere.
- **Hardware:** six-item list scroll and selection, footer non-interactivity,
  double-tap timing, ring activation, refresh latency, font glyphs.

---

## 14. Open questions

The spike resolved the two previous structural questions: the list scrolls and
selects beyond the visible rows, and only one container can capture. Two-footer
hit testing is withdrawn, not pending. Remaining hardware questions are ring
activation, double-tap timing, scroll feel, refresh latency, and glyph coverage.

| # | Question | Why it matters | How to resolve |
|---:|---|---|---|
| 1 | Can users find `Type answer` / `Speak answer` / `Read chat` below the fourth row without a cue? | The action rows may be one scroll away; poor discoverability costs taps. | User test; consider a row count or scroll cue in the footer hint. |
| 2 | How many choices before deferring to the phone? | Six is the current cap; a long scroll may be worse than the phone. | User test with real questions; keep six unless data says otherwise. |
| 3 | Does a ring tap activate a list row, or only temple tap? | The ring is a primary hands-free input. | Hardware test; document limitation. |
| 4 | How reliable is tap vs double-tap timing while walking? | Accidental back or send. | Scripted hardware checklist. |
| 5 | Should unread chat questions relabel the inbox row `QUESTION`? | Discoverability vs inbox noise/cost. | User test with real sessions; v1.1. |
| 6 | Confirm every answer, or only destructive ones? | Speed vs safety. | User test; current recommendation is destructive only. |
| 7 | Multiple questions: batch-on-glass only, or also allow `Answer last only`? | Partial answers can confuse the agent. | Product decision; the glass now answers every question and `Send all` validates completeness, so `Answer last only` remains rejected. |
| 8 | Is model extraction worth the latency/cost for medium-confidence questions? | Recall vs determinism. | Offline eval on real transcripts. |
| 9 | How should sentence splitting and truncation handle CJK, RTL, and emoji? | The parser and 52-char labels are English/Latin assumptions. | Localization review; use code points, not UTF-16 units. |
| 10 | How do provider-native questions and chat questions overlap in practice? | Double answering or wrong path. | Test OpenCode forms and Hermes clarify sessions. |
| 11 | Should stale low-risk questions allow `Send anyway`? | Safety vs wasted taps. | Product decision after usage data. |
| 12 | Does the provider preserve exact answer text and support idempotency? | Duplicate or altered answers. | Provider contract tests; hub dedupe is the baseline. |
| 13 | Does the G2 font render `←`, `…`, `·`, `×`, `’`? | Wireframe copy depends on them. | Hardware glyph test; fall back to ASCII. |
| 14 | Should the answer screen show a `Suggested` label for model-extracted choices? | Trust/confusion. | User test; v1 does not use model choices. |

---

## Appendix A — Copy deck

### Glass

| Context | Copy |
|---|---|
| Chat footer with question | `? Answer · L456-461/461 · M30/30` |
| Chat footer, question + failure | `? Answer · … · Failure ›` |
| Answer header | `ANSWER · <session>` |
| Answer header, multiple | `ANSWER · 2 questions` |
| Batch header | `ANSWER · Q1/2` |
| Review header | `REVIEW · 2 answers` |
| Answer header, stale | `ANSWER · changed` |
| Answer header, resolved | `ANSWER · resolved` |
| Question prefix | `Q  ` |
| Suggested header | `SUGGESTED · <session>` |
| Confirm header | `CONFIRM · <session>` |
| Type header | `TYPE · <session>` |
| List rows, yes/no | `Yes`, `No`, `Type answer`, `Speak answer`, `Suggested answers`, `Read chat`, `Stop agent` |
| List rows, choice + free text | choices, `Type answer`, `Speak answer`, `Suggested answers`, `Failure ›`, `Read chat`, `Stop agent` |
| List rows, free-form | `Speak answer`, `Type answer`, `Suggested answers`, `Failure ›`, `Read chat`, `Stop agent` |
| List rows, sentinel | choices without the sentinel, `Type your own answer`, `Speak answer`, `Suggested answers`, `Read chat`, `Stop agent` |
| List rows, multiple | `Answer 2 questions`, `Answer 2 questions on phone`, `Failure ›` |
| List rows, batch question | choices, `Type answer`, `Speak answer`, `Suggested answers`, `Answer on phone`, `Back` |
| List rows, batch review | `1 <answer>`, `2 <answer>`, `Send all`, `Back` |
| List rows, no free text | choices, `Speak answer`, `Suggested answers`, `Read chat`, `Stop agent` |
| List rows, >6 choices | first six, then the normal action rows |
| List rows, provider-native | `Answer in Inbox`, `Failure ›`, `Read chat`, `Stop agent` |
| Error list | `Retry`, `Choose again`, `Read chat` |
| Stale list | `Review`, `Read chat` |
| Confirm list | `Send`, `Cancel` |
| Footer hint, choices | `Swipe choose · Tap send · Back ×2` |
| Footer hint, action list | `Tap choose · Back ×2` |
| Footer hint, suggestions | `Tap send · Back ×2` |
| Footer hint, voice | `Tap to stop` / `Please wait` / `Tap choose   Back ×2` |
| Footer hint, sending | `Sending…` |
| Footer hint, sent | `Tap to return · Back ×2` |
| Footer hint, type | `Tap to focus phone · Back ×2` |
| Type body | `Type on the phone.` / `The answer sends from there.` / `Tap here to focus the phone again.` / `Unlock phone to type.` |
| Sending summary | `Sending…` + exact answer |
| Sent summary | `Sent` + exact answer |
| Error summary | `Couldn’t send.` + reason + exact answer |
| Stale summary | `Question changed.` / `Review before answering.` |
| Answered elsewhere | `Answered already.` |
| Confirm summary | `Send this answer?` + exact answer |
| Confirm warning | `This cannot be undone.` |
| Sensitive warning | `This may ask for sensitive information.` |
| Suggested items | the model's candidates, each ≤46 characters |
| Stop row | `Stop agent` |

### Phone

| Context | Copy |
|---|---|
| Card label | `QUESTION` |
| Card heading | `Question from <session>` |
| Type button | `Type a different answer…` |
| Hide/show | `Hide` / `Question · Show` |
| Composer heading, answer | `Answer question` |
| Composer placeholder, answer | `Answer: <question>` |
| Send button, answer | `Send answer` |
| Cancel | `Cancel answer` |
| Sending | `Sending…` |
| Sent | `Sent: “<answer>”` / `Dismiss` |
| Question changed | `Question changed. Review before answering.` |
| Confirm | `Send “<answer>”?` / `Send` / `Cancel` |
| Destructive note | `This cannot be undone.` |
| Error | `Couldn’t send. <reason>` |
| Offline | `Offline. Check the hub connection.` |
| Auth | `Session expired. Reconnect in phone.` |
| Provider | `Agent is offline.` |
| Too long | `Too long (<n>/4000 characters).` |

### Error reasons

| Cause | Glass copy |
|---|---|
| Hub unreachable | `Hub unreachable.` |
| Offline | `Offline. Check the hub connection.` |
| Auth/session | `Session expired. Reconnect in phone.` |
| Provider offline | `Agent is offline. Try again.` |
| Rate limit | `Too many requests. Wait a moment.` |
| Timeout | `Send timed out.` |
| Question changed | `Question changed. Review before answering.` |
| Already answered | `Answered already.` |
| Session deleted | `Session not found.` |
| Unsupported send | `This provider can’t receive replies.` |

---

## Appendix B — Parser fixtures

These are acceptance tests for `parseQuestion`; `kind`/choices are the expected
result, not a UI assertion.

| # | Latest assistant text (abridged) | Expected |
|---:|---|---|
| 1 | `Should I squash the three fix commits into one?` | boolean, Yes/No, high |
| 2 | `Which branch should I target?\n1. main\n2. release/2.4` | choice, 2, high |
| 3 | `Do you want me to:\nA) delete the branch\nB) keep it` | choice, 2, high; A destructive |
| 4 | `I can proceed or wait. Which do you prefer?` | choice, 2 inline, medium |
| 5 | `Plan:\n1. Read the file\n2. Fix the bug\n3. Run tests\n\nShould I proceed?` | boolean, Yes/No; not the plan |
| 6 | `Why did the test fail?` | freeform |
| 7 | `What should I name the branch?` | freeform |
| 8 | `The command is: rm -rf build (fenced block). Should I run it?` | boolean, Yes/No; destructive warning; code stripped |
| 9 | `You asked: “Should I delete it?” I’ll wait.` | no prompt (quoted) |
| 10 | `Done. Anything else?` | no prompt (courtesy) |
| 11 | `Should I deploy to staging or production?` | choice, 2 inline, high |
| 12 | `I found two options:\n- Use the existing token\n- Rotate the token\nWhich do you want?` | choice, 2, high |
| 13 | `Can you confirm the file path?` | freeform (information request) |
| 14 | `Do you know what caused it?` | freeform |
| 15 | `Which branch? And should I force push?` | 2 questions; phone |
| 16 | `Is the build green?` | boolean, Yes/No |
| 17 | Streaming message ending in `?` | no prompt until complete |
| 18 | `Here is a quote:\n> Should I proceed?\nThe build is green.` | no prompt (quote) |
| 19 | `1. Delete the branch\n2. Keep it\nWhich one?` | choice, 2, high; 1 destructive |
| 20 | `Should I proceed?\n\nLet me know!` | boolean, Yes/No; courtesy closer allowed |

---

## Appendix C — Relationship to existing docs

- `docs/glass-ux.md`: add `ANSWER`, `MORE`, `CONFIRM`, `TYPE` to the screen map;
  add the question footer marker; add the input rows; note the one-capture rule
  and list actions. Do not change the six-line chat or attention form rules.
- `docs/wearables.md`: add the question endpoint, answer send metadata, and the
  question card. Voice remains a follow-up.
- `docs/ui-ia.md`: the web client's inline question card is separate; the G2
  `ANSWER` screen is a wearable adaptation, not a new web IA. The phone companion
  is the G2 app, not the hub web client.
- `docs/design.md`: add the `QuestionPrompt`/`AnswerDraft` contract and the
  `GET /question` route. The answer send uses the existing message route with an
  optional `answer` object.
- `docs/glass-ux.md` says long-press is unavailable; this document agrees. The
  SDK declaration's long-press/menu additions are noted but not used.
- Spike evidence: the temporary harness was isolated from the production app and
  hub; measured results are summarized in §1.4. The screenshots and harness are
  kept outside the repository for reference.

---

## Appendix D — Assumptions

1. The G2 phone companion is the same browser page that hosts the Even Hub
   bridge; glasses and phone share app state. A second paired browser is a
   separate client.
2. The latest assistant message is available from the provider through the
   existing messages API, and `streaming`/`completedAt` are reliable enough to
   avoid prompting on partial text. If not, use session idle status as a
   secondary gate.
3. The list container shows four rows in 156 px and scrolls; it reports
   `currentSelectItemIndex` on click. Six items were reached with five `down`
   inputs in the spike; scrolling is resolved.
4. Only one container per page may capture events. The answer list (or a status
   text body) is the capture; the footer is a hint. A tap on the only text
   capture arrives as `sysEvent` with `eventSource = 1` and no container ID.
5. The provider accepts arbitrary text replies; there is no provider-side
   structured question API. Detection is derived from transcript text.
6. The app is English-first; sentence splitting and 52-character truncation are
   Latin-script assumptions. CJK/RTL are future work.
7. The hub can spend one extra provider read per question fetch; target under
   800 ms on LAN. A shared message snapshot cache is a later optimization.
8. The glasses have no keyboard and no reliable long-press. The phone has a
   keyboard and is usually nearby.
9. Monochrome means state must be text, position, weight, or border. Color is
   only available on the phone.
10. Answering a chat question is never the same as granting a provider
    permission. The attention flow remains authoritative for permissions/forms.
