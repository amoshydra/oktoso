# Remote and multi-host deployment

Status: in progress. One hub can reach providers on other machines. This does
not cover multiple hubs sharing state or clustering.

## Topology

```text
browser / G2 / MCP agent
          |
          v
   Oktoso hub (Pi, VPS, Termux, Docker)
      |          |           |
      v          v           v
  OpenCode    Open WebUI   Hermes
  laptop      HTTPS        Pi
```

Oktoso is a control plane. It connects out to configured provider URLs. It does
not create tunnels, terminate TLS, or discover providers. The operator owns
reachability.

## What works

- Any provider `baseUrl` with `http://` or `https://`.
- Basic auth for OpenCode and Hermes, bearer auth for Open WebUI.
- Multiple providers of the same type, distinguished by `id`.
- Per-provider `timeoutMs` for health checks and session/attention sync.
- Background health checks with exponential backoff.
- Provider status changes are published on the event stream, so open clients
  update without a manual refresh.
- Per-provider isolation: one offline host does not stop the others from
  listing sessions or attention.
- Provider add/edit from the Providers screen, or hand-edited config.
- Config and state persistence across restarts. Sessions are re-fetched from
  providers; read markers, drafts, and attention state live in `dataDir`.

## Hub config

```jsonc
{
  "host": "127.0.0.1",
  "port": 8787,
  "token": "${HUB_TOKEN}",
  "dataDir": "/var/lib/oktoso",
  "publicUrl": "https://oktoso.example.com",
  "healthCheckIntervalMs": 30000,
  "providers": [
    {
      "id": "openwebui-cloud",
      "type": "openwebui",
      "name": "Open WebUI",
      "baseUrl": "https://openwebui.example.com",
      "auth": { "kind": "bearer", "token": "${OPENWEBUI_API_KEY}" },
      "enabled": true,
      "timeoutMs": 30000
    },
    {
      "id": "opencode-termux",
      "type": "opencode",
      "name": "OpenCode Termux",
      "baseUrl": "http://127.0.0.1:4096",
      "auth": {
        "kind": "basic",
        "username": "opencode",
        "password": "${OPENCODE_TERMUX_PASSWORD}"
      },
      "enabled": true,
      "timeoutMs": 15000
    }
  ]
}
```

- `publicUrl` is optional. Set it when the hub is behind a TLS proxy or tunnel
  so pairing links and the terminal dashboard use the external origin.
- `timeoutMs` defaults to 20000. It applies to health checks and the
  session/attention sync reads. Sends, creates, and forks keep their longer
  operation timeouts.
- `healthCheckIntervalMs` defaults to 30000; set it to `0` to disable the
  background loop.
- Provider secrets should use environment references. Keep the config at mode
  `0600`.

## Notifications

`notifications` is off by default. Enabling it turns attention events into
phone notifications. Web Push is the only delivery path; there is no ntfy,
Telegram, or webhook sender.

```jsonc
{
  "notifications": {
    "enabled": true,
    "routing": {
      "immediate": ["permission", "approval"],
      "digest": ["question", "unread", "error"],
      "digestWindowMs": 900000,
      "quietHours": { "enabled": true, "start": "22:00", "end": "07:00", "timezone": "Asia/Kuala_Lumpur" }
    }
  }
}
```

- Web Push needs no channel entry. It activates when a browser registers a
  subscription and the device is served over **HTTPS or `localhost`**. On iOS,
  the PWA must be installed from the share sheet before push is available.
- The Settings screen enables notifications per device, sends a test, edits
  routing and quiet hours, and revokes a device without rotating the hub token.
- A blocking item always wakes the device. Everything else respects quiet hours
  and the digest window.
- VAPID keys are generated once at `dataDir/notifications/vapid.json` with mode
  `0600`. Override them with `notifications.vapid.publicKey` and
  `notifications.vapid.privateKey` only if you must keep the pair elsewhere.
  Never commit or log the private key.
- Rotating the VAPID pair invalidates every existing browser subscription; those
  devices must subscribe again.
