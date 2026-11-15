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
  role (`answer`, `opposite`, `next`, `verify`, `extend`, `ask`). The roles are
  labelled `Alt: …`, `Next: …`, `Check: …`, `More: …`, and `Ask: …`.
- a **Pending question** block when the latest assistant message contains a
  provider-native `question` tool part. It shows the question header, full text,
  and every option with its description. Text questions use the same block.

The audit call bypasses the reply cache, so pressing **Generate** gives a fresh
sample. The normal `reply-options` call remains cached. The cache is keyed by
the context digest; concurrent identical requests share one generation, so the
web composer and the G2 reply screen cannot pay for the same model call twice.
Clients may warm the cache before the user asks: the active web session after a
short idle dwell, and an open G2 chat after two seconds.

## Decision gate

The hub classifies the moment before calling the model:

| State | When | Model call |
|---|---|---|
| `reply` | Pending question/approval, failure/blocker, explicit next action, delivery with an offer, or a challenge/direct correction | Yes |
| `wait` | Agent running with no ask | Yes |
| `done` | Finished delivery with no ask or action | Yes |

A direct correction (`No — …`, `Actually …`, `Not quite …`) to a user question
is classified as `challenge`, not `failure`, even when the reply contains words
like `can't` or `isn't`. Genuine failures still win when the user asks why
something failed.

The gate still decides what the moment is, but it no longer decides whether to
suggest. A running or finished turn is still a conversation: the model is asked
for ways to queue context, verify the result, extend it, or move to the next
task. The clients show those suggestions instead of a "no reply needed" notice.

If the reply model is disabled or unreachable, the endpoint returns the canned
actions plus the state, and the clients fall back to that list.

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
  running: shell pnpm test
  evidence:
    assistant: ...
    user: ...
