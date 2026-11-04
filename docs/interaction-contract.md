# Chat interaction contract

Status: accepted and implemented through sending states and edit-and-fork.
This is the contract for chat actions that are not part of the provider
transcript model.

- Date: 2026-11-02
- Design version: `design-v1.3`
- Implemented: copy, dictation, optimistic send with failed-send retry, OpenCode
  and Open WebUI attachments, Open WebUI in-chat branch switching and
  retry-as-a-sibling, OpenCode session forks, and OpenCode edit-and-fork.
- Deferred: true in-chat editing for Open WebUI and a full session-family tree
  UI.
- Related: [`design.md`](design.md), [`ui-ia.md`](ui-ia.md),
  [`visual-audit.md`](visual-audit.md)
- Spike evidence: the isolated `spike/assistant-ui` branch (not merged)

## 1. Purpose

Oktoso should support branching, attachments, dictation, action bars, and
generic chat primitives without becoming an Open WebUI clone. The hub stays the
source of truth; clients stay provider-neutral.

This contract separates three things that are easy to conflate:

1. **What the provider actually supports.** Declared as capabilities and
   normalized by the hub.
2. **What the hub can promise across providers.** Uploads, transcription,
   read state, and a canonical branch model.
3. **What the client renders.** The web client only renders the contract; it
   does not reach into a provider API or invent provider-specific behavior.

The implementation is split into capability-gated slices. The transcript copy
action and hub-backed dictation shipped first. OpenCode and Open WebUI
attachments, Open WebUI in-chat branch switching, OpenCode session forks,
optimistic send, failed-send retry, and OpenCode edit-and-fork follow the same
contract. Open WebUI true in-chat editing remains gated off until its provider
path exists.

## 2. Non-goals

- Mirroring Open WebUI's screen structure, settings, or admin surface.
- Using `@assistant-ui/react-opencode` or any client that bypasses the hub.
- Running an agent or STT model inside the hub.
- Storing audio, attachments, or provider secrets in the browser.
- Presenting an OpenCode session fork as an in-chat sibling branch.
- Auto-sending dictated text. Dictation is an input method, not a send action.

## 3. Canonical concepts

### Turn, message, and activity

A **turn** starts at a user message and ends at the next user message. A turn
can contain several assistant messages because providers stream reasoning and
tool calls as separate records.

**Activity** is the reasoning/tool portion of a turn. The transcript renders one
collapsed activity block per turn when possible. The block is structural; it is
not a provider message.

### Branch

A **branch** is a set of alternative continuations. The contract distinguishes:

| Kind | Meaning | Example |
|---|---|---|
| `in-chat-siblings` | Alternative replies under one message inside a session | Open WebUI |
| `session-fork` | A new session created at a message boundary | OpenCode |
| `none` | The provider does not expose alternatives | Hermes, current normalized transcripts |

A client must never render a `session-fork` as an in-chat sibling. The hub will
expose the kind and the parent/child references; the picker renders only for
`in-chat-siblings`.

Branch operations are capability-gated:

- `branch.read`: list siblings and the active head.
- `branch.switch`: select a sibling and receive the new visible path.
- `branch.retry`: create a new sibling from a parent, not overwrite the answer.
- `branch.edit`: create a new user sibling from an edited message.

### Attachment

An attachment has an explicit lifecycle:

```text
selected -> uploading -> ready -> sending -> sent
                    \-> failed
```

- The hub owns upload storage and provider forwarding.
- The browser never receives a provider credential.
- The hub enforces size, type, count, and same-origin rules.
- The provider capability `attach` decides whether the composer exposes the
  upload control. The `attachments` capability still renders files that already
  exist in the transcript when sending is unavailable.
- OpenCode receives the file bytes inline. Open WebUI uploads each file to
  `POST /api/v1/files/`, then references `{ type: "file", id }` on the user
  message and the completion request. The hub still owns the original bytes.
- Open WebUI folders map to the session `project` label. Nested folders render
  as `Parent / Child`, so the session list, search, details, and chat header
  show the folder path without a new API field.

### Action

An action belongs to a message and is capability-gated:

