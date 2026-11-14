# Session recovery

What happens when a turn fails, and how a user gets the session moving again.

## Three failure points

| Failure | What the user sees | Where the text lives | Correct recovery |
|---|---|---|---|
| **Send rejected** — the hub or network refuses the POST | An optimistic user message marked **Not sent**, with Retry and Discard | The local message; the draft is re-saved | **Retry** resends the same idempotency key. Change the model first if the failure was a quota. |
| **Turn failed before output** — the provider accepts the prompt, then returns an error before any assistant text or tool call | An assistant error card with the provider message | The user message and the failed assistant message | **Retry turn** undoes the failed turn and replays the user message on the current model. |
| **Turn failed mid-run** — the error arrives after text or tools | The partial activity plus an assistant error card | The user message, partial assistant messages, and any file changes | **Continue** sends a new "continue from where you left off" turn and keeps the partial work. Retry would remove it, and may restore files, so it is not the default. |

A quota/rate-limit error that arrives immediately is the second case. The user
message did send; only the assistant turn failed.

## Actions

- **Retry turn** — re-run the failed turn from its user message. The user
  message is not duplicated. The current model is used, so switch the model
  first to retry on another one.
- **Continue** — send `Continue from where you left off.` as a new user turn.
  Works on every provider with `send`, keeps the failed turn visible, and does
  not restore files.
- **Switch model** — the composer selector changes the session model for the
  next turn. A quota may be scoped to the model, the provider, or the whole
  account; if it is account-wide, switching models inside that provider will
  not help. Local and free models are separate pools.
- **Fork / Edit & fork** — the fallback when a provider cannot retry in place.
  Fork before the user message, set the model on the fork, and send the text
  there. It keeps the original session intact.

The web shows **Retry turn** and **Continue** in the assistant error card. The
hint above them names the model step for quota errors. Both actions are hidden
or disabled when the provider does not support them (`retry`, `send`).

## Provider behavior

| Provider | Retry | How it works | Notes |
|---|---|---|---|
| **OpenCode** | `retry: true` | `POST /revert/stage` at the turn's user message, inspect `files`, `POST /revert/commit`, then `POST /prompt` with the same text | The current session model is used at prompt time, so switching the model first is enough. A turn that changed files is refused: reverting would restore them, so use Continue. Attachments are refused for v1; use Edit & fork. Only the latest turn can be retried. |
| **Open WebUI** | `retry: true` | Create a new assistant sibling under the same user message, switch the active leaf, run the completion, wait for it | The old answer stays reachable in the branch picker. |
| **Providers without retry** | `retry: false` | No Retry turn button | Continue and Edit & fork remain available. |

OpenCode's revert is the same primitive as the TUI `/undo`: the selected user
message and everything after it are hidden, files changed by the affected
assistant steps are restored, and sending the next prompt commits the revert.
Redo clears it. The hub stages and commits the revert without a separate redo
step because the prompt follows immediately.

## Why not automatic fallback

An automatic fallback can silently spend a paid model, replay a failed turn
twice, or restore files the user wanted to keep. OpenCode plugins that do this
exist, but they make assumptions the hub cannot: whether the quota is per-model,
whether a mid-run failure should replay or continue, and which fallback is
safe to charge. The hub keeps the choice explicit: switch the model, then
Retry turn. Continue is the one-click path that never rewrites history.

## Prior art

- **OpenCode `/undo`** stages a revert at the latest user message, copies its
  text back to the composer, and restores files; sending a new prompt commits
  it. `/redo` clears the staged revert.
- **OpenCode model fallback plugins** replay the latest user message for a
  fresh-send failure and send a continue message when the failed run had
  already made progress.
- **Claude Code** retries transient failures with backoff, uses `/rewind` to
  restore the conversation and code, and `/model` to switch. Account-wide
  limits surface their own reset time and do not recover by switching models;
  per-model capacity does.
- **Cursor** retries or recommends another model family, and restores a
  checkpoint when the turn changed files.
- **ChatGPT / Copilot Chat** offer Regenerate/Retry on the failed answer and a
  model picker; the failed user message is reused rather than duplicated.

## Implementation

- `apps/web/src/app/App.tsx`: the error card renders Retry turn and Continue.
  Retry calls `POST /api/v1/sessions/:ref/retry` with the failed assistant
  message id. Continue calls the normal send endpoint with the continuation
  text.
- `packages/providers/src/opencode/adapter.ts`: `retryMessage` finds the failed
  assistant, walks back to its user message, refuses older turns, attachments,
  and file-changing turns, then stages and commits the revert and re-prompts.
- `packages/providers/src/openwebui/adapter.ts`: `retryMessage` creates an
  assistant sibling, as before.
- The hub does not know a quota's scope. It surfaces the provider message and
  leaves the model choice to the user.
