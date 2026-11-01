import type { Context } from "hono";
import type { AppEnv } from "./types";

export function requestHost(c: Context<AppEnv>): string | undefined {
  const forwarded = c.req
    .header("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  return forwarded || c.req.header("host");
}

/**
 * Cookie-authenticated mutations must come from the hub's own origin. Browsers
 * set Origin on every mutating fetch; Sec-Fetch-Site covers clients that do not.
 */
export function isSameOriginRequest(c: Context<AppEnv>): boolean {
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");

  if (origin && origin !== "null") {
    try {
      const host = requestHost(c) ?? new URL(c.req.url).host;
      if (new URL(origin).host === host) return true;
    } catch {
      // Fall through to Fetch Metadata.
    }

    // Reverse proxies and some webviews rewrite Host while the browser still
    // reports the public page as same-origin. Trust Fetch Metadata for that
    // case; a real cross-site form submission reports cross-site.
    return site === "same-origin" || site === "none";
  }

  // A same-origin form navigation can report Origin: null in some browser
  // configurations. Fall back to Fetch Metadata, which the browser also sets.
  if (site) return site === "same-origin" || site === "none";

  return false;
}

/**
 * Pairing is a capability flow: the single-use code is the secret, not a
 * cookie. In-app browsers and QR handoffs sometimes report Origin: null with
 * cross-site metadata even though the form is the pairing page. Accept that
 * case, but reject a concrete foreign origin.
 */
export function isPairingRequestAllowed(c: Context<AppEnv>): boolean {
  if (isSameOriginRequest(c)) return true;
  const origin = c.req.header("origin");
  const site = c.req.header("sec-fetch-site");
  // Legacy webviews may send neither header. Pairing codes are single-use and
  // high entropy, so allow that fallback only for the pairing POST.
  return origin === "null" || (!origin && !site);
}