- If the hub is behind a reverse proxy, terminate TLS there and set `publicUrl`
  so notification links open the external origin.

## Transcript cache

Off by default. When enabled in **Settings → Transcript cache**, the hub keeps
the message text it already read from a provider so search, export, and offline
views do not need another round trip. Only text parts are stored: tool input,
tool output, and reasoning are dropped, and a single transcript is capped at
about 1 MB so one huge session cannot fill the disk.

- Files live under `dataDir/transcripts`: one JSON file per session plus
  `index.json`, all mode `0600`.
- The provider stays authoritative. Opening a session always reads from the
  provider; the cache is write-through only, and a failed write never fails the
  read.
- Pages of one session revision merge by message id, so scrolling back builds a
  complete transcript. A new provider `updatedAt` replaces the stored copy.
  Writes are queued per session and never block the read they follow.
- `ttlDays` (1–90, default 7) and `maxSessions` (10–2000, default 200) bound the
  cache, with a 200 MB total budget. Eviction is least-recently-used, and
  expired entries are dropped on read and at start-up. Orphan files and
  abandoned temp files are removed at start-up.
- Turning the cache off deletes every stored transcript. **Clear cache** deletes
  them without changing the setting. Deleting `dataDir/transcripts` by hand is
  also safe: nothing in the hub depends on it.
- A search index follows the cache. It lives in `dataDir/search` and covers
  exactly the transcripts the cache holds, so `maxSessions` is also the search
  horizon. `GET /api/v1/search?q=` reads that index and never calls a provider. Turning the cache off or clearing it deletes the index too; a manual
  delete of either directory is safe.
- Everything else in `dataDir` is untouched by these actions.

## Automation

`automation` is off by default. Watchers react to attention, session, or
schedule triggers under a policy.

```jsonc
{
  "automation": {
    "enabled": true,
    "dryRun": true,
    "maxActionsPerHour": 6,
    "maxActionsPerDay": 24,
    "templates": [
      {
        "id": "nightly-review",
        "providerID": "desktop-opencode",
        "title": "Nightly review",
        "text": "Review the repository and report the risks."
      }
    ],
    "watchers": [
      {
        "id": "answer-safe-questions",
        "name": "Answer safe questions",
        "enabled": true,
        "trigger": { "kind": "attention", "types": ["question"] },
        "condition": { "providerID": "desktop-opencode" },
        "action": { "kind": "answer", "choice": "first-safe" },
        "dryRun": true,
        "limits": { "maxActionsPerHour": 3, "maxActionsPerDay": 12 }
      },
      {
        "id": "nightly",
        "name": "Nightly review",
        "enabled": true,
        "trigger": { "kind": "schedule", "everyMs": 86400000 },
        "action": { "kind": "start", "template": "nightly-review" },
        "dryRun": true,
        "limits": { "maxActionsPerHour": 1, "maxActionsPerDay": 1 }
      }
    ]
  }
}
```

- Two switches gate an action: the hub's `automation.dryRun` and the watcher's
  `dryRun`. A watcher acts only when both are false. Start in dry run.
- `answer` acts only on a normal, single, non-free-text, non-multi-select
  question whose explicit choices are all non-destructive and non-sensitive.
  Everything else becomes a pending approval.
- Answers to provider forms are delivered through the provider's form reply,
  not as a chat message. This works when the form has one select field whose
  option matches the proposed answer. A form with several fields, or with no
  matching option, still escalates, but approving it only records that a human
  handled it in the provider UI — the hub will not send a message that leaves
  the form pending.
- A form that offers a free-text answer is never auto-answered. The hub marks
  provider questions as free-text capable, so on OpenCode an `answer` watcher
  acts only after a human approves or always-allows the shape.
- Every run is leased per watcher + attention id, so duplicate events cannot
  act twice.
- Budgets are global and per watcher. Pause everything or one watcher from
  Settings → Automation. Pausing aborts an in-flight send, retry, or session
  create; a request that already reached the provider may still complete, and
  the idempotency key keeps a later retry safe.
