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
      "baseUrl": "http://100.64.0.12:4096",
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

## Backup and restore

Backups are offline and cover the data directory only. Stop the hub first:
appends to feedback and MCP audit files are not atomic, so a snapshot taken
under a live process can certify a torn line as valid. The config file holds the
owner token and provider credentials, so copy it separately with mode `0600`.

```sh
oktoso backup --out ./oktoso-backup
oktoso restore --from ./oktoso-backup --force
```

- A backup is a directory with `manifest.json` plus a `data/` copy. Every file
  is hashed; restore refuses a snapshot whose bytes do not match.
- Included: hub state (`state.json`) with drafts, read markers, automation
  approvals and allowed shapes; notification subscriptions and VAPID keys;
  transcripts and the search index; reply feedback.
- The manifest records the data directory's name, not its absolute path, so a
  snapshot does not leak the operator's home layout.
- Symlinks and special files are refused rather than silently skipped; a
  non-empty output directory is refused rather than mixed with an older run.
- Excluded: `attachments/` (staged uploads), `logs/`, and `*.tmp`.
- Restore swaps the whole data directory. It refuses to run while the hub
  answers on its configured host and port, and it refuses a non-empty target
  unless you pass `--force`. The previous directory is kept as
  `<dataDir>.before-restore-<timestamp>`. It stages the copy next to `dataDir`,
  so the parent must be writable; in a container, restore from the host.
- Every path in the manifest must be relative and stay inside the snapshot; a
  crafted `../` entry aborts the restore before anything is written.
- Files are restored owner-only (`0600`); the data directory is `0700`.

What survives a restore:

| Thing | Survives? | Why |
|---|---|---|
| Sessions, transcripts, attention | Yes | They live on providers |
| Automation config and watchers | Yes | Your config file, copied separately |
| Approvals, allowed shapes, runs | Yes | Hub state |
| Notification subscriptions | Yes | VAPID keys are in `dataDir` |
| Paired browsers | Yes, until their token expires | Pairing tokens are stateless and signed with the owner token |
| Provider health history | No | Rebuilt on the next poll |

If you change the owner token on the new machine, every paired browser and
notification subscription must be re-created. Set `publicUrl` again if the hub
moves behind a different TLS origin.

## Local data

Everything the hub keeps on its own disk, and nothing a provider owns.

| Store | Location | What it is | Default retention |
|---|---|---|---|
| Transcript cache | `dataDir/transcripts` + `dataDir/search` | Message text read from a provider, and its index | 7 days, max 500 sessions |
| Reply feedback | `dataDir/reply-feedback.jsonl` | Ratings on generated reply options | 30 days |
| Drafts | hub state (`state.json`) | Unsent composer text | Never |
| Read markers | hub state (`state.json`) | Per-session read position | 30 days |

`GET /api/v1/settings/local-data` reports counts and retention; `PUT` sets
retention per store (`0` = never); `DELETE /api/v1/settings/local-data/:store`
clears one store; `DELETE /api/v1/settings/local-data` clears all of them,
including the cache and its index. Clearing never calls a provider.

Providers own the conversations themselves. Deleting local data leaves the
provider transcript, attention state, and session list untouched; the hub
re-reads them on the next request.

## Transcript cache

Off by default. When enabled in **Settings → Local data**, the hub keeps
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
- `ttlDays` (1–90, default 7) and `maxSessions` (10–2000, default 500) bound the
  cache, with a 200 MB total budget. Eviction is least-recently-used, and
  expired entries are dropped on read and at start-up. Orphan files and
  abandoned temp files are removed at start-up.
- Turning the cache off deletes every stored transcript. **Clear cache** deletes
  them without changing the setting. Deleting `dataDir/transcripts` by hand is
  also safe: nothing in the hub depends on it.
- A search index follows the cache. It lives in `dataDir/search` and covers
  exactly the transcripts the cache holds, so `maxSessions` is also the search
  horizon. `GET /api/v1/search?q=` reads that index and never calls a provider.
  A search can trail a chat read by one cache write plus the one-second index
  debounce, and it reports `ready: false` while the startup reconcile runs.
  Each document stores its first 200 characters; when a match sits deeper and
  the transcript is still cached, the route re-cuts the snippet from the message. Turning the cache off or clearing it deletes the index too; a manual
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
  the form pending. Boolean fields have no option list, so they escalate too.
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
  a status change resets the timer. Schedule triggers fire every `everyMs` and
  need `condition.sessionRef`, except a `start` action, which may omit it.
- Quiet hours escalate answer and retry actions instead of acting.
- Actions: `answer`, `escalate`, `notify`, `retry`, and `start`. A `start`
  action references a template (`providerID`, `title`, optional directory,
  agent, model, and prompt text) and creates a new session, then sends the
  template prompt as its first message. A schedule `start` watcher does not need
  `condition.sessionRef`; other schedule actions do.
- A template can also be started by a person, not only by a watcher:
  `POST /api/v1/automation/templates/<id>/start` or
  `oktoso template start --id <id>` (list with `oktoso template list`). A manual
  start ignores `automation.enabled`, pause, dry run, budgets, and quiet hours
  and records no run; it is a human action, not a supervisor decision. If the
  session is created but the first prompt fails, the error names the new
  session and is not retryable — retrying would create a second one.
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

## Packaging

### Docker

The image is built from this repository and pins Node 24:

