import { createHmac, timingSafeEqual } from "node:crypto";

/** Pairing links are single-use and short lived, mirroring OpenCode. */
export const PAIRING_TTL_SECONDS = 5 * 60;

/** Paired browser and client sessions last 30 days. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Refresh a cookie when it is this close to expiry. */
export const SESSION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionToken {
  token: string;
  expiresAt: number;
}

export interface SessionInfo {
  expiresAt: number;
}

/**
 * Compare two strings without leaking their contents through timing.
 * Lengths are compared first because timingSafeEqual requires equal buffers.
 */
export function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function signingKey(ownerToken: string): Buffer {
  // Keep the owner token out of the HMAC message and give the key a fixed
  // context. This mirrors the OpenCode session-token derivation.
  return createHmac("sha256", ownerToken)
    .update("agent-hub-session-v1")
    .digest();
}

export function mintSessionToken(
  ownerToken: string,
  now = Date.now(),
  ttlSeconds = SESSION_TTL_SECONDS,
): SessionToken {
  const expiresAtSeconds = Math.floor(now / 1000) + ttlSeconds;
  const expiry = String(expiresAtSeconds);
  const mac = createHmac("sha256", signingKey(ownerToken))
    .update(expiry)
    .digest("base64url");

  return {
    token: `${expiry}.${mac}`,
    expiresAt: expiresAtSeconds * 1000,
  };
}

export function verifySessionToken(
  token: string,
  ownerToken: string,
  now = Date.now(),
): SessionInfo | undefined {
  if (token.length > 200) return undefined;

  const parts = token.split(".");
  if (parts.length !== 2) return undefined;

  const [expiry, mac] = parts as [string, string];
  if (!/^\d+$/.test(expiry)) return undefined;

  const expiresAtSeconds = Number(expiry);
  if (!Number.isSafeInteger(expiresAtSeconds)) return undefined;
  if (expiresAtSeconds * 1000 <= now) return undefined;

  const expected = createHmac("sha256", signingKey(ownerToken))
    .update(expiry)
    .digest();
  const provided = Buffer.from(mac, "base64url");
  if (provided.length !== expected.length) return undefined;
  if (!timingSafeEqual(provided, expected)) return undefined;

  return { expiresAt: expiresAtSeconds * 1000 };
}
