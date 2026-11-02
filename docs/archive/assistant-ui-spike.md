# Assistant UI spike

> Archived 2026-11-02. This spike was not adopted for the production chat.
> The custom transcript now has copy, dictation, attachments, branches, retry,
> and session forks. See [`../interaction-contract.md`](../interaction-contract.md)
> and the `design-v1.3` lock. The original spike branch is preserved by the
> local `archive/assistant-ui-spike` tag.

Status: experimental. Not part of the product branch and not pushed.

- Base: `df45ce6` (the finalized desktop chat slice)
- Branch: `spike/assistant-ui`
- Library: `@assistant-ui/react@0.15.32`
- Runtime: `ExternalStoreRuntime`
- Page: `apps/web/spike.html`

The hub remains the source of truth. The spike uses `HubClient` for providers,
sessions, messages, attachment reads, and pagination. It does not use
`@assistant-ui/react-opencode`.

The spike has two modes:

- **Branch fixture** (`?mode=fake`, default) — deterministic fake data for
  branches, attachments, actions, and dictation. No hub needed.
- **Live session** (`?mode=live`) — the real `visorium - 3d (fork #1)` session
  through the hub, for transcript, pagination, images, and activity grouping.

## Run it

```sh
pnpm install
pnpm --filter @amoshydra/oktoso-web dev --port 5180
```

Open:

```text
http://127.0.0.1:5180/spike.html?mode=fake
http://127.0.0.1:5180/spike.html?mode=live&limit=80
```

The live mode requires the hub at `127.0.0.1:8787` and a paired browser. The
Vite proxy must keep `changeOrigin: true` because the hub derives its session
cookie name from the request host.

Override the live session with `?ref=desktop-opencode%3Ases_...&limit=200`.

## Round 1: transcript rendering

The first spike converted Oktoso `Message`/`MessagePart` values into
`ThreadMessageLike` and rendered `ThreadPrimitive.Root`, `Viewport`,
`Messages`, `MessagePrimitive.Parts`, and a disabled `ComposerPrimitive`.

What worked:

- Message conversion for text, reasoning, tool calls, images, and files.
- Markdown through the existing `renderMarkdown` helper.
- 19 live images through the hub attachment proxy and blob URLs.
- Auto-scroll and a 230-message session without virtualization.
- `ThreadPrimitive.LoadEarlier` preserved the reading position:
  `159.8px → 160.2px` for the first visible message.

The important gap: assistant-ui groups parts **within** a message, not
activity-only messages **across** messages. The live session had 222 assistant
messages, mostly reasoning/tool-only turns. The first spike rendered each as a
separate `AGENT` row instead of one collapsed activity block.

## Round 2: branches, attachments, actions, dictation

### Branch fixture

The fixture is a real message tree with `parentId` and `headId`:

- three sibling answers under the first user turn;
- two sibling answers under the last user turn;
- activity-only assistant chains before the answers.

It is loaded with `ExportedMessageRepository.fromBranchableArray(items, {
headId })` and passed as `messageRepository`.

What worked:

- `BranchPickerPrimitive.Root` shows `1 / 3`, `2 / 3`, and `3 / 3`.
- Switching a branch rewrites the visible path. The first branch keeps the
  follow-up turns; the second and third end at the alternative answer.
- `MessageState.branchNumber` and `branchCount` are correct.
- Retry uses `onReload` to create a **new sibling**, so retry and branch
  switching share the same tree. The count becomes `4 / 4` and the old answer
  is still reachable.

Two API details matter:

1. **`messageRepository` alone does not enable branch switching.** The
   external-store runtime sets `switchToBranch: this._store.setMessages !==
   undefined`. Without a `setMessages` callback the branch buttons render
   disabled. The spike provides `setMessages` and moves `headId` to the last
   visible message.
2. **`BranchPickerPrimitive.Previous`/`Next` keep their slot and render
   disabled at the first/last branch.** The action callback is `null` there, but
   the action-button wrapper still renders the button, so the pill does not
   collapse. No custom hook is needed for a stable layout.

### Attachments

The spike has a fake `AttachmentAdapter` with a visible upload phase:

- `add` is an async generator yielding `running` progress at 12% and 68%, then
  `requires-action` / `composer-send`.