```

- `last_assistant_tail` keeps the first 200 and last 700 characters, cut on
  sentence boundaries. The ask and caveats are at the end of long reports.
- `done` comes from sentences that start with a completed-work word or end with
  one (`fixed`, `pushed`, `passed`, `green`), including a copula form such as
  "the build is green". Fenced code is removed first and multi-sentence lines
  are split so a later instruction is not swallowed. Headings and imperatives
  are not completed work, even when they contain a word like `merged` or
  `passed`.
- `constraints` are full user sentences containing do-not/never/only/keep/
  without. The lint enforces the negative constraints.
- `running` names the live shell or tool and its command, clipped to 120
  characters. It is present only while the session is running, so a `wait`
  moment knows what it is waiting for instead of guessing. Read-only inspection
  commands (`jq`, `grep`, `rg`, `cat`, `sed`, `git status/diff/log`) are
  omitted: they are the agent's internal tooling, not the user's task.
- `latest_turn` is `user` or `assistant`, based on the newest message. A `user`
  turn means the user has just sent an instruction while the run continued; the
  prompt asks for steering or queued messages that refine it, not a repeat of
  `last_assistant_tail`.
- `recommendation` is a short extraction from the assistant's latest text when
  it says "the answer is", "I recommend", "go with", or "that's the answer".
  The prompt treats it as the current plan and asks the model not to replace it
  with a different provider or option unless the user asks.
- Up to three prior text messages are included at 400 characters each as
  evidence. No raw tool output is sent; only the running command.
- `user_goal` is the current request, not the session's first turn. A terse
  acknowledgement (`yes`, `continue`, `thanks`) falls back to the most recent
  substantive user turn, then to the original request. The original request is
  still paged for that fallback and for constraints, so a long session that
  moved on does not keep proposing work on the first turn's files.
- The pending-question scan looks back six sentences, not two, and prefers the
  last question before a later completed-work sentence. A question followed by
  two sentences of explanation is still pending.
- The original and latest user request are paged; subagent prompts are compacted
  to their task line, worktree paths become `<path>`, and request lines clip on
  sentence boundaries.
- Reasoning is omitted unless there is no assistant text at all.

## Generation and lint

One model call returns six fields:

| Field | Intent |
|---|---|
| `answer` | The expected response: answer the question, accept the proposal, or acknowledge the result. |
| `opposite` | The credible alternative: decline, revert, or take a different valid route. |
| `next` | The single most useful concrete next step. |
| `verify` | A check that proves the result holds: tests, the diff, logs, or a rerun. |
| `extend` | A small adjacent follow-up that builds on the result. |
| `ask` | The one question that resolves the most important remaining ambiguity. |

If a full six-field draft still lints down to fewer than four usable options,
the hub makes one bounded repair call for just the missing or rejected roles and
merges the results. The accepted roles are kept unchanged, and the audit raw
output shows both attempts separated by `--- retry ---`. A sparse draft is not
repaired: it is treated as a model failure and falls back to what survived.

The prompt asks for five usable fields and six when every field is distinct. In
`done`, `answer` is a short acknowledgement, `opposite` closes the loop, and
`next`, `verify`, `extend`, and `ask` move the work forward. In `wait`, `answer`
is the natural wait message ("Let it finish."), `opposite` is an interrupt, and
the other fields suggest what to queue, add, or check when the run lands. When
`latest_turn` is `user`, the prompt asks for steering or queued messages that
refine the new instruction instead of repeating the previous answer. The model
phrases; it does not decide whether to suggest or what the state is.

The lint rejects:

- stale work that is already in `done`, for `answer` and `opposite` only, and
  never when the text answers the pending decision — verifying, extending, or
  asking about finished work is the point
- negative-constraint violations, where the suggested text must overlap the
  constraint's object, not just a shared verb
- approval, permission, or safety bypasses
- meta descriptions ("Acknowledge the successful fix…"), procedural text, and
  generic continuations. A short acknowledgement is allowed as the `done`
  answer or close, because "Thanks, looks good." is a real message.
- wrong length, a question that is not a question, a statement that ends in `?`,
  and text that rewords an accepted suggestion. Duplicate detection compares
  Jaccard overlap, and folds action verbs ("run/retry/execute", "use/change")
  when checking whether `next` restates `answer`.
- a question that restates the pending question, or one with no content noun in
  the moment. Sharing only a work verb ("fix", "build", "check") is not enough;
  in `wait`, the question must also touch the running command.
- an invented concrete entity: every number, version, PR, path, filename, or
  backticked token must appear in the MOMENT block. Ordinary new words are
  allowed, so a suggestion is not punished for describing an unmentioned action.

A rejected role is dropped; the remaining options still show. Only an empty set
falls back to canned options. Rejections are recorded on the audit page and are
not cached.

## Prompt check harness

`scripts/reply-prompt-check.ts` runs the real pipeline over six fixture moments
(question, approval, finished delivery, running, failure, and correction) and
writes a reviewable report:

```sh
pnpm exec tsx scripts/reply-prompt-check.ts
# /tmp/opencode/reply-check/report.md
# /tmp/opencode/reply-check/report.json
```

It reads the live reply settings from `~/.local/state/oktoso/state.json` unless
`REPLY_BASE_URL`, `REPLY_MODEL`, or `REPLY_TIMEOUT_MS` override them. Each
fixture goes through the same moment gate, prompt, model call, and lint as the
API, so the report shows accepted chips, rejected candidates and reasons, raw
output, and latency. Run it after any prompt or lint change, then review the
chips as a user would: useful, grounded, distinct, and tappable. A subagent can
score the report against that rubric before the change ships.

## Prior art

The pattern is consistent across chat products and SDK recipes:

- Generation is a separate, cheap call after the main answer, never part of it.
  Open WebUI, the Vercel AI SDK follow-up recipe, and GitHub Copilot extensions
  all do this.
- A short list beats a long one: three to five chips, each under ~80 characters,
  is the common cap. Oktoso keeps six roles and drops any that do not pass lint,
  so the row lands at four to six.
- A rules pass over the last turn decides the shape before the model writes:
  echo offered choices, accept or decline an offer, or generate a fresh next
  question. Oktoso already has this as the moment gate.
- The most common failure is restating the assistant's own question. Products
  that fixed it classify the tail first and tell the generator not to repeat it.
- Grounding is checked against the source material, not left to the prompt.
  Grounded's follow-up feature only suggests questions answerable from the
  citations it retrieved; Oktoso checks concrete entities against MOMENT.

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