- Approvals expire after `approvalTtlMs`. Approving executes the stored plan;
  denying never sends.
- Session triggers fire once when a session stays idle or error for `idleMs`;
  a status change resets the timer. Schedule triggers require
  `condition.sessionRef` and fire every `everyMs`.
- Quiet hours escalate answer and retry actions instead of acting.
- Actions: `answer`, `escalate`, `notify`, `retry`, and `start`. A `start`
  action references a template (`providerID`, `title`, optional directory,
  agent, model, and prompt text) and creates a new session, then sends the
  template prompt as its first message. A schedule `start` watcher does not need
  `condition.sessionRef`; other schedule actions do.
- Always-allow stores a bounded shape (watcher, question kind, options, and the
  chosen label) after a second confirmation in Settings → Automation. Only
  boolean and single-choice questions are eligible; free-text, multi-select,
  destructive, and sensitive choices never auto-answer. Revoke a shape at any
  time; the usage count and last use are shown next to it.
- Approvals are also merged into the Even G2 Inbox as blocking rows and can be
  approved or denied from the glasses.
- There is no token budget. `sendMessage` returns only `accepted` and a message
  id, and a session's usage arrives after the provider's reply, so an action's
  cost cannot be known before it runs. The enforced guards are actions per hour
  and per day, globally and per watcher. A post-hoc budget would only be able
  to stop the action after the one that crossed the line, which is not a budget
  worth shipping.

Control it from the CLI:

```sh
npx @amoshydra/oktoso automation status
npx @amoshydra/oktoso automation pause
npx @amoshydra/oktoso automation pause --watcher answer-safe-questions
npx @amoshydra/oktoso automation resume
```

The command reads the same config and owner token as `oktoso status`; pass
`--url` for a remote hub.

## OpenCode on another host

Start the OpenCode server on an interface the hub can reach:

```sh
OPENCODE_SERVER_PASSWORD='choose-a-strong-password' \
  opencode serve --hostname 0.0.0.0 --port 4096
```

Then add an `opencode` provider with:

- `baseUrl`: `http://<lan-or-tailscale-ip>:4096`
- auth: basic, username `opencode`, password from the server environment

Check the endpoint directly if needed:

```sh
curl -u opencode:'choose-a-strong-password' http://<host>:4096/api/info
```

Do not expose `4096` to the public internet. Prefer Tailscale, WireGuard, or a
LAN-only firewall rule.

### Termux

- Install a Node 24+ package and OpenCode.
- Run `termux-wake-lock` so Android does not suspend the process.
- Disable battery optimization for Termux.
- Use a stable address: a Tailscale MagicDNS name is easier than a phone's LAN
  IP, which changes between networks.
- For a supervised process, use `termux-services`, `tmux`, or a small startup
  script. A foreground run is enough for testing:

  ```sh
  termux-wake-lock
  OPENCODE_SERVER_PASSWORD='...' \
    opencode serve --hostname 0.0.0.0 --port 4096
  ```

If the phone sleeps, changes networks, or loses the VPN, the provider shows as
offline until the next successful health check.

## Open WebUI over HTTPS

Use the provider's base URL and a bearer API key:

```jsonc
{
  "id": "openwebui-cloud",
  "type": "openwebui",
  "baseUrl": "https://openwebui.example.com",
  "auth": { "kind": "bearer", "token": "${OPENWEBUI_API_KEY}" }
}
```

- A publicly trusted certificate works without extra configuration.
- A private CA or self-signed certificate is not trusted by Node's default
  store. Start the hub with the CA file:

  ```sh
  NODE_EXTRA_CA_CERTS=/etc/oktoso/private-ca.pem oktoso --config ...
  ```

  Per-provider CA settings are not implemented yet.
- If Open WebUI is mounted under a path prefix, include it in `baseUrl`, for
  example `https://example.com/openwebui`.
- Cloudflare, SSO, or a WAF in front of Open WebUI must allow the API key and
  the `/api/...` routes the adapter uses.

## Running the hub

### systemd