| Action | Scope | Provider-neutral? |
|---|---|---|
| Copy | Any assistant message with text | Yes |
| Retry | Assistant reply with a regenerate path | No; needs provider support |
| Edit | User message with a fork path | No; OpenCode uses edit-and-fork, Open WebUI deferred |
| Feedback | Assistant reply | Provider-specific; opt-in |

Unavailable actions are hidden or disabled with a reason that is available to
screen readers, not only in a `title` attribute.

## 4. Activity grouping

The grouping rules are part of the transcript contract:

1. Adjacent activity-only assistant messages in a turn coalesce into one
   activity block.
2. A private activity preamble may fold into the following assistant reply when
   the activity node has exactly one assistant child.
3. An activity node with sibling children is a shared branch parent. It stays on
   its own row; folding it into one sibling would move the branch point.
4. A running turn shows the current activity block and a working state.
5. Pagination must not duplicate or lose activity. A page boundary may leave a
   trailing activity row when the next page starts a new turn; that is
   preferable to inventing a parent.
6. Copy acts on the text parts of the message, never on reasoning or tool
   payloads.

The current production transcript already groups activity-only messages. The
branch-aware fold is future work; it must not change the frozen visual grammar.

## 5. Dictation

### Decision

Dictation uses the hub's existing OpenAI-compatible transcription settings. The
browser records audio, sends it to the hub, and the hub forwards it to the
configured `/audio/transcriptions` endpoint.

This is deliberately not browser Web Speech:

- Web Speech sends audio to the browser vendor and is unavailable in some
  browsers.
- The operator already configures a self-hosted or private STT endpoint.
- The G2 voice path uses the same hub transcription contract with 16 kHz,
  signed 16-bit little-endian mono PCM wrapped as WAV.
- Provider keys stay on the hub.

### Flow

```text
composer mic
  -> getUserMedia({ audio: true })
  -> MediaRecorder
  -> stop
  -> POST /api/v1/transcribe (multipart audio)
  -> hub -> <transcription.baseUrl>/audio/transcriptions
  -> { text }
  -> append to the draft
```

The transcript is inserted into the current draft with a separating space. It
is never sent automatically.

### States

| State | Composer behavior |
|---|---|
| `idle` | Mic action is available when transcription is enabled and capture is supported |
| `starting` | Mic action disabled; status "Starting dictation" |
| `recording` | Mic action becomes "Stop"; status "Recording" with elapsed time |
| `transcribing` | Mic action disabled; status "Transcribing"; send disabled |
| `error` | Inline error with Dismiss; mic action retries |

The textarea stays editable while recording and transcribing. The transcript is
appended to the latest draft, not to a stale capture.

### Availability

Dictation is hidden when any of these is false:

- the hub reports `transcription.enabled`;
- `navigator.mediaDevices.getUserMedia` and `MediaRecorder` exist;
- the page is a secure context (HTTPS or localhost).

The hub does not terminate TLS. An operator serving the web client over plain
HTTP on a LAN cannot use browser microphone capture; this is a browser platform
constraint, not a product toggle. The Settings screen explains the requirement.

### Limits and privacy

- Maximum audio body: 25 MiB.
- Maximum recording: 120 seconds, auto-stopped by the client.
- Accepted types: WebM/Opus, Ogg/Opus, WAV, MP4/M4A, MPEG, FLAC.
- The hub does not persist audio. It streams the body to the configured
  endpoint and logs only metadata and errors.
- The hub enforces its own 25 MiB body limit; the global 1 MiB JSON limit does
  not apply to this route.
- `language` and `prompt` are optional API fields for future clients. The web
  client omits them in this slice.

## 6. Copy

- Available on completed assistant messages that contain at least one text
  part.
- Copies the raw text parts joined by a blank line. Markdown fences are
  preserved; reasoning and tool payloads are excluded.
- The button is a quiet secondary action. It is 11px, uses the existing control
  radius, and gets a 44px target on mobile.
- Success shows "Copied" for two seconds and announces it with
  `role="status"`. Failure shows "Copy failed" and does not throw.
- Clipboard access falls back to a temporary textarea when the async Clipboard
  API is unavailable (for example on a non-secure origin).

## 7. API additions

### Implemented

`POST /api/v1/transcribe`

