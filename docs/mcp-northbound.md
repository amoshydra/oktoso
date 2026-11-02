# MCP northbound — OpenCode controls Oktoso

Status: Phase 2a and 2b verified. The `oktoso mcp` stdio bridge and the
hub-hosted `/mcp` Streamable HTTP endpoint are implemented and tested against
the fake hub with the official MCP SDK and real OpenCode clients. Hosted
tokens carry write, provider, tool, rate, and timeout scopes, and tool calls
are audited. OAuth and event subscription remain follow-ups.

## Goal

Let an external agent, starting with OpenCode, use Oktoso as its control plane:

1. See attention across providers.
2. Read the session behind an item.
3. Answer a question or approve a permission.
4. Send a prompt, create a session, or interrupt a run.

Oktoso stays the source of truth for provider access, credentials, attention,
and events. The agent only sees normalized Oktoso data and tools.

## Why stdio first

OpenCode supports local MCP servers over stdio and remote servers over
Streamable HTTP. The stdio bridge is the smallest useful slice:

- It reuses the existing hub config, token, and REST API.
- It adds no new network listener or auth surface to the hub.
- It validates the tool surface and the control loop before committing to a
  remote transport.

The trade-off is that the bridge must run where the hub config is readable. A
hub-hosted `/mcp` endpoint is the follow-up for remote controllers and scoped
tokens.

## Usage

Read-only is the default:

```sh
oktoso mcp
```

Enable the write tools:

```sh
oktoso mcp --allow-write
```

The bridge reads the hub config, resolves the hub URL from the config
(`HUB_URL` or `--url` can override it), and authenticates with the config token.
It speaks MCP over stdio; diagnostics go to stderr so stdout stays a clean
JSON-RPC channel.

From this repository:

```sh
pnpm exec tsx packages/hub/src/main.ts mcp --allow-write
```

## OpenCode setup

Add the bridge as a local MCP server:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "oktoso": {
        "type": "local",
        "command": ["npx", "@amoshydra/oktoso", "mcp", "--allow-write"],
      },
    },
  },
}
```

For the repository build, use the local command instead:

```jsonc
{
  "mcp": {
    "servers": {
      "oktoso": {
        "type": "local",
        "command": [
          "pnpm",
          "exec",
          "tsx",
          "packages/hub/src/main.ts",
          "mcp",
          "--allow-write",
        ],
        "cwd": "/absolute/path/to/oktoso",
      },
    },
  },
}
```

Check the connection:

```sh
opencode mcp list
```

## Hosted `/mcp`

The hub can host the same tool surface over MCP Streamable HTTP. Enable it in
the hub config and add at least one client token:

```jsonc
{
  "mcp": {
    "enabled": true,
    "tokens": [
      {
        "id": "controller",
        "token": "${MCP_TOKEN}",
        "allowWrite": true,
        "providers": ["desktop-opencode", "openwebui"],
        "tools": [
          "providers_list",
          "sessions_list",
          "sessions_messages",
          "attention_list",
          "sessions_send",
          "attention_act"
        ],
        "rateLimit": { "windowMs": 60000, "max": 120 },
        "timeoutMs": 60000
      }
    ],
    "audit": { "enabled": true }
  }
}
```

The endpoint is `http://<host>:<port>/mcp`. Every request needs
`Authorization: Bearer <token>`. Sessions are stateful: the initialize
response carries `Mcp-Session-Id`, and later requests must repeat it. A session
is bound to the token that created it.

Token rules:

- `allowWrite` defaults to false. Write tools are hidden without it.
- `providers` limits both listings and refs. Omitting it allows every provider.
- `tools` limits the registered tool names. Omitting it allows every tool in
  the token's write scope.
- `rateLimit` is a per-client fixed window; `timeoutMs` bounds one tool call.
- Tokens are compared by SHA-256 digest in constant time and are never logged.

The server rejects browser origins that are neither same-origin nor listed in
`cors`, caps request bodies at 1 MiB, and allows five concurrent sessions per
client. Idle sessions expire after `sessionTtlMs` (default 30 minutes), and at
most `maxSessions` are kept (default 50).

### Audit

Hosted tool calls append JSONL to `mcp.audit.file`, default
`<dataDir>/mcp-audit.jsonl`:

```json
{"time":"2026-11-03T02:35:50.937Z","clientId":"controller","tool":"sessions_send","ok":true,"durationMs":4,"target":"desktop-opencode:ses_auth"}
```

Failed calls include the caller's OpenCode session ID when present and a short
error. The log records tool names and targets, never prompts, message text, or
tokens. Set `audit.enabled` to false to turn the file off.

### OpenCode remote config

```jsonc
{
  "mcp": {
    "servers": {
      "oktoso-hosted": {
        "type": "remote",
        "url": "http://127.0.0.1:8787/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer {env:MCP_TOKEN}"
        }
      }
    }
  }
}
```

OpenCode substitutes `{env:MCP_TOKEN}` from the environment of its background
service, not from the shell that runs `opencode mcp list`. Restart the service
with the variable present, or use a literal token in a scratch config.

## Tools

Read-only:

| Tool | Purpose |
|---|---|
| `providers_list` | Provider IDs and status |
| `providers_check` | Live health check for one provider |
| `sessions_list` | Sessions with provider, status, query, and cursor filters |
| `sessions_get` | One session by ref |
| `sessions_messages` | Paginated transcript |
| `attention_list` | Permissions, approvals, questions, unread, and errors |
| `questions_get` | Pending question with choices and risk |

