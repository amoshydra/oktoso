# Security

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository. Do not open a
public issue for a suspected vulnerability.

Include the affected version or commit, reproduction steps, and the impact. Do
not include real provider credentials, hub tokens, or message contents in the
report. Redact secrets and replace private hostnames with placeholders.

## Credentials

Agent Hub is hub-owned: provider credentials stay on the hub and are never sent
to web or wearable clients.

- Put provider credentials in the ignored `.env.local` or in a local
  `hub.config.json` that is never committed.
- `.env.local` and `.data/` are gitignored. Keep their filesystem permissions
  restricted (`0600` for `.env.local`, `0700` for `.data`).
- `HUB_TOKEN` is a bearer credential. Use a long random value and put the hub
  behind TLS, WireGuard, Tailscale, or another trusted transport.
- The committed `dev-token-agent-hub` value is only for local development. Never
  reuse it for a reachable deployment.
- Assistant API keys are write-only from the browser and are not returned by the
  settings API or included in wearable packages.

If a credential was committed or shared, rotate it first, then remove it from
history. Deleting the file in a later commit does not revoke the credential.

## Network exposure

The hub binds `127.0.0.1` by default. Binding it to a LAN or public interface is
an operator decision and should be paired with authentication, CORS, and TLS.
The Even G2 package whitelist intentionally contains only local and placeholder
origins; add your own hub origin at pack time with `HUB_ORIGIN`.

## Supported versions

Security fixes target the `main` branch. This project is pre-1.0, so older
commits and tags do not receive backports.
