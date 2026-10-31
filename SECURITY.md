# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository. Do not open a
public issue for a suspected vulnerability.

Include the affected version or commit, reproduction steps, and the impact. Do
not include real provider credentials, hub tokens, pairing links, or message
contents in the report. Redact secrets and replace private hostnames with
placeholders.

## Credentials

Oktoso is hub-owned: provider credentials stay on the hub and are never sent
to web or wearable clients.

- Put provider credentials in the ignored `.env.local` or in a local
  `hub.config.json` that is never committed.
- `.env.local` and `.data/` are gitignored. Keep their filesystem permissions
  restricted (`0600` for `.env.local`, `0700` for `.data`).
- `HUB_TOKEN` is the owner and recovery credential. Use a long random value and
  put the hub behind TLS, WireGuard, Tailscale, or another trusted transport.
- Pairing links are short-lived credentials. A link works once, expires in five
  minutes, and grants a 30-day session. Opening `/pair/<code>` does not consume
  the code; only the confirmation POST does, so chat link previews are safe.
  Do not paste pairing links into issues, chat logs, screenshots, or commit
  history. The interactive `p` command, the plain-mode first start, and the
  pair command print live links to stdout; treat that terminal output as
  sensitive for five minutes.
- Paired browsers receive an `HttpOnly`, `SameSite=Lax` session cookie. Active
  sessions refresh automatically before expiry, so a stolen cookie can remain
  valid while it is used. Rotating `HUB_TOKEN` invalidates every paired session.
  Per-device revocation is not implemented yet; stored device tokens are the
  follow-up.
- The committed `dev-token-oktoso` value is only for local development. Never
  reuse it for a reachable deployment.
- Assistant API keys are write-only from the browser and are not returned by the
  settings API or included in wearable packages.

If a credential was committed or shared, rotate it first, then remove it from
history. Deleting the file in a later commit does not revoke the credential.
Rotating `HUB_TOKEN` invalidates every paired session as well as the owner
credential.

## Network exposure

The hub binds `127.0.0.1` by default. Binding it to a LAN or public interface is
an operator decision and should be paired with authentication, CORS, and TLS.
Session cookies set `Secure` when the hub sees HTTPS or an
`X-Forwarded-Proto: https` hop; terminate TLS at a trusted proxy. Preserve the
original `Host` header or send `X-Forwarded-Host` so cookie origin checks match
the browser origin.
The Even G2 package whitelist intentionally contains only local and placeholder
origins; add your own hub origin at pack time with `HUB_ORIGIN`.

## Supported versions

Security fixes target the `main` branch. This project is pre-1.0, so older
commits and tags do not receive backports.