Write (`--allow-write`):

| Tool | Purpose |
|---|---|
| `sessions_send` | Send a prompt or answer; accepts an idempotency key |
| `sessions_create` | Create a session |
| `sessions_interrupt` | Stop the current run |
| `sessions_mark_read` | Clear unread state |
| `attention_act` | Run an action listed on an attention item |

## Controller policy

Use this as the starting prompt for an OpenCode agent:

```text
You are the Oktoso controller. Your job is to keep other sessions moving.

At the start of each turn:
1. Call attention_list.
2. For each blocking item, read the session with sessions_messages and, for a
   question, questions_get.
3. Answer with sessions_send. Use a stable idempotencyKey for each target and
   answer.
4. Approve a permission only when the command is clearly safe. Deny destructive
   or sensitive commands unless the user explicitly approved them. Pass
   confirm: true only after that check.
5. Never act on the session that invoked you.
6. Prefer mark_read or a reply over interrupt.

Report what you changed and what you escalated.
```

## Safety

- **Read-only default.** Write tools are not registered without
  `--allow-write`.
- **No self-control.** The server compares the target ref with OpenCode's
  `_meta["ai.opencode/sessionID"]` and rejects writes to the caller's session.
- **Approval confirmation.** `attention_act` requires `confirm: true` for
  allow/approve actions and for attention text that looks destructive or
  sensitive. Denials and mark-read do not require confirmation. This is a
  deliberate agent step, not a human approval; a policy layer that requires a
  human for destructive actions is a follow-up.
- **Idempotency.** `sessions_send` accepts an idempotency key and passes it to
  the hub's existing idempotency layer.
- **No secrets.** The bridge never sends provider credentials to the agent.
- **Audit.** Hub request logs record the REST calls. Hosted `/mcp` also appends
  one JSONL entry per tool call with the client ID, tool, target, caller session
  ID, status, duration, and a short error. Prompts and message text are not
  logged.

## Acceptance

The first slice is done when:

1. OpenCode connects and lists the read tools.
2. `providers_list` and `sessions_list` return live hub data.
3. `attention_list` shows a pending question from another session.
4. `questions_get` returns its choices and risk.
5. `sessions_send` answers it, and the attention item clears.
6. `sessions_send` to the caller's own session is rejected.
7. `attention_act` refuses an approval without `confirm: true`.
8. Read-only mode exposes no write tools.

The live fixture exercises the provider-form path for items 3–5. The
parsed-message question path is covered by the existing unit tests but needs a
fixture with a real question message for a live run.

## Verification

Verified on 2026-11-03 against the fake OpenCode/Open WebUI/Hermes dev hub with
the official MCP SDK stdio client and a real OpenCode v2.1.4 client:

- read-only mode exposes the seven read tools and no write tools;
- `providers_list` returns all three fake providers;
- `sessions_list` returns a paginated session page;
- read-write mode exposes all twelve tools;
- `sessions_send` accepts an idempotency key and sends to a fake session;
- `_meta["ai.opencode/sessionID"]` rejects writes to the caller's own session;
- `attention_act` answers a pending form and the attention item clears;
- `attention_act` refuses an approval action without `confirm: true`, accepts it
  with `confirm: true`, and the permission item clears.

OpenCode v2.1.4 with a project-scoped `mcp.servers` entry reports
`oktoso connected` in `opencode mcp list`. A read-only agent session then called
`tools.oktoso.providers_list()` and `tools.oktoso.sessions_list()` through Code
Mode and returned `providers=3` and `sessions=6`. The operator's global config
was not modified; the test used a scratch project config and its own hub token.

Hosted `/mcp` was verified with the official `StreamableHTTPClientTransport`
and a real OpenCode v2.1.4 remote client:

- initialize returns `Mcp-Session-Id`; missing auth returns 401, a disallowed
  origin 403, an unknown session 404, and an exceeded rate limit 429;
- the read token exposes seven tools; the write token exposes twelve;
- a provider allowlist filtered the three fake providers to two and hid
  `rpi-hermes`;
- `sessions_send`, self-control rejection, the approval confirmation gate, and
  a confirmed attention action all passed;
- the audit file wrote one JSONL entry per call with client ID, tool, target,
  caller session ID, status, and duration;
- OpenCode called `tools["oktoso-hosted"].providers_list()` and returned
  `providers=3`.

The automated suite covers the hosted config, provider/tool policy, rate limit,
audit format, session lifecycle, auth/origin rejection, and tool calls in
addition to the stdio tests. `pnpm typecheck`, `pnpm test`,
`pnpm build:hub`, `pnpm openapi:check`, and `pnpm brand:check` pass.

Not covered live: `questions_get` returned null for the fake form fixture,
because question prompts are parsed from the latest session message and that
fixture only seeds a provider form. Add a fixture with a real question message
to exercise the parse-and-answer path end to end.

## Follow-ups

- OAuth 2.1 with dynamic client registration and token rotation, so remote
  clients do not need a static bearer header.
- Event subscription and MCP resources instead of polling `attention_list`.
- Persistent or distributed session state and rate limiting for multi-hub
  deployments.
- Audit rotation and retention, plus a token management CLI.
- A fixture with a real question message to exercise `questions_get` live.
- A controller agent template in the repository.
