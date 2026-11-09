# Reply audit

The reply audit page inspects the exact input and output of the wearable reply
model, then records whether the generated replies were useful. The feedback is
the raw material for changing the system prompt and the context builder.

## Where it runs

```text
http://<hub-host>:8787/apps/even-g2/audit.html
```

It is served with the Even G2 app and uses the same origin as the hub API. The
page reads the token stored by the G2 phone surface
(`oktoso-even-g2-token`), then the web client token (`oktoso-token`), or accepts
a hub owner/session token. A paired browser can use the HttpOnly cookie.

Reply generation itself is not G2-only at the API level:
`GET /api/v1/sessions/:ref/reply-options` is a hub endpoint. Today the Even G2
client and the web composer call it; any other client can use the same contract.
The web experience is on demand: a `Suggest` action fetches model options and
inserts the selected text into the composer for review instead of sending it.

## What the page shows

For one session and mode (`reply` or `choices`):

- the session title, status, model, total time, model time, finish reason, and
  generation time;
- a **Moment** block with the gate result: `state` (`reply` / `wait` / `done`),
  `kind`, confidence, pending decision, choices, done items, and constraints;
- a **Rejected suggestions** block with the role, text, and reason for every
  candidate the lint removed;
- the exact system prompt and the MOMENT context sent as the user message;
- the raw model output, including `reasoning_content` when the endpoint returns
  it;
- every generated option, with `model`, `agent`, or `canned` provenance and a
  role (`answer`, `opposite`, `ask`). The opposite is labelled `Alt: …`; the
  ask is a question.
- a **Pending question** block when the latest assistant message contains a
  provider-native `question` tool part. It shows the question header, full text,
  and every option with its description. Text questions use the same block.

The audit call bypasses the reply cache, so pressing **Generate** gives a fresh
sample. The normal `reply-options` call remains cached.

## Decision gate

The hub classifies the moment before calling the model:

| State | When | Model call |
|---|---|---|
| `reply` | Pending question/approval, failure/blocker, explicit next action, delivery with an offer, or a challenge | Yes |
| `wait` | Agent running with no ask | No |
| `done` | Finished delivery with no ask or action | No |

`wait` and `done` return the canned actions and a state field; the clients show a
notice instead of model suggestions. This removes the largest class of bad sets:
suggestions when there is no decision to make.

## Context policy

The model gets a compact MOMENT block, not the whole transcript:

```text
moment:
  state: reply
  kind: approval
  pending: "Merge #8 and say the word..."
  choices: ["approve", "merge"]
  done:
    - Fixed and pushed...
  constraints:
    - Do not commit.
  user_goal: ...
  last_user: ...
  last_assistant_tail: ...
  evidence:
    assistant: ...
    user: ...
```

- `last_assistant_tail` keeps the first 200 and last 700 characters, cut on
  sentence boundaries. The ask and caveats are at the end of long reports.
- `done` comes from lines that start with a completed-work word; fenced code is
  removed first.
- `constraints` are full user sentences containing do-not/never/only/keep/
  without. The lint enforces the negative constraints.
- Up to three prior text messages are included at 400 characters each as
  evidence. No raw tool input, output, or command is sent.
- The original and latest user request are paged; subagent prompts are compacted
  to their task line, worktree paths become `<path>`, and request lines clip on
  sentence boundaries.
- Reasoning is omitted unless there is no assistant text at all.

## Generation and lint

One model call returns `{ answer, opposite, ask }`. The model phrases; it does
not decide whether a reply is needed or what the state is. The lint rejects:

- stale work that is already in `done`
- negative-constraint violations
- approval, permission, or safety bypasses
- meta or procedural text
- generic continuations
- ungrounded text with no entity from the MOMENT block
- wrong length, descriptions instead of messages, a question that is not a
  question, and an opposite that restates the answer

A rejected answer falls back to canned options. A rejected opposite or ask is
dropped; the answer may still be shown. Rejections are recorded on the audit
page and are not cached.

## Feedback

Rate each option as **Useful**, **Not useful**, or **Unsure**. Add an overall
verdict, one or more reason tags, and a free-text note. Tags are intentionally
coarse so the data stays analysable:

| Tag | Meaning |
|---|---|
| `grounded` | The reply names the actual task, file, option, or error. |
| `too_generic` | It would fit any session and does not advance this one. |
| `wrong_task` | It is about a different problem than the transcript. |
| `hallucinated` | It invents a file, option, error, or decision that is not there. |
| `too_long` | It is not glanceable on the glasses. |
| `bad_tone` | It is wrong for the user-agent relationship. |
| `missing_context` | The right reply required information the context dropped. |
| `no_contrast` | All suggestions push one direction; none offers the credible alternative. |
| `unsafe` | A suggestion bypasses an approval, permission, or safety guard. |

Saving stores one JSONL entry in `<dataDir>/reply-feedback.jsonl`, normally
`~/.local/state/oktoso/reply-feedback.jsonl`. Each entry contains the prompt,
context, options, ratings, tags, note, and the raw model output. **Export JSONL**
downloads the full file.

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/sessions/:ref/reply-audit?mode=reply\|choices` | Fresh generation plus prompt, context, and raw output. |
| `GET` | `/api/v1/reply-feedback?limit=100` | Recent feedback, newest first. |
| `POST` | `/api/v1/reply-feedback` | Save one feedback entry. |
| `GET` | `/api/v1/reply-feedback/export` | Download the JSONL file. |

Audit and feedback use the normal hub bearer auth. Provider credentials never
reach the page; it only sees the hub's session data and the reply model's
output.

## Using the data

Read the exported JSONL and compare high-rated and low-rated entries:

1. If `missing_context` dominates, extend the MOMENT block (pending, done,
   constraints, or more evidence) before touching the prompt.
2. If `too_generic` dominates while the moment is sufficient, tighten the
   grounding/specificity lint and add high-rated examples.
3. If `hallucinated` dominates, strengthen the grounding lint against the
   MOMENT block.
4. If `wrong_task` dominates, the gate or state classification is wrong; inspect
   `state`, `kind`, and `pending` first.
5. If `no_contrast` dominates, strengthen the `opposite` role rule.
6. If `too_long` dominates, lower the word limit and trim explanations.
7. If a session that clearly needs a reply gets no suggestions, check the gate
   state and `rejected` reasons; quoted audit text, code, and limitations
   sections are the usual false positives.

Keep the tags stable across gate and prompt revisions so before/after
comparisons stay meaningful.
