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
