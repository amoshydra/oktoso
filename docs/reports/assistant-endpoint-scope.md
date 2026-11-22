# Assistant endpoint settings — scope

Status: proposed. Owner: next slice after `design-v1.35`.

## Problem

The assistant's model list and endpoint are config-file only. Changing either
means editing `hub.config.json` and restarting the hub, and the dock's model
menu can only show whatever `/v1/models` returns from that one endpoint. There
is no way to point the assistant at a different OpenAI-compatible gateway, add
an API key, or test the endpoint from the product.

The model list is therefore correct but confusing: it shows local llama.cpp
models while the session's own model selector shows provider models. The menu
now names its source (`Models from <host>/<path>`); this slice makes the source
editable.

## Goals

1. Edit the assistant's endpoint from Settings: enabled, base URL, model, API
   key, timeout, context-message cap, and the write switch.
2. Load models from the configured endpoint and test the connection without a
   restart.
3. Make the dock's model menu reflect the effective endpoint immediately, and
   link to the settings panel.
4. Keep the config file as the bootstrap/fallback for fresh installs.

## Non-goals

- Provider-backed assistant models (OpenCode/Hermes/Open WebUI session models).
- Multiple endpoints or per-model endpoints; one endpoint at a time.
- Automatic failover, retries across endpoints, or load balancing.
- Cloud OAuth flows.
- Changing the per-thread model override behaviour.
- Multi-user or per-user endpoints.

## What exists today

| Piece | Today |
|---|---|
| `assistant` block in `hub.config.json` | `enabled`, `baseUrl`, `model`, `timeoutMs`, `maxContextMessages`, `allowWrite` |
| `AssistantService` | takes that block as a snapshot at boot (`main.ts`) |
| `GET /api/v1/assistant/models` | fetches `${baseUrl}/models`; no key, no test |
| Settings → Assistant | panels for **Reply assistance** and **Voice transcription**, both runtime settings with masked keys |
| Dock model menu | lists the endpoint's models; shows the source host/path |

The reply/transcription panels already prove the pattern: runtime settings in
`state.settings`, masked API keys, a model list, save-in-place.

## Design

### Settings panel

Add a third Assistant panel, **Assistant agent**, above Reply assistance.

```
┌───────────────────────────────────────────────────────────────┐
│ Assistant agent                                   [key saved]│
│ The model that answers Ask threads. Separate from reply       │
│ suggestions and voice transcription.                          │
│                                                               │
│ [x] Enable the assistant                                      │
│ [x] Allow confirmed writes   ⚠ actions still need confirmation│
│                                                               │
│ OpenAI-compatible base URL                                    │
│ [http://127.0.0.1:8080/v1                                 ]  │
│                                                               │
│ Model                           Context messages              │
│ [local-model              ▾]    [20                        ]  │
│                                                               │
│ Timeout (ms)                    API key                       │
│ [90000                      ]   [•••••••• (saved, blank keeps)]│
│                                                               │
│ [Load models] [Test connection]              [Save assistant] │
│ status line: "Loaded 6 models from …" / "Endpoint returned 401"│
└───────────────────────────────────────────────────────────────┘
```

- **Load models** fills a datalist for the model field; the field stays free
  text so an endpoint that does not implement `/models` still works.
- **Test connection** sends a tiny completion (`max_tokens: 1`) and reports
  the status, model, and latency. It does not save.
- **Save** persists; the assistant uses the new endpoint on the next run.
- The write toggle carries the existing warning: writes are confirmed in the
  thread, never automatic.
- Validation: http/https URL, model non-empty when enabled, timeout 5–600 s,
  context 4–60, `allowWrite` only meaningful when enabled.

### Dock

- The model menu already shows `Models from <host>/<path>`. Add one quiet
  footer link, **Change endpoint**, to Settings → Assistant agent.
- After a save, reopening the dock (or its model menu) shows the new list. No
  hub restart.
- A thread model override that no longer exists on the new endpoint fails the
  run with the existing model-unavailable copy and keeps the thread usable.

### Data and contracts

Extend the runtime settings rather than inventing a second store:

```ts
zAssistantAgentConfig = {
  enabled: boolean,
  baseUrl: string,
  model: string,
  apiKey?: string,
  timeoutMs: number,           // 5_000..600_000
  maxContextMessages: number,  // 4..60
  allowWrite: boolean,
}

zAssistantConfig = { agent, reply, transcription }
zAssistantView.agent = { …config, hasApiKey }
zAssistantInput.agent = { …partial, apiKey: string | null }
```