- `remove` clears the cached bytes.
- `send` produces an image part for images and a file part for everything else.
- The composer renders `ComposerPrimitive.Attachments` with
  `AttachmentPrimitive.Name`, `Remove`, and a progress bar.

What worked:

- File picker and attachment add. The composer is configured for multiple
  files, but the CDP upload helper could only exercise one file at a time.
- The attachment lifecycle (`running` → `ready`), removal, and re-attachment.
  The adapter yields a 12% and 68% progress phase; the test observed the
  settled state, not a captured progress frame.
- Sending an image with text and sending an image with no text.
- The sent user row renders the image inline at 576×288.
- Non-image files render as a name/MIME chip.

Integration details:

- **Attachment content is not in `append.content`.** The composer delivers text
  in `append.content` and the image/file parts in
  `append.attachments[].content`. The host must merge them when it builds the
  user message. The spike appends attachment content only when no media part is
  already present.
- **Do not rely on the `File` object reaching `send`.** `send` may receive a
  copy of the pending attachment. The spike reads the bytes during `add` and
  caches them by attachment id, which also mirrors a real upload.
- **The hub has no upload endpoint.** This adapter is local fake data. A
  production slice needs a hub upload route, storage rules, size/type limits,
  and a provider send mapping.

### Action bar

`ActionBarPrimitive.Root` wraps `Copy` and `Reload`.

What worked:

- Copy reads the message text and sets `data-copied`; the success state can be
  styled directly.
- Copy copies the **raw Markdown** (`**Option A — single row.**`), not the
  rendered prose. If the product wants plain text, the copy handler must be
  replaced.
- Reload is available only when `onReload` exists. In live mode the button
  renders disabled, which is the correct capability gate.

Gaps:

- The copied state is color-only. The spike adds a visually hidden
  `role="status"` announcement because `ActionBarPrimitive.Copy` does not.
- A disabled Retry explains itself only through `title`, which is not reliably
  announced. Capability explanations need inline copy or an adjacent hint in
  the real UI.

### Dictation

The spike uses a deterministic fake `DictationAdapter` so it works without the
Web Speech API:

- `onSpeechStart` moves the composer to `running`.
- `onSpeech` emits cumulative interim transcripts, then one final transcript.
- `stop()` finalizes the current partial transcript.
- `disableInputDuringDictation: true` disables the textarea while listening.
- The composer shows `ComposerPrimitive.DictationTranscript` and a live
  `Listening` status.

What worked:

- Dictation starts, shows interim text in the composer, and stops cleanly.
- The textarea is disabled during dictation and re-enabled after.
- The transcript is appended to any existing composer text.
- `ComposerPrimitive.StopDictation` can be conditionally rendered with `AuiIf`.
- Send must be gated by the host while dictating; the spike disables it with a
  custom `SendButton`. assistant-ui's send action does not include dictation in
  its own availability check.

The real adapter would be `WebSpeechDictationAdapter` or a hub transcription
endpoint. Browser speech was not exercised in headless Chrome.

### Activity grouping

`MessagePrimitive.GroupedParts` with
`groupPartByType({ reasoning: ["group-activity"], "tool-call":
["group-activity"] })` collapses adjacent reasoning/tool parts in one message
into a single native `<details>` block. A React context makes the leaf steps
render as compact rows instead of nested disclosures.

Cross-message grouping is still custom:

- **Live transcripts** merge activity-only runs and fold them into the
  following assistant reply. The reply keeps its id and the leading activity
  becomes one block. 80 live messages render as 9 rows with 5 activity blocks
  and 0 activity-only rows.
- **Branchable trees** fold an activity node into its child only when it has
  exactly one assistant child. An activity node with sibling answer children is
  their shared parent; folding it into one child would move the branch point.
  The fixture's shared activity stays on its own row and its single-child
  activity folds into the answer, so the visible path has 7 rows and 1
  activity-only row.

The fold is a display conversion. A production contract should define whether
the canonical transcript is grouped by the hub or by the client, and whether
grouping is stable across branches and pagination.

### Pagination, layout, and accessibility

- Live load-earlier preserved the anchor after grouping:
  `125.47px → 125.56px` for the first visible user message.
- Coalescing is per page. When an older page ends with an activity-only run and
  the current page starts with a user message, a boundary activity row remains.
  A production merge should account for the page boundary.
