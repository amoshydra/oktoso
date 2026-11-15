# Security review — 2026-11-16

Status: internal review, no external audit. Scope: the hub as shipped in
`0.2.1` plus the Phase 5 additions (search, lineage, usage, export, local data,
backup).

## Trust model

One owner runs one hub. Every client is either the owner's browser, a paired
browser holding an HttpOnly cookie, or a northbound agent holding an MCP token.
Providers are remote services the owner already trusts. The operator owns
reachability: TLS, VPN, and network exposure are outside the hub.

Assets, in order of damage if leaked: provider credentials, the owner token,
message transcripts, VAPID private key, MCP tokens.

## Findings

| # | Area | Finding | Status |
|---|---|---|---|
| 1 | Auth | One owner token; paired sessions are `<expiry>.<HMAC>` with no identity. Rotating the owner token invalidates every session. | Accepted by design |
| 2 | Session cookie | `HttpOnly`, `SameSite=Lax`, `Secure` when the request is HTTPS, `Max-Age` 30 days. | OK |
| 3 | CSRF | Cookie-authenticated mutations require the hub's own origin or `Sec-Fetch-Site: same-origin/none`; `SameSite=Lax` is the second layer. Bearer clients are unaffected. | OK |
| 4 | CORS | Empty by default; `*` logs a warning and disables credentials. | OK |
| 5 | Body limits | Advisory `content-length` cap: JSON 1 MB, audio 25 MB. A chunked body or a client that omits the header is not stopped, and the attachment multipart is parsed before any size check. | Known gap — enforce during the body read if the hub is exposed |
| 6 | Pairing | Codes are five-minute, single-use, 128-bit. `POST /pair/:code` is limited to 20 attempts per minute per client. The limit keys on `x-forwarded-for`/`x-real-ip`, which a direct client can rotate. A mismatched `Origin` is logged but does not block redemption, by design for QR and embedded handoff. | Low — throttle is defence-in-depth on top of code entropy |
| 7 | Logs | Central redaction masks credential keys, content keys, registered secrets, and token-shaped substrings before any sink. Asserted by tests. | OK |
| 8 | SSRF | The attachment proxy only fetches the same origin as the configured provider and caps the response at 20 MB; file reads are jailed to the session directory. | OK |
| 9 | MCP | Write tools require `--allow-write` and a token whose tool allowlist includes them; every call is audited. | OK |
| 10 | Automation | Deny by default, dry run by default, bounded approvals, budgets, global and per-watcher pause, in-flight abort. | OK |
| 11 | Export | Reads through the same provider path; no new credential surface; authenticated. The export response sets no cache header; attachment and file responses allow private caching for a short TTL. | OK |
| 12 | Local data | Clearing is authenticated; disable/clear also removes the search index; retention is per store. | OK |
| 13 | Backup | Snapshot excludes logs and uploads, hashes every file, and restore refuses a running hub and a non-empty target without `--force`. | OK |
| 14 | Metrics | Requires the owner token; a paired session token gets 403. Series carry no titles, bodies, or credentials. | OK |

## Load check

`scripts/load-test.ts` publishes a 500-event burst to 200 subscribers, each
serializing a frame the way the SSE path does:

| Store | p95 per publish | Frames/s |
|---|---|---|
| `MemoryStateStore` | 0.09 ms | ~3.5M |
| `JsonStateStore` (production) | 0.21 ms | ~1.2M |

Production pays a clone, a schema parse, a full rewrite, and two fsyncs per
event, so the ceiling is disk, not the bus — and flash storage on a phone is
slower than the review machine. Re-run with `LOAD_STORE=json`.

## Residual risks

1. **No per-user identity.** Anyone with the owner token is the owner. Multi-user
   is deferred by design and would be a product fork.
2. **Plain HTTP on a LAN.** The token and transcripts cross the network unless
   the operator terminates TLS or uses a VPN. The hub does not terminate TLS.
3. **Config secrets.** Provider credentials live in the config unless referenced
   from the environment; the file must stay `0600`.
4. **The pairing throttle keys on a spoofable header** when the hub is exposed
   directly (finding 6), and request body caps are advisory for chunked bodies
   (finding 5).
5. **No external audit.** This is a self-review with tests, not a third-party
   assessment. Treat findings as claims backed by code, not certification.

## Recommendations

- Enforce body limits while reading, not from `content-length`, before exposing
  the hub to untrusted networks.
- Keep `publicUrl` set when behind a proxy so notification and pairing links use
  the TLS origin.
- Rotate the owner token to revoke devices; rotate provider keys on a schedule.
- Back up `dataDir` with `oktoso backup` and keep the config separate.