- Auth: owner or paired session, same as the rest of `/api/v1`.
- Body: `multipart/form-data`
  - `audio` (required, binary)
  - `language` (optional string)
  - `prompt` (optional string)
- Response: `{ "data": { "text": string, "model": string } }`
- Errors:
  - `400 invalid_request` — missing/empty/unsupported audio
  - `409 transcription_disabled` — transcription is turned off
  - `409 transcription_unavailable` — base URL or model is missing
  - `413 payload_too_large` — over 25 MiB
  - `502 transcription_failed` — upstream error or malformed response
  - `504 transcription_timeout` — upstream timeout

`POST /api/v1/attachments`

- Body: `multipart/form-data` with `file`.
- Response: `{ "data": { id, name, mimeType, size, createdAt } }`.
- Limit: 20 MiB, five files per message, images/PDF/JSON/text/Markdown/CSV.
- Files are staged under `<dataDir>/attachments`, expire after one hour, and
  are deleted after a successful send. `DELETE /api/v1/attachments/{id}`
  removes one immediately.
- `SendInput.attachments` carries the staged IDs. The hub reads the bytes,
  checks the provider's `attach` capability, and passes the files to the
  adapter. The HTTP contract never carries provider credentials or raw files
  back to the client.

`GET /api/v1/sessions/{ref}/branches`

- Returns the active path's in-chat branch points:
  `{ messageId, parentId, role, siblingIds, index, count }`.
- `POST /api/v1/sessions/{ref}/branches` with `{ siblingId }` switches the
  active sibling. Open WebUI moves `history.currentId` to the selected
  sibling's deepest descendant.

`POST /api/v1/sessions/{ref}/retry`

- Body: `{ messageId }` of an assistant message.
- Open WebUI creates a new assistant sibling under the same user message,
  switches `history.currentId` to it, and runs the completion from the user
  prompt. The branch picker exposes the old and new answers.
- Providers without `retry` return a capability error.

`POST /api/v1/sessions/{ref}/fork`

- Optional `{ before?: messageId }`.
- Creates a provider-native child session. OpenCode copies the projected
  history before the message and returns a `Session` with `parentRef`.
- The web details panel exposes `Fork session` and `Open parent`.

`GET /api/v1/sessions?q=`

- With `q`, the hub queries enabled providers in parallel, merges provider
  matches with recent-cache matches, applies the `provider`, `status`, and
  `root` filters, and returns one page.
- Without `q`, the endpoint serves the recent-session cache.
- Provider cursors are opaque and are not merged, so cross-provider search does
  not paginate yet.
- Message-content search remains provider-specific and is not guaranteed.

The existing `GET/PUT /api/v1/settings/assistant` remains the configuration
surface. `GET /api/v1/settings/assistant/transcription/models` remains the model
discovery surface.

### Later slices

- True in-chat editing for Open WebUI as a user-sibling operation.
- A session-family tree UI beyond the parent link.
- Attachment forwarding for provider-native file stores that require a
  pre-upload step.

## 8. Accessibility and responsive rules

- Every action has a text or `aria-label` name.
- Copy success, dictation state, attachment failures, and branch errors are
  announced.
- A status is never color-only.
- The mic action, attachment remove control, and branch arrows are 44px on
  mobile; the copy action is 44px on mobile.
- The dictation status row remains visible below 760px, where the composer hint
  is hidden.
- The composer textarea remains 16px on mobile.
- Attachment chips wrap and truncate long names; branch pickers stay on one
  line.
- The existing 2px accent focus outline applies to the new controls.
- No new color, type, spacing, or radius token is introduced.

## 9. Delivery

1. **Done:** interaction contract, copy action, hub transcription route, web
   dictation.
2. **Done:** hub upload route, limits, OpenCode send mapping, composer chips,
   transcript rendering.
3. **Done:** Open WebUI in-chat siblings and OpenCode session forks.
4. **Done:** optimistic send, failed-send retry, and OpenCode edit-and-fork.
5. **Deferred:** true in-chat editing for Open WebUI and the full
   session-family tree.
6. **Production migration:** only after grouping and the frozen design hold
   against live provider data.

## 10. Acceptance criteria

**Copy and dictation**

- Copy appears on completed assistant messages with text and copies the raw
  text parts.