`DEFAULT_ASSISTANT_CONFIG.agent` starts empty/disabled. At boot, if runtime
`agent` has never been set, seed it from `config.assistant` (one write). Config
remains the fallback when the store has no value. Precedence, once seeded:
**runtime settings win; the config file no longer changes the assistant until
the runtime value is cleared/reset.**

### API

| Route | Purpose |
|---|---|
| `GET /api/v1/settings/assistant` | now includes `agent` (masked key) |
| `PUT /api/v1/settings/assistant` | accepts `agent` partial; `apiKey: null` clears |
| `GET /api/v1/settings/assistant/agent/models` | lists models with the saved key |
| `POST /api/v1/settings/assistant/agent/test` | optional: tiny completion, returns status/latency/model |
| `GET /api/v1/assistant/models` | unchanged shape; reads the effective agent config |

`AssistantService` must read the effective config through a getter (or a
`config()` callback) so a save applies without restarting. Its per-run model
resolution becomes: thread override → settings.model → config.model.

### Security and operations

- The API key is stored in `state.json` (mode 0600) like the reply and
  transcription keys; it is never returned by the API, logged, or echoed in
  errors.
- Only `http:` and `https:` URLs are accepted. Redirects are not followed
  (or are capped to one same-origin hop) so a configured endpoint cannot be
  turned into an arbitrary fetch.
- The request still has the configured timeout; a slow endpoint fails the run
  with the existing model-unavailable copy.
- The feature is owner-only: `/api/v1/settings/*` is already behind the owner
  credential.
- No secrets in model ids or error bodies; the source-label helper prints only
  host and path.

### Migration and compatibility

- Existing deployments: first boot seeds runtime `agent` from
  `config.assistant`; threads and actions are untouched.
- Clearing all agent fields returns the assistant to the config fallback (or
  disables it if the config is empty).
- Threads with a model override keep it; if the new endpoint lacks that model,
  the run error is explicit and the composer stays usable.
- No change to scopes, actions, audits, or the evidence line.

## Tests

| Level | Case |
|---|---|
| Unit | view/input roundtrip for `agent`; key masking and clear; URL/timeout/context validation |
| Unit | boot seeds from config once; runtime value wins; clearing falls back |
| Unit | `listModels` sends the saved key; 401 surfaces as a readable error |
| Unit | a run uses the new baseUrl/model after a settings update (no restart) |
| Unit | per-thread override still beats the settings model |
| E2E | Settings panel saves a second fake endpoint; the dock lists its models; an ask reaches that endpoint with the key; another ask after switching back works |
| E2E | invalid URL shows a field error and does not save; Test connection reports failure without saving |

## Acceptance

1. From Settings, set a base URL and key for a second OpenAI-compatible
   endpoint, Save, open the dock: the model menu lists that endpoint's models
   and names it as the source.
2. Ask a question without restarting: the second endpoint receives the request
   with the key, and the answer renders with activity steps.
3. Switch back to the original endpoint: the next ask uses it; no restart.
4. An invalid URL or a failing test is visible and does not persist.
5. With the assistant disabled, the Ask entry disappears; with writes off, the
   footer reads read-only and no action tool is offered.

## Sequencing

1. Contracts + state defaults + `AssistantSettingsService` agent support.
2. `AssistantService` effective-config getter and per-run resolution.
3. Settings routes (`agent` models; optional test).
4. Settings panel and dock link; docs.
5. Tests, brand refresh, release note.

## Open decisions

1. **Runtime wins vs config wins.** Recommended: runtime wins after the first
   seed; config only bootstraps. The alternative (config wins) makes the UI a
   silent no-op for config-managed installs.
2. **Test button semantics.** A one-token completion is the honest test; a
   `/models` probe only proves reachability. Recommended: completion.
3. **Where allowWrite lives.** Same panel (recommended) vs a separate
   "capabilities" section. Same panel keeps one save and one warning.
4. **Multiple endpoints.** Not now. If it ever lands, it is a profile list, not
   more fields in this panel.
5. **Key at rest.** State is 0600 and unencrypted today, matching reply and
   transcription. Encrypting one key and not the others would be worse.