```ini
[Unit]
Description=Oktoso hub
After=network-online.target
Wants=network-online.target

[Service]
User=oktoso
Group=oktoso
EnvironmentFile=/etc/oktoso/oktoso.env
ExecStart=/usr/local/bin/oktoso --config /etc/oktoso/hub.config.json
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/oktoso

[Install]
WantedBy=multi-user.target
```

Install the package, create the config and env files with mode `0600`, then:

```sh
systemctl daemon-reload
systemctl enable --now oktoso
```

### Docker

The container needs to listen on `0.0.0.0`, while the published host port stays
on loopback:

```sh
docker run -d --name oktoso \
  --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -e HUB_HOST=0.0.0.0 \
  -e HUB_TOKEN \
  -e OPENWEBUI_API_KEY \
  -e OPENCODE_TERMUX_PASSWORD \
  -v "$PWD/hub.config.json:/config/hub.config.json:ro" \
  -v oktoso-data:/data \
  node:24-alpine \
  npx -y @amoshydra/oktoso@latest --config /config/hub.config.json
```

Set `dataDir` to `/data` in that config. The bind-mounted config must be mode
`0600`; Docker on Linux preserves the host mode.

### Termux hub

```sh
pkg install nodejs
npm install -g @amoshydra/oktoso
termux-wake-lock
oktoso --config ~/.config/oktoso/hub.config.json
```

Keep the token and provider secrets in the environment or a `0600` config file.
For a long-running hub, use `termux-services` or start it from `tmux`.

## TLS, VPN, and reverse proxy

Keep the hub bound to loopback and put one trusted entry point in front of it.

### Caddy

```caddyfile
oktoso.example.com {
  reverse_proxy 127.0.0.1:8787 {
    flush_interval -1
  }
}
```

### Nginx

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_buffering off;
  proxy_cache off;
  proxy_read_timeout 1h;
}
```

The hub uses server-sent events for `/api/v1/events`, so disable proxy buffering
and allow long-lived reads. Set `publicUrl` to the external HTTPS origin.

### Tailscale or WireGuard

Prefer a private overlay over public exposure:

- Install Tailscale on the hub and on each provider host.
- Use MagicDNS names or stable overlay IPs in `baseUrl`.
- Restrict provider ports with the host firewall or the tailnet ACL.
- Expose the hub with Tailscale Serve or a TLS reverse proxy; do not port-forward
  the provider ports directly.

The hub does not manage the VPN, certificates, or DNS.

## Security checklist

- Use a random `HUB_TOKEN` of at least 32 bytes; rotate it to revoke paired
  sessions.
- Keep the config `0600` and prefer environment references for secrets.
- Give provider credentials the narrowest access that works. Rotate API keys
  and OpenCode server passwords on a schedule.
- Never expose OpenCode, Hermes, or Open WebUI admin ports to the public
  internet without authentication and a trusted proxy.
- Use HTTPS for the hub UI whenever it crosses an untrusted network.
- Keep CORS restricted to trusted origins; `"*"` is for local testing only.
- Back up `dataDir` (`state.json`, attachments, MCP audit) separately from the
  provider config.

## Current limits

- One hub. State, the event bus, and MCP sessions are in-process; there is no
  multi-hub clustering or shared event log.
- No automatic retry for writes. A send to an offline provider fails clearly;
  use idempotency keys for safe retries where the provider supports them.
- No per-provider CA or client-certificate settings. Use
  `NODE_EXTRA_CA_CERTS` for a private CA.
- No offline send queue.
- No built-in tunnel, TLS termination, or discovery.

## Acceptance checklist

- Hub runs on Node 24+ on the target host.
- It reaches OpenCode on one machine, Open WebUI over HTTPS on another, and
  Hermes on a third.
- An offline provider shows as offline and does not block the other providers.
- Health checks back off instead of retrying a dead host on every tick.
- Restarting the hub recovers sessions and attention state.
- A prompt to an offline provider fails with a clear, non-blocking error.
- `publicUrl` produces correct pairing links behind the proxy.
- No secrets appear in logs, and the config is mode `0600`.
