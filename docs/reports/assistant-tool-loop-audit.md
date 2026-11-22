# Session assistant: tool-loop audit

Status: measurement. The shipped configuration was chosen from this run; the
runner is `scripts/spike-context.mjs`.

Question: now that the session assistant reads its transcript through tools,
which knobs actually improve it — tools, context, prompt, or reasoning?

## Setup

- Session: a private 121-turn session (ref withheld), 151 tool calls, ~356 KB
  of tool output, one failed `edit` at turn 38, test runs at turns 69–71 and
  103–112.
- Model: the configured hub assistant (a local instruct model), temperature
  0.2, four rounds unless stated.
- Four questions, all answerable only from tool evidence:
  1. which edit failed, where, and what it said;
  2. how many tests passed at the first failure;
  3. how many tests pass in the most recent full run;
  4. what the last `git log` said about the signature.
- One run per cell. Timings on a shared endpoint vary; read them as direction,
  not benchmark.

## Configurations

| | Opening | Tools | Reasoning | Prompt | Rounds |
|---|---|---|---|---|---|
| A | facts + call index | all four | off | default | 4 |
| B | same | same | **on** | default | 4 |
| C | same | same | off | **strict** | 4 |
| D | same | same | off | **terse** | 4 |
| E | same | **search only** | off | default | 4 |
| F | **facts + 8 KB recent turns** | same | off | default | 4 |
| G | same as A | same | off | default | **2** |

## Results

| | Hits | Time | Prompt tokens | Output tokens | Steps | Tool calls |
|---|---|---|---|---|---|---|
| **A baseline** | **4/4** | **10.8 s** | **21.2k** | 750 | 13 | 9 |
| B thinking on | 4/4 | 18.3 s | 19.2k | 1737 | 11 | 10 |
| C strict prompt | 4/4 | 11.1 s | 19.0k | 840 | 13 | 9 |
| D terse prompt | 4/4 | 20.2 s | 49.2k | 789 | 15 | 11 |
| E search only | **2/4** | 11.7 s | 22.8k | 753 | 12 | 8 |
| F recent 8 KB | 4/4 | 18.2 s | 51.2k | 655 | 11 | 7 |
| G two rounds | **1/4** | 7.9 s | 8.3k | 489 | 8 | 4 |

## Findings

1. **All four tools are load-bearing.** With search only (E), the model could
   see `[tool edit · error]` but not the error text, and it read a per-file line
   (`22 tests | 2 failed`) as the suite total, answering "20 passed". Search
   finds; it does not read.
2. **Four rounds is the floor, not padding.** Two rounds (G) answered 1/4. The
   pattern is list → read → read: identify the call, open the output, and
   confirm the number. A three-round budget would be the risky minimum; four
   leaves room for one miss.
3. **Reasoning costs, it does not pay.** Thinking on (B) was 70% slower and
   2.3× the output tokens for the same 4/4. On this task, tool choice is easy
   once the transcript is indexed; the model does not need a reasoning pass.
4. **A stricter prompt is neutral.** C matched A on accuracy and was marginally
   cheaper on input. The default prompt is not the limiting factor.
5. **A terse prompt is worse.** D cost 2.3× the input tokens and 2× the time,
   with more calls and steps: with less instruction it searched more, not less.
6. **A recent-turn window is not worth it.** F answered the same, for 2.4× the
   input tokens and 70% more time. The tool opening is enough; pasting turns
   pays again on every round.
7. **Cost is small at the right setting.** A averaged 5.3k prompt tokens and
   3.3 rounds per question. The production caps (6 KB per result, 24 KB per
   run) never bind on this session.

## Decision

Keep A, which is what shipped:

- facts + a newest-calls index, no transcript in the prompt;
- all four tools, including `read_tool_output`;
- reasoning off, temperature 0.2;
- the default prompt (the tool rules are already directive);
- four rounds, three calls per round, 6 KB per result, 24 KB per run, forced
  final answer.

Do not add a recent-turn window, do not reduce the round budget, and do not
turn reasoning on by default. Revisit only if the model changes or if the tools
start returning whole files instead of turns.

## Limits

- One session, one model, one run per cell; ±2× timing noise on the shared
  endpoint.
- The four questions reward retrieval specifically. A question answerable from
  the session index would not separate the configs.
- The runner executes tools in the script, not the hub; the hub adds audit,
  redaction, and the session budget (three sessions) on top.
- The runner still fetches 200 messages. Production now pages to 2,000
  (G22), so a rerun of this audit could use deeper evidence.

## Reproduce

```sh
node scripts/spike-context.mjs \
  --session <ref> --suite scripts/spike-questions-glass.json \
  --strategy agent --max-steps 4 --thinking off --json
```

Knobs: `--thinking on|off`, `--temperature`, `--opening facts|recent`,
`--recent-budget`, `--toolset full|search|read`, `--prompt default|strict|terse`,
`--max-steps`.

## Re-run after the retrieval changes (2026-11-22)

The live session this suite targets has grown from 121 to 198 turns, so the
historical expectations (110 / 112 tests) no longer describe it. Two runs
against the current snapshot, same four questions, same model and settings:

| Suite | Hits | Time | Prompt | Output | Steps | Calls |
|---|---|---|---|---|---|---|
| historical expectations | 1/4 | 24.1 s | 45.4k | 868 | 16 | 12 |
| current-snapshot expectations | **4/4** | **20.9 s** | **39.7k** | 761 | 16 | 12 |

The 1/4 is suite drift, not a regression: the model answered 53 passed at the
first failure and 426 in the most recent full run — both correct for the
current session — and reported that the last `git log` showed no signature.

Caveat: `spike-context.mjs` still runs its own copy of the pre-paging prompt
and tools, so this measures the model and the session, not the shipped `offset`
paging or the on-demand back-fill. A production-loop runner is the next step.

## Production runner (2026-11-23)

`scripts/bench-assistant.mjs` drives the shipped loop instead of the spike's
private copy: it creates a hub assistant thread, asks the suite, and reads the
recorded answer, usage, activity, and tool calls through the API. That makes it
the honest check for prompt, paging, and back-fill changes.

    node scripts/bench-assistant.mjs --free --suite questions.json

- `--free` picks a visible session with no assistant thread; `--session <ref>`
  targets a named one and refuses to reuse an existing thread unless `--append`
  is passed (those turns stay in the user's history).
- The runner deletes the thread it created (`--keep` leaves it for inspection).
- `--json` returns answers for scoring; the console prints PASS/MISS plus
  latency, input tokens, and tool calls.
- Questions that instruct the session ("send OK") can produce an action card
  instead of prose; benchmark suites should ask about the transcript.