- Copy success and failure are announced and do not throw.
- Dictation is hidden when transcription is disabled or unsupported.
- Recording, stopping, transcribing, appending, retrying, and dismissing errors
  work end to end.
- Audio never reaches the browser's provider credentials.
- The hub rejects disabled, unconfigured, oversized, unsupported, failed, and
  timed-out transcriptions with the documented errors.
- The 1 MiB JSON limit does not block the 25 MiB audio route.
- The web client remains usable without microphone support.

**Attachments**

- Uploading a file stages it, renders a chip, and supports removal.
- Sending with text and sending attachment-only both work where `attach` is
  true.
- The provider receives the file bytes and the transcript normalizes the file
  part.
- A provider with `attach: false` rejects attachments with a capability error.
- Staged files are deleted after a successful send and expire after an hour.

**Branching**

- Open WebUI branch points show the active sibling index and count under the
  active assistant message.
- Switching a branch replaces the visible path and updates the picker.
- Retry creates a new assistant sibling, keeps the old answer reachable, and
  updates the picker count.
- OpenCode `Fork session` creates a child session and opens it; the child links
  back to the parent.
- A provider without branch/fork/retry support hides or rejects the action.

**Sending states and editing**

- The optimistic user message appears before the POST settles.
- A failed send shows Retry and Discard; Retry uses the same idempotency key.
- A successful send shows one user message after reconciliation.
- Edit & fork opens the new session with the edited text in the draft and does
  not present the fork as an in-chat branch.

**Design**

- Dark/light, 1440/1024/390/320, and the existing screens still pass.
- No horizontal overflow at 390 or 320.

## 11. Sending states and message editing

### Optimistic send

- A send creates a local user message immediately with a `local:` id and
  metadata containing the send status, text, attachment ids, and idempotency
  key.
- The composer clears, the transcript scrolls to the bottom, and the local
  message renders with `Sending…`.
- The hub send uses a stable idempotency key. Retry reuses the same key, so an
  ambiguous failure cannot double-send.
- On success the local state becomes `sent`; on failure it becomes `failed`
  with inline **Retry** and **Discard**. Discard removes the local message and
  deletes its staged attachments.
- Real provider user messages reconcile by role, text, file names, and a
  five-minute timestamp window. The optimistic copy is removed, never shown
  twice.
- A failed local message is not persisted. Navigating away loses the inline
  retry; the draft and attachments are not queued for later.

### Edit and fork

- Editing is offered for user messages only when the provider exposes session
  forks (OpenCode today).
- The editor is inline and prefilled with the message text. Attachments are not
  carried into the new fork.
- **Save & fork** forks the session before the target message, saves the edited
  text as the new session draft, and opens the fork. The user reviews and sends
  from the draft.
- This is a session fork, not an in-chat sibling. The UI labels it
  **Edit & fork** and never presents it as a branch.
- True in-chat editing for Open WebUI is deferred until the provider path can
  create a user sibling safely.

### Acceptance

- The optimistic message appears before the send POST settles.
- A failed send shows Retry; Retry reuses the same idempotency key.
- A successful send leaves exactly one user message after reconciliation.
- Edit & fork opens the new session with the edited text in the draft.

## 12. Open questions

- Should the hub persist a short transcript history for audit, or is the
  provider transcript the only record? Current decision: no audio retention and
  no separate transcript storage.
- Should the web client expose a language override? Current decision: no; the
  STT endpoint auto-detects. The G2 voice slice also relies on auto-detection.
- Should dictation auto-stop on silence? Current decision: no; the user stops
  explicitly or the 120-second cap fires.
- Should copy be offered on user messages too? Current decision: assistant
  messages only for the first slice.
- Should Open WebUI uploads use `/api/v1/files/` and pre-process the file before
  attaching, or should the hub wait for a provider-native send path? Current
  decision: upload to `/api/v1/files/` and reference the returned ids; this is
  implemented.
- Which child should an Open WebUI branch select when the target has several
  continuations? Current decision: the most recently timestamped descendant.
- Should the session family tree become a sidebar view or stay a parent link in
  details? Current decision: parent link first.
- Should Open WebUI editing create a user sibling in the current chat, and if so
  how should the branch picker represent user branches? Deferred.
