import type { Context, Hono } from "hono";
import type { AuthService } from "../../auth/service";
import { AppError } from "../../domain/errors";
import {
  getHubSessionCookie,
  isSecureRequest,
  setHubSessionCookie,
} from "../auth-cookie";
import { isSameOriginRequest, requestHost } from "../origin";
import type { AppEnv } from "../types";

export interface PairRouteDeps {
  auth: AuthService;
}

function noStore(c: Context<AppEnv>): void {
  c.header("Cache-Control", "no-store");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatExpiry(expiresAt: number): string {
  return new Date(expiresAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function hubOrigin(c: Context<AppEnv>): string {
  const host = requestHost(c);
  if (!host) return "this hub";
  return `${isSecureRequest(c) ? "https" : "http"}://${escapeHtml(host)}`;
}

function hasValidSession(c: Context<AppEnv>, auth: AuthService): boolean {
  const cookie = getHubSessionCookie(c);
  return Boolean(cookie && auth.verifySession(cookie));
}

function pageShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <meta name="referrer" content="no-referrer">
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: system-ui, sans-serif; margin: 0; background: #08090b; color: #f4f6f9; }
    main { max-width: 32rem; margin: 12vh auto; padding: 0 1.5rem; }
    .brand { width: 40px; height: 40px; display: grid; place-items: center; border-radius: 10px; background: #2a2f38; color: #f4f6f9; font-size: 12px; font-weight: 700; margin-bottom: 24px; }
    .eyebrow { margin: 0 0 8px; color: #8f97a5; font-size: 10px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; }
    h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.25; letter-spacing: -.03em; }
    p { color: #b5bcc8; line-height: 1.5; }
    code { color: #f4f6f9; }
    .meta { font-size: 12px; }
    form { margin: 24px 0 16px; }
    button { width: 100%; min-height: 44px; padding: 12px 16px; border: 1px solid #5f6878; border-radius: 8px; background: #f4f6f9; color: #08090b; font: inherit; font-weight: 600; cursor: pointer; }
    button.secondary { background: transparent; color: #f4f6f9; }
    a { color: #9cc2ff; }
    .hint { margin-top: 24px; color: #8f97a5; font-size: 12px; }
  </style>
</head>
<body>
  <main>
    <div class="brand">AH</div>
    <p class="eyebrow">Agent Hub</p>
    ${body}
  </main>
</body>
</html>`;
}

function pairingPage(input: {
  origin: string;
  expiresAt: number;
  paired: boolean;
}): string {
  const body = input.paired
    ? `<h1>Already paired</h1>
    <p>This browser is already paired with <code>${input.origin}</code>.</p>
    <p class="meta">This link expires at ${formatExpiry(input.expiresAt)}.</p>
    <p><a href="/">Open Agent Hub</a></p>
    <form method="post">
      <button class="secondary" type="submit">Pair again to refresh this session</button>
    </form>
    <p class="hint">Pairing again replaces this browser's session cookie with a fresh 30-day session.</p>`
    : `<h1>Pair this device</h1>
    <p>This pairs the browser that opens it with <code>${input.origin}</code>.</p>
    <p class="meta">This link pairs once and expires at ${formatExpiry(input.expiresAt)}.</p>
    <form method="post">
      <button type="submit">Pair this device</button>
    </form>
    <p class="hint">Only pair a browser you control. The owner token is not shared.</p>`;

  return pageShell("Pair this device with Agent Hub", body);
}

function expiredPage(): string {
  return pageShell(
    "Pairing link expired",
    `<h1>Pairing link expired</h1>
    <p>This link expired, was already used, or the hub restarted. Pairing links work once and expire after five minutes.</p>
    <p>In the terminal running the hub, type <code>p</code> and press Enter. If the hub runs in the background, run its <code>pair</code> command from another terminal.</p>
    <p>If this browser is already paired, <a href="/">open Agent Hub</a>.</p>`,
  );
}

export function registerPairRoutes(
  app: Hono<AppEnv>,
  deps: PairRouteDeps,
): void {
  app.get("/pair/:code", (c) => {
    noStore(c);
    const pairing = deps.auth.inspectPairing(c.req.param("code"));
    const paired = hasValidSession(c, deps.auth);

    if (!pairing) {
      if (paired) return c.redirect("/", 302);
      return c.html(expiredPage(), 401);
    }

    return c.html(
      pairingPage({
        origin: hubOrigin(c),
        expiresAt: pairing.expiresAt,
        paired,
      }),
    );
  });

  app.post("/pair/:code", (c) => {
    noStore(c);
    if (c.req.header("origin") && !isSameOriginRequest(c)) {
      throw new AppError(
        "forbidden",
        "Cross-origin pairing request rejected",
        403,
      );
    }

    const consumed = deps.auth.consumePairing(c.req.param("code"));
    if (!consumed) {
      if (hasValidSession(c, deps.auth)) return c.redirect("/", 303);
      return c.html(expiredPage(), 401);
    }

    c.get("logger").info("pairing redeemed", { transport: "browser" });
    const session = deps.auth.mintSession();
    setHubSessionCookie(c, session.token);
    return c.redirect("/", 303);
  });
}
