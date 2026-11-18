# Automation

Automation lets the hub act while you are away. It is a rulebook, not a second
agent: each rule is a **watcher**, and every action goes through the provider
API the web app already uses.

It is off by default. Nothing runs until you add `automation` to the hub config
and restart the hub.

If you only want to start a saved session by hand, skip to
[Starting a template](#starting-a-template). You do not need watchers for that.

## The words

| Word | Meaning |
|---|---|
| **Watcher** | One rule: a trigger, an optional condition, and an action. |
| **Template** | A saved New-session form: provider, title, directory, agent, model, first prompt. |
| **Attention** | Something waiting on you: a permission, a question, an approval, an unread session, an error. |
| **Run** | One line of history: what a watcher decided and why. |
| **Approval** | An action the policy would not take without a human. |

A watcher triggers on one of three things:

- `attention` — a new item of the types you name (`question`, `permission`,
  `unread`, `error`, `approval`).
- `session` — a session stays `idle` or `error` for a while.
- `schedule` — every N milliseconds, like a cron job.

It can do one of five things:

- `answer` — choose a safe option on a question.
- `escalate` — ask you instead of acting.
- `notify` — send a push notification.
- `retry` — retry a failed turn.
- `start` — create a session from a template.

## A minimal setup

One template, one rule that starts it every night:

```jsonc
{
  "token": "…",
  "providers": [
    {
      "id": "desktop-opencode",
      "type": "opencode",
      "baseUrl": "http://192.0.2.2:4096",
      "auth": { "kind": "basic", "username": "opencode", "password": "…" },
      "enabled": true
    }
  ],
  "automation": {
    "enabled": true,
    "dryRun": true,
    "templates": [
      {
        "id": "nightly-review",
        "name": "Nightly review",
        "providerID": "desktop-opencode",
        "title": "Nightly review",
        "text": "Review the repository and report the risks."
      }
    ],
    "watchers": [
      {
        "id": "nightly",
        "trigger": { "kind": "schedule", "everyMs": 86400000 },
        "action": { "kind": "start", "template": "nightly-review" }
      }
    ]
  }
}
```

`dryRun` is true here on purpose. The first day records what would happen and
sends nothing.

## Apply it

1. Edit the config. The default is
   `$XDG_CONFIG_HOME/oktoso/hub.config.json` (`~/.config` on most systems), or
   whatever `--config` points at. It must be `0600`.
2. Restart the hub. Automation is read at startup; providers hot-reload, rules
   and templates do not.
3. Check what the hub loaded:

   ```sh
   npx @amoshydra/oktoso automation status
   npx @amoshydra/oktoso template list
   ```

4. Watch Settings → Automation → Recent runs for a day. Each run says `Dry
   run` and what it would have done.
5. Arm it. Set both `automation.dryRun` and each watcher's `dryRun` to `false`
   (a watcher only acts when both are off).

If the config is wrong, the hub now refuses to start with the file and field:

```
/hub.config.json is not valid:
  automation.templates[0].providerID: Invalid input: expected string, received undefined
Fix the field above and restart the hub.
```

## Safety switches

- **Two dry runs.** The hub switch and the watcher switch. Both must be off for
  an action to send.
- **Pause all, or pause one watcher.** Settings → Automation, or
  `oktoso automation pause [--watcher <id>]`. Pausing also aborts an action
  already in flight inside the hub. A request that already reached the
  provider may still finish; sends are idempotent.
- **Budgets.** Actions per hour and per day, globally and per watcher. There is
  no token budget, because a turn's cost is only known after it runs.
- **Approvals.** Anything risky becomes a card in Settings and the Inbox.
  Approve executes the prepared action; Deny does nothing. Cards expire after
  24 hours by default.
- **Always allow.** For a question pattern you approve twice, the hub remembers
  the exact options and chosen label. Revocable. Free text, multi-select,
  destructive, and sensitive choices never auto-answer.
- **Quiet hours.** During the window, `answer` and `retry` escalate instead of
  acting. `start` and `notify` are unaffected.

## Starting a template

A human can start one at any time. This is not a watcher action, so pause, dry
run, budgets, and quiet hours do not apply, and no run is recorded.

- **Settings → Automation → Templates → Start.** The session opens with the
  first prompt sent.
- `npx @amoshydra/oktoso template start --id nightly-review`
- `POST /api/v1/automation/templates/<id>/start`

If the session is created but the first prompt fails, the error names the new
session and is not retryable, because a retry would create a second one. The
Settings panel offers **Open session** instead.

## Where things live

| Surface | What you do there |
|---|---|
| `hub.config.json` | Define providers, watchers, templates, budgets, quiet hours. The UI never edits it. |
| Settings → Automation | Pause, toggle dry run, pause a watcher, start a template, approve or deny, revoke an allowed shape, read recent runs. |
| Inbox | Approvals appear as cards with the same actions. |
| CLI | `automation status|pause|resume`, `template list|start`. |
| HTTP API | The same, for scripts. See `docs/openapi.yaml`. |
| Even G2 | Approvals can be approved or denied from the glasses. |

## What automation is not

- **It does not use a model to decide.** The policy is deterministic: five
  actions, an allowlist of safe shapes, budgets, and approvals. Reply
  suggestions in the composer use a model, but they are advisory and you send
  them.
- **It does not edit config.** There is no rule builder. Add rules to the file
  and restart.
- **It does not run agent processes on the hub.** It calls provider APIs.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `Unable to start Oktoso: … is not valid` | The message names the field. Fix it and restart. |
| Automation shows `off` | `automation.enabled` is false, or the hub was not restarted. |
| A watcher never fires | Check its trigger type and condition. A schedule watcher with no `condition.sessionRef` only works for `start`. Dry run still records runs. |
| `Could not start X: Provider not found: Y` | The template names a provider id that is not in `providers`, or the provider is disabled. |
| A run says "No safe answer was available" | The question had no low-risk explicit choice, so the policy escalated. That is the intended behavior. |
| An approval disappeared | It expired (`approvalTtlMs`, 24h by default) or a newer run replaced it. |
| Nothing sends even though dry run is off | The watcher's own `dryRun` is still true, or the hub is paused, or quiet hours escalated the action. |

The full field list and the acceptance runbook are in
[`deployment.md`](deployment.md#automation).
