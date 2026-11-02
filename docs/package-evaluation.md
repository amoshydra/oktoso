# Package evaluation — assistant-ui family

Status: decision record. Date: 2026-11-02.

This evaluation follows the live assistant-ui spike on `spike/assistant-ui`
at commit `3238220` (tag `archive/assistant-ui-spike-live`). The spike was
built against the real hub, the fake OpenCode/Open WebUI providers, and a real
OpenCode session. It is not a production dependency.

Related documents:

- [`interaction-contract.md`](interaction-contract.md) — provider capabilities,
  branches, retry, attachments, and dictation semantics.
- [`design-lock.md`](design-lock.md) — the frozen UI contract.
- `archive/assistant-ui-spike` tag — the first spike's findings.
- `spike/assistant-ui` at `3238220` / `archive/assistant-ui-spike-live` tag —
  the live rewrite and its verification matrix.

## Decision

**Do not add any `@assistant-ui/*` package to the product.**

`@assistant-ui/react` is excluded by product direction. Once it is excluded,
the rest of the family is not a viable add-on:

- every UI and rendering package peer-depends on `@assistant-ui/react`;
- the core/store/tap packages are runtime internals, not standalone utilities;
- the runtime adapters move model/provider transport into the client and
  bypass the hub, exactly like `@assistant-ui/react-opencode`;
- cloud, MCP, generative UI, and persistence packages move ownership away from
  the hub.

No other assistant-ui package is worth its dependency and maintenance cost for
the current chat.

## Package matrix

| Package | What it adds | Runtime requirement | Verdict |
|---|---|---|---|
| `@assistant-ui/react` | Headless primitives and external-store runtime | — | Excluded by product direction |
| `core`, `store`, `tap` | Runtime internals | The assistant-ui runtime | No; not usable alone |
| `react-markdown` | Markdown wrapper around `react-markdown` | Peer-depends on `@assistant-ui/react` | No; use `react-markdown` directly only if needed |
| `react-streamdown` | Streaming Markdown via Streamdown | Peer-depends on `@assistant-ui/react` and `@streamdown/*` | No; evaluate `streamdown` directly only if partial Markdown is a measured problem |
| `react-syntax-highlighter` | Code highlighting | Peer-depends on `@assistant-ui/react` and `react-syntax-highlighter` | No; evaluate `shiki` directly |
| `react-ui` | Pre-styled components | Peer-depends on `@assistant-ui/react` | No; conflicts with the frozen design |
| `react-devtools` | Runtime inspector | Peer-depends on `@assistant-ui/react` | No |
| `react-hook-form` | Human-in-the-loop forms | Depends on `core`/`store`; peer `react-hook-form` | No; the hub owns forms and attention |
| `react-mcp` | Client-side MCP connection | Depends on `core`/`store`, MCP client | No; the hub is the MCP gateway |
| `react-o11y` | Observability primitives | Depends on `store`/`tap` | No; the hub has logs and diagnostics |
| `react-ai-sdk`, `ai-sdk`, `react-data-stream` | AI SDK transport | Client-side model transport | No; bypasses the hub |
| `react-langgraph`, `react-langchain`, `react-google-adk`, `react-ag-ui`, `react-a2a`, `eve`, `pi`, `opencode`, `statewire` | Protocol runtimes | Client-side model/provider transport | No; bypasses the hub |
| `react-native`, `react-ink`, `vue` | Other surfaces | Other renderers | No; the G2 client is not React Native |
| `react-lexical` | Rich-text composer with mentions | Assistant-ui runtime | No; the design uses a plain textarea |
| `generative-ui`, `react-generative-ui` | Generative UI | Assistant-ui runtime / no hub contract | No |
| `local-pdf-adapter` | Local PDF parsing | `@assistant-ui/react` | No; hub attachments own this |
| `next`, `vite`, `metro`, `x-generative-compiler` | Generative UI build tooling | Assistant-ui runtime | No |
| `agent-launcher`, `passport`, `pinboard`, `variants`, `mcp-docs-server`, `docs` | Unrelated tooling | — | No |
| `assistant-stream` | Streaming protocol utilities | Standalone, but peer-depends on AI SDK and Redis | No; a second streaming model beside hub SSE |
| `assistant-cloud`, `cloud-ai-sdk` | Cloud persistence | Assistant-ui runtime | No; the hub is the source of truth |