- Reviewed at 1440, 1024, 760, 480, 420, 390, and 320px in dark, plus 1440 and
  390px in light. No horizontal overflow.
- Mobile targets are 44px for branch arrows, composer actions, and the
  attachment remove button. The composer textarea is 16px on mobile.
- Branch counts have a screen-reader value; the visible count is `aria-hidden`.
- Copy has a live announcement; attachment ready/failed states are live
  statuses; dictation is a polite live region.
- The composer textarea has `id`, `name`, and an `aria-label`. Two console
  advisories remain and are not runtime errors:
  - the production Markdown renderer marks images `loading="lazy"` without
    explicit dimensions;
  - `react-textarea-autosize` keeps a hidden mirror textarea with no `id`/`name`
    (`aria-hidden` and `tabindex="-1"`).
- The fake attachment path initially failed with `NotFoundError` because a
  zero-byte file from the browser upload fixture was used. Reading bytes during
  `add` also keeps the adapter independent of the original `File` object.

## Findings that affect a migration

| Area | Finding | Consequence |
|---|---|---|
| Transcript | Grouping across messages is not a primitive | Custom merge/fold pass, branch-aware |
| Branches | Requires `setMessages` as well as `messageRepository` | Runtime adapter must own head updates |
| Branches | Open WebUI siblings ≠ OpenCode session forks | Canonical tree needs a capability and a kind |
| Retry | `onReload` naturally creates a sibling branch | Model retry as a tree operation, not an overwrite |
| Attachments | Composer puts media in `attachments[].content` | Merge into the user message on send |
| Attachments | Hub has no upload endpoint | Upload/storage/provider send are real work |
| Attachments | `AddAttachment` is enabled without an adapter | Host must gate the control itself |
| Actions | Copy is raw Markdown and color-only | Custom copy text and announcement |
| Actions | Reload has no built-in capability explanation | Inline unavailable reason |
| Dictation | Adapter + composer states work | Cheap provider-neutral win |
| Dictation | Send is not gated during dictation | Host must gate |
| Grouping | `GroupedParts` handles one message only | Keep the custom merge pass |
| Dependency | `@assistant-ui/react` pulled 182 transitive packages | Measure bundle cost before adoption |

## Recommendation

Use assistant-ui as a **headless transcript/composer renderer**, not as the
product shell.

Keep as Oktoso code:

- `HubClient`, SSE, and the attachment proxy;
- the details panel and session sidebar;
- inline permission/approval/question/error attention;
- the agent/model/reasoning picker;
- provider capability gating and the canonical branch semantics.

Before a production migration, write a short interaction contract:

1. **Message tree** — define `branchKind` as `"in-chat-siblings"` or
   `"session-fork"`, expose it from the hub, and make the picker render only
   where the provider supports it. Do not present an OpenCode fork as an
   in-chat sibling.
2. **Attachments** — define add/upload/send/read, limits, storage, provider
   mapping, and the merge into user message content.
3. **Actions** — define copy, retry/edit, feedback, and the unavailable reason
   per provider. Retry must be a tree operation.
4. **Dictation** — choose browser speech or a hub transcription endpoint,
   define the language/locale, and lock input during dictation.
5. **Activity grouping** — define one block per turn, the branch-boundary rule,
   and pagination behavior.

Sequence:

1. Interaction contract/ADR.
2. Provider-neutral quick wins: copy action bar and dictation.
3. Attachments with a real hub upload route.
4. Branching, starting with Open WebUI in-chat siblings; treat OpenCode forks
   as session-level branches.
5. Production migration only if the second spike's grouping and frozen design
   hold against live provider data.

Do not use `@assistant-ui/react-opencode`. It would bypass the hub and turn the
web client into an OpenCode client.

## Verification

- `pnpm typecheck` passes.
- `pnpm test` passes (215 tests).
- `pnpm build:web` passes.
- Fake fixture: branch switching, retry-as-branch, copy, attachment upload and
  send, dictation start/stop, activity grouping.
- Live session: 80 messages → 9 rows, images, activity blocks, disabled Retry,
  gated attachments, dictation, load-earlier anchor.
- Dark/light at 1440, 390, and 320px.

Not pushed. The spike remains isolated on `spike/assistant-ui`.