```sh
podman build -t oktoso .
mkdir -p ./oktoso-data
cp hub.config.json ./oktoso-data/hub.config.json
chmod 600 ./oktoso-data/hub.config.json

podman run -d --name oktoso --userns=keep-id \
  --restart unless-stopped \
  -p 127.0.0.1:8787:8787 \
  -v "$PWD/oktoso-data:/data:Z" \
  oktoso
```

The container sets `HUB_DATA_DIR=/data`, so the config can keep `dataDir` out of
the file. The mount must stay writable: **Providers → Add/Edit** rewrites the
config, and `:ro` turns that into a 500. `--userns=keep-id` is a rootless-podman
detail; it lets the image's `node` user own the host directory. With Docker as
root, drop it.

To run the published package instead of the image:

```sh
docker run -d --name oktoso \
  -p 127.0.0.1:8787:8787 \
  -e HUB_HOST=0.0.0.0 -e HUB_TOKEN \
  -v "$PWD/oktoso-data:/data" \
  node:24-alpine npx -y @amoshydra/oktoso@latest --config /data/hub.config.json
```

Restore from the host, not inside the container: restore stages a directory
next to `dataDir`, and `/` is not writable for the container user.

### systemd

Unit: [`packaging/oktoso.service`](../packaging/oktoso.service).

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
StateDirectory=oktoso
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/oktoso /etc/oktoso

[Install]
WantedBy=multi-user.target
```

`ReadWritePaths` includes `/etc/oktoso` because the provider editor rewrites the
config. Put `HUB_DATA_DIR=/var/lib/oktoso` in `/etc/oktoso/oktoso.env` unless the
config already points `dataDir` there, then:

```sh
systemctl daemon-reload
systemctl enable --now oktoso
```

### Termux

[`packaging/termux-install.sh`](../packaging/termux-install.sh) installs the
Node runtime, takes a wake lock, and creates the config and state directories.
Then:

```sh
npx @amoshydra/oktoso                 # first run creates the config
$EDITOR ~/.config/oktoso/hub.config.json
npx @amoshydra/oktoso --config ~/.config/oktoso/hub.config.json
```

Keep the hub alive with `termux-wake-lock`, `termux-services` or `tmux`, and
disable battery optimisation for Termux.

### Clean Node 24 check

CI runs the full suite on Node 24, the image is `node:24-alpine`, and
`scripts/smoke-image.sh` builds and boots the image, then checks health and that
`/metrics` rejects an unauthenticated scrape. Running it is the packaging
acceptance check that does not need a phone.

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

## Observability

### Metrics

`GET /metrics` returns Prometheus text exposition. It requires the **owner**
token: a paired browser's session token is authenticated for the API but gets
`403` here, because the series name providers.

- `oktoso_up`, `oktoso_build_info`, `oktoso_uptime_seconds`
- `oktoso_provider_up{provider,type}` and `oktoso_providers{status}`
- `oktoso_sessions_cached`, `oktoso_event_seq`, `oktoso_event_buffer`,
  `oktoso_sse_clients`
- `oktoso_notification_deliveries_recent{status}`,
  `oktoso_notification_devices`
- `oktoso_automation_runs_recent{decision}`, `oktoso_automation_approvals_open`,
  `oktoso_automation_paused`

Series never carry a session title, message body, prompt, or credential. The
`_recent` suffix marks counters read from bounded logs (500 events), so they are
not lifetime totals.

```yaml
scrape_configs:
  - job_name: oktoso
    authorization:
      credentials: <owner token>
    static_configs:
      - targets: ["127.0.0.1:8787"]
```

### Logs and redaction

Logs are one JSON object per line with `time`, `level`, `msg`, and fields. Every
record passes one central redaction pass before it reaches stdout, stderr, the
log file, or a test sink:

- keys matching `password`, `token`, `authorization`, `api_key`, `secret`,
  `cookie`, `credential`, `text`, `body`, `content`, `prompt`, `draft`,
  `completion`, `transcript`, `messages`, `systemPrompt`, or `context` are
  replaced with `[REDACTED]`, at any depth;
- registered secrets — the owner token, provider credentials, the VAPID private
  key, and MCP tokens — are masked wherever they appear, including inside a
  provider error message;
- `Bearer …`, `Basic …`, and `?token=`/`?api_key=`/`?secret=` query values are
  masked by pattern.

Info level carries request metadata, counts, and provider status, never message
content. A unit test asserts this for the logger and for the redaction rules.

## Acceptance run

Run this on real hardware before claiming a deployment works. Record the device,
Android version, Termux version, hub version, and network path.

1. `oktoso backup --out ./pre-upgrade` on the old hub.
2. Install on Termux with `packaging/termux-install.sh`, edit the config, start
   the hub, and confirm the printed pairing link opens on the phone.
3. From the workstation, pair a browser over the LAN or VPN and send one prompt;
   confirm the phone inbox receives the attention item.
4. Stop the hub with Ctrl+C and start it again; confirm the browser reconnects
   the SSE stream without a manual reload and that queued sends land once.
5. Put the hub behind the TLS proxy, set `publicUrl`, and repeat steps 2–4 from
   the external origin. Confirm notification deep links open the right session.
6. Enable the transcript cache, read a session, and confirm search finds a phrase
   from it.
7. Record the results here, including anything that needed a retry.

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
- Back up `dataDir` with `oktoso backup` while the hub is stopped; staged
  uploads and logs are excluded by design. Keep the config separate.

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