Package sizes are not bundle sizes, but they show the surface: `react` is
2.8 MB unpacked, `react-markdown` 426 KB, `react-streamdown` 382 KB,
`react-ui` 711 KB, `react-mcp` 848 KB, `react-langgraph` 1.1 MB, and
`react-devtools` 1.26 MB. The live spike page is 723 KB JS / 216 KB gzip;
production web is 508 KB / 148 KB gzip.

## Why the runtime adapters are excluded

`react-opencode` is not uniquely unsuitable. It is one member of a family that
assumes the browser owns the model run:

- `react-ai-sdk` and `react-data-stream` assume an AI SDK stream;
- `react-langgraph`, `react-langchain`, `react-google-adk`, `react-ag-ui`, and
  `react-a2a` assume their own agent protocol;
- `react-opencode`, `react-pi`, and `statewire` assume their own coding-agent
  backend;
- `assistant-cloud` assumes Assistant Cloud storage and identity.

Oktoso deliberately keeps provider transport, credentials, persistence, and
capability discovery in the hub. A client-side runtime adapter would duplicate
that layer and make the web client provider-specific. This is an architectural
boundary, not a package-quality judgement.

## Did the spike maximize the offer?

For the product-relevant surface, yes. For the full library, no.

The live spike used:

- `ExternalStoreRuntime` and `AssistantRuntimeProvider`;
- thread root, viewport, messages, viewport footer, load-earlier, and
  scroll-to-bottom;
