# Session assistant: context spikes

Status: research. No production path was changed by this document; the code it
compares lives in `scripts/spike-context.mjs`.

Question: the session assistant could not answer questions about the session.
Was the cause the context it was given, and what is the cheapest way to fix it
while keeping the hub's own model and the persisted thread?

## Setup

- Session: a private 198-turn session (ref withheld), 53 tool calls, ~176 KB
  of content (5.5 KB prose, 46 KB reasoning, 9 KB tool input, 115 KB tool
  output).
- Model: the configured hub assistant, `local-model-…` on llama.cpp, one
  endpoint, no provider-side generate.
- Each question ran four ways, same system prompt, temperature 0.2.

Strategies:

| Name | What the model receives |
|---|---|
| `digest` | The old builder: prose only, tool calls as one-line strings, 48 KB budget (generous: production read 20 messages) |
| `full` | The new builder: prose, reasoning, tool input and output, 48 KB budget, newest turns first |
| `agent` | Session facts only, plus four read-only tools: `search_transcript`, `read_turns`, `list_tool_calls`, `read_tool_output`; up to 6 rounds, last round tools off |
| `hybrid` | The full context as the opening message, plus the same tools |

Four questions, three answerable only from tool evidence:

1. **Schema** — the columns of the `part` table in the OpenCode sqlite schema (turn 9).
2. **Failed edit** — which `edit` call errored, where, and why (turn 101).
3. **Version** — the `package.json` version (turn 17, repeated at turn 167).
4. **Last change** — the most recent activity-block change and its reason.

## Results

`hit` = the answer contained the fact. One run per cell; timings on a shared
local endpoint are noisy, so read them as a range, not a benchmark.

| Question | digest | full | agent | hybrid 48k | hybrid 12k |
|---|---|---|---|---|---|
| Schema | miss | miss (honest) | **hit**, 4.4 s, 5.6k in, 3 steps | hit, 9.6 s, 42.7k in, 3 steps | hit, 10.3 s, 36.2k in, 4 steps |
| Failed edit | miss | **miss, confident and wrong** | **hit**, 7.6 s, 2.8k in, 3 steps | hit, 8.5 s, 40.2k in, 3 steps | hit, 9.9 s, 34.8k in, 4 steps |
| Version | miss | hit, 8.0 s, 12.6k in, 1 step | **hit**, 7.0 s, 22.0k in, 4 steps | hit, 3.3 s, 27.2k in, 2 steps | hit, 9.0 s, 33.6k in, 4 steps |
| Last change | answer | answer | answer, 10.9 s, 14.6k in, 5 steps | answer, 20.0 s, 65.1k in, 4 steps | answer, 26.4 s, 40.7k in, 4 steps |

Prompt tokens are the sum over steps; each round re-sends the conversation.

## Findings

1. **The digest cannot answer evidence questions.** 0/3. It knows a command
   ran; it does not know what it printed. This was the complaint, confirmed.

2. **A fixed window is better, but it fails the same way at the boundary, and
   worse: it confabulates.** Asked about the failed edit, `full` did not say
   "not in the window". It found a *different* edit that looked wrong and
   described it as the failure. It never read "No changes to apply: oldString
   and newString are identical" because turn 101 sits outside the retained
   turns 165–197. A model that is told "say what is missing" still guessed,
   because the window looked complete. This is the most dangerous result:
   the fixed window trades a visible gap for an invisible one.

3. **Tools answer what the window cannot, and cheaper.** `agent` passed 3/3
   with 2.8–22k prompt tokens — the lowest of any strategy — because it starts
   with facts, not 48 KB of transcript, and reads only the turns it needs.

4. **A hybrid is the most expensive, not the best.** Re-sending the window on
   every tool round cost 27–65k tokens and up to 26 s. A 12 KB window is still
   34–41k tokens. The window does not pay for itself once tools exist, except
   for the trivial recent-fact case, where a 1-step `full` (8 s, 12.6k) beats
   a 4-step agent (7 s, 22k) only marginally.

5. **A tool loop needs a governor.** Without one, the open-ended question
   burned 6 rounds and returned "(stopped at max steps)". With a final round
   that removes the tools and asks for the answer, it answered in 5 rounds.
   Bounded steps, capped tool results (6 KB here), and a forced final answer
   are not optional.

6. **Reasoning is useful.** The reasoning parts held the rationale the prose
   omitted ("why this cap", "why before the answer"). Both `full` and the tools
   read them; `digest` never did.

## Recommendation

Keep the hub model and the thread. Change what the model is given:

1. **Opening message: session facts + the last one or two turns.** Not a
   48 KB window. The current turn gives continuity; everything older is one
   tool call away.
2. **Read-only tools, scoped to the thread's scope:**
   - `search_transcript(query, limit)` — literal search over prose, reasoning,
     tool input, and tool output, returning turn numbers and snippets.
   - `read_turns(from, to)` — full turns, capped.
   - `list_tool_calls(status?)` — the index the model needs to find a call.
   - `read_tool_output(turn, index)` — paginated output.
   All results are untrusted data, redacted, and capped per call.
3. **Governor:** 5 rounds, ≤ 3 tool calls per round, ≤ 24 KB of tool results
   per run, and a final round with tools disabled plus "answer now".
4. **Activity:** each tool call becomes a `RunTrace` step (kind `tool`, label
   `search_transcript`, metric `3 hits`), so the dock shows the retrieval it
   actually performed. The trace and the shared renderer already support this.
5. **Fast path:** a question that the last two turns can answer should not pay
   for tools. Start with 0 tools available if the thread is empty? No —
   simpler: always allow tools, but the model usually answers in one step when
   the opening is enough. Measure before adding routing heuristics.

Expected cost: 3–5 model calls per question, 3–22k prompt tokens, 4–11 s on
this endpoint — cheaper than the current single 48 KB call, and correct where
the current one is confidently wrong.

## Limits

- One session, one model, one run per cell. Timings vary ±2× on the shared
  endpoint (one digest call took 59 s).
- `expect` regexes are a crude quality measure; the open-ended question is
  judged by reading, not scored.
- The `agent` strategy executes tools in the script, not in the hub. Production
  needs the same tools through the service layer, with the existing audit and
  redaction.
- Larger models or a real prompt cache change the cost balance; the accuracy
  ordering (tools > full > digest) should hold, the token ordering may not.

## Reproduce

```sh
node scripts/spike-context.mjs --list
node scripts/spike-context.mjs --session <ref> --suite scripts/spike-questions.json
node scripts/spike-context.mjs <ref> "question" --strategy agent
node scripts/spike-context.mjs <ref> "question" --strategy all --json
```

Options: `--session`, `--budget`, `--limit`, `--max-steps`, `--model`,
`--base-url`, `--dry-run` (prints the assembled context, no model call).
The suite file carries questions only; the session ref is passed at run time.
