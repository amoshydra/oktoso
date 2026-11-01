# MCP northbound — OpenCode controls Oktoso

Status: experiment. The `oktoso mcp` stdio bridge is implemented and tested
against the hub API. A hub-hosted `/mcp` endpoint with scoped tokens is the
next step.

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
- **Audit.** Hub request logs record the API calls. Per-tool audit with the
  calling agent identity is part of the `/mcp` follow-up.

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

## Follow-ups

- Hub-hosted `/mcp` over Streamable HTTP.
- Scoped MCP tokens, per-tool and per-provider allowlists.
- Per-tool audit with the OpenCode session ID.
- Rate limits and timeouts.
- Event subscription instead of polling `attention_list`.
- A controller agent template in the repository.