- message parts and grouped parts;
- composer input, send, cancel, attachments, dictation, and stop-dictation;
- attachment root/name/remove;
- action-bar copy;
- `AuiIf`, `useAuiState`, and `groupPartByType`;
- `BranchPickerPrimitive` in the host-owned-tree round (live branches use the
  hub's `BranchPoint`);
- attachment and dictation adapters.

It did not use:

- message editing and edit composers;
- `ActionBarPrimitive.Reload` and feedback;
- speech synthesis, realtime voice, or voice sessions;
- suggestions, queue UI, input history;
- thread-list primitives;
- tool UI, tool approvals/HITL, generative UI, MCP;
- cloud persistence or thread history;
- markdown, streamdown, syntax-highlighter, or devtools packages;
- virtualization, selection toolbar, quote, mentions, slash commands, message
  timing, resumable streams, or model-context/copilot APIs.

Those are not missing plumbing. They are product features that need a hub API,
a UX decision, or both. The features the hub already exposes — branches, retry,
forks, attachments, dictation, attention, reply options — still required custom
host code.

The live rewrite still needs roughly 3.2k lines of host code for one chat
column and does not implement the rest of the shell. assistant-ui contributes
the React plumbing, not the hard parts.

## Standalone packages worth evaluating

These are not assistant-ui packages and should be judged against a measured
gap.

| Candidate | Worth it? | Notes |
|---|---|---|
| `shiki` | Maybe | The cleanest way to close the documented code-block highlighting gap. Post-process the existing `marked` HTML; measure grammar/theme cost and async highlighting. |
| `@tanstack/react-virtual` | Only if measured | The 200-message production page and the 74-message live spike test were fine. Virtualizing variable-height messages, branches, and sticky activity needs care. |
| `streamdown` / `remend` | Only if measured | Use only if partial Markdown flickers or breaks during streaming. It replaces a working `marked` + DOMPurify pipeline with a heavier tree. |
| `react-markdown` | No | The current renderer is sanitized, tested, and smaller. Switch only if React-component-level Markdown is required. |
| `react-hook-form` | No | The hub owns provider forms and attention. |
| `katex` / `mermaid` | Only if output needs it | Agent replies currently do not require math or diagrams. `mermaid` is especially heavy. |
| `@radix-ui/react-*` / `react-aria` | No | Existing controls meet the accessibility and frozen-design contract. |
| `date-fns`, `@tanstack/react-query`, `zustand`, `motion`, `pdfjs-dist` | No measured need | Tiny helpers and existing SSE/state patterns are sufficient. |

## Reusable production findings

### 1. Preserve provider message order for same-timestamp turns

**Ported. This was a real production bug.**

The hub returns messages in provider display order. Open WebUI can give a
prompt and its reply the same second-resolution timestamp. The old production
merge sorted by `createdAt` and then `id`, so the live spike put the assistant
reply before the user prompt. The fix keeps the hub page order and applies SSE
updates in place.

Implemented in `apps/web/src/app/message-order.ts`:

- `mergeLatestPage` keeps loaded older messages before the latest page,
  preserves the page order for ties, and keeps held newer messages after it;
- `mergeMessageUpdates` replaces an existing message in place and appends new
  messages in event order.

`refreshLatest` now calls `mergeLatestPage`; SSE `message.created` and
`message.updated` events call `mergeMessageUpdates`. Tests live in
`apps/web/src/app/message-order.test.ts`.

### 2. Guard the React root against Fast Refresh

`apps/web/src/main.tsx` calls `createRoot(root).render(<App />)` at module
scope. Vite Fast Refresh can re-run the module and create a second root on the
same container. The spike hit this repeatedly. The guarded root is small and
dev-only:

```ts
const rootKey = "__oktosoWebRoot";
const globalRoot = globalThis as typeof globalThis & {
  [rootKey]?: ReturnType<typeof createRoot>;
};
const appRoot = globalRoot[rootKey] ?? createRoot(container);
globalRoot[rootKey] = appRoot;
appRoot.render(<App />);
```

Low priority, but it removes a confusing development failure mode.

### 3. Audit branch points on activity-only messages

Production's `groupTranscript` turns consecutive activity-only assistant
messages into an `activity` item. `TranscriptMessage` receives a `branchPoint`
only for `kind: "message"` items. If a provider can attach a branch point to an
activity-only message, the picker would not render.

The spike kept an activity-only branch point on its own row so the branch
point stayed visible. This is an edge case; audit the Open WebUI fake branch
fixtures and real provider data before changing production grouping.

### 4. Reuse the pagination and scroll acceptance procedure

The live spike measured:

- first visible message at `328.39px` before loading older, `328.39px` after;
- new SSE activity arriving without moving the reader;
- `Jump to latest` returning to the bottom (`scrollTop 14200`,
  `atBottom: true`).

This is a reusable manual acceptance check for any future changes to
`refreshLatest`, `loadOlder`, `groupTranscript`, or the transcript scroller.

### 5. What is not reusable

- The assistant-ui page, primitives, adapters, and spike CSS. They are tied to
  `@assistant-ui/react`.
- The assistant-ui dictation stop-promise fix. Production dictation is a
  custom state machine; it does not have the assistant-ui session cleanup.
- The attachment `data-attachment` parsing. That shape is specific to
  assistant-ui's `AppendMessage`.
- The `mergeLatestMessages` code as-is if production keeps a different
  pagination path; port the invariant, not the file.

## Decision rule for future packages

1. Does it keep the hub as the source of truth?
2. Does it avoid moving model/provider transport into the browser?
3. Does it fit the frozen design and accessibility contract?
4. Does it replace code we already have, or add a capability we actually need?
5. Is the dependency and bundle cost justified?

A “no” on 1–3 is disqualifying. A “no” on 4–5 means the package is not worth
adopting now.

## Recommendation

- Add no assistant-ui package.
- Add no assistant-stream, cloud, MCP, generative UI, or runtime adapter.
- Keep the custom chat.
- Archive the spike.
- The same-timestamp ordering fix and its tests are ported.
- Evaluate `shiki` only if code-block highlighting becomes a priority; evaluate
  virtualization only after profiling a long live session.
