# Agent-loop spike

Status: experiment, not a feature. Branch `spike/agent-loop`.

The question this answers: could a model watch attention and move sessions
forward on its own, without a hand-written rule per case?

The short answer from the first run: **the loop is easy, the judgment is not
good enough to send unsupervised.** Every proposal below was printed, none was
sent, and the disagreements between the two brains are the useful result.

## What it does

`scripts/agent-loop-spike.ts` polls attention, reads the session transcript,
asks a model what to do next, and prints the proposal. It never sends, never
resolves attention, and never writes to the hub. It reads the same config and
owner token as `oktoso status`.

Two brains, selectable:

| Mode | Brain | Why |
|---|---|---|
| default | `GET /api/v1/sessions/:ref/reply-options` | Reuses the composer's reply service and the already-configured endpoint. Tests whether the existing prompt can supervise. |
| `--decide` | A supervisor prompt written for this spike | The model gets the transcript plus the attention item and returns strict JSON: `send`, `wait`, or `escalate`, with a message, reason, and confidence. Calls the reply endpoint directly. |

```sh
pnpm exec tsx scripts/agent-loop-spike.ts --config ~/.config/oktoso/hub.config.json
pnpm exec tsx scripts/agent-loop-spike.ts --decide --session desktop-opencode:ses_x
pnpm exec tsx scripts/agent-loop-spike.ts --decide --limit 6 --json /tmp/agent-loop.json
pnpm exec tsx scripts/agent-loop-spike.ts --interval 60
```

Moves are mapped, not invented: `SEND` is a send action with high confidence,
`REVIEW` is a send action below high confidence, `ESCALATE` means no draft or a
failure/blocker, `WAIT` and `DONE` come from the reply service state or the
supervisor action.

## First run

Read-only, against one live hub with six attention items: two stale error
items and four unread sessions. Local model, no API key.

| Attention item | reply-options | supervisor | Verdict |
|---|---|---|---|
| Unread, small follow-up | Send: repeated the user's own last instruction | Wait: still investigating | Reply mode echoes; supervisor is right to wait |
| Unread, download task | Send: a concrete next step | Send: asked the user whether to stop the server | Both usable; the supervisor is more contextual but hands work back |
| Unread, config task | Send: a short confirmation | Wait: work presented, no reply needed | Disagree; supervisor is more conservative |
| Unread, command task | Done: nothing to add | Send: restated the agent's own command as a user reply | Both wrong; the supervisor is confidently wrong |
| Error, fixture asking a two-choice question | Done | Send: repeated the question back to the user | Both wrong; the question was for the human to answer |
| Unread, long running task | Send: repeated the user's last message | Send: plausible, but invented UI details that do not exist | Reply mode echoes; supervisor hallucinates specifics |

Latency: 20–1,400 ms per item on a local endpoint. The loop itself is about
150 lines. Cost is not the problem.

## What the run shows

1. **The composer prompt is not a supervisor.** `reply-options` is built to
   offer a human something to say to the current moment. It collapses most
   idle sessions to `DONE`, and when a session is running or waiting on the
   user it can propose the user's own last message as the reply.
2. **A supervisor prompt reads context better, and is overconfident.** It
   understood what each session was doing, but it restated questions that were
   meant for the human, repeated the agent's own narration, and invented
   product details. All at `high` confidence.
3. **The missing layer is policy, not prompting.** The model needs to know
   four things the prompt alone cannot guarantee:
   - a question with explicit choices that asks *the user* to pick is not the
     supervisor's to answer;
   - never repeat the last user message, and never restate the agent's own
     command as a user turn;
   - a proposal that names a file, command, or UI affordance must be checked
     against the transcript before it can be sent;
   - anything below high confidence goes to a human.
4. **The loop shape is viable.** Attention → transcript → proposal is enough
   to produce a usable draft. It is the sending that needs the guardrail.

## Recommendation

Do not ship an always-on sender. Build the narrow version that the evidence
supports:

- The loop produces a **draft plus a reason**, and always writes it to the
  approval queue. A human approves; nothing sends on its own.
- Add the four policy checks above as code, not prompt text. Start with the
  cheapest: reject a proposal that matches the last user message, and never
  auto-answer a pending question that has explicit choices (the existing shape
  allowlist already models this).
- Keep the deterministic watchers for the reflexes (retry, notify, start).
  The model drafts judgment calls; the approval queue decides.
- Re-run this spike with the policy checks and the same six items. If the
  draft quality holds, promote one case at a time (a question with a safe
  choice, a stalled session) and keep the rest on approval.

## Limits of the evidence

- Six real items, one operator, one model, one day. Not a quality benchmark.
- The two failing items were stale attention rows; a fresh queue may behave
  differently.
- The `--decide` mode refuses to run when the hub stores an API key, because
  the key is not readable through the API. That is deliberate.
- No send path was implemented, so the "what happens after approval" half of
  the loop is untested.
