import { createHmac, timingSafeEqual } from "node:crypto";
import { isSessionProfile, type SessionProfile } from "./profiles";

/** Pairing links are single-use and short lived, mirroring OpenCode. */
export const PAIRING_TTL_SECONDS = 5 * 60;

/** Paired browser and client sessions last 30 days. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Refresh a cookie when it is this close to expiry. */
export const SESSION_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface SessionToken {
  token: string;
  expiresAt: number;
  profile: SessionProfile;
}

export interface SessionInfo {
  expiresAt: number;
  profile: SessionProfile;
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
    .update("oktoso-session-v1")
    .digest();
}

export function mintSessionToken(
  ownerToken: string,
  now = Date.now(),
  ttlSeconds = SESSION_TTL_SECONDS,
  profile: SessionProfile = "phone",
): SessionToken {
  const expiresAtSeconds = Math.floor(now / 1000) + ttlSeconds;
  const payload = Buffer.from(
    JSON.stringify({ exp: expiresAtSeconds, profile }),
    "utf8",
  ).toString("base64url");
  const mac = createHmac("sha256", signingKey(ownerToken))
    .update(payload)
    .digest("base64url");

  return {
    token: `v2.${payload}.${mac}`,
    expiresAt: expiresAtSeconds * 1000,
    profile,
  };
}

function verifyPayload(
  payload: string,
  mac: string,
  ownerToken: string,
): { expiresAt: number; profile: SessionProfile } | undefined {
  const expected = createHmac("sha256", signingKey(ownerToken))
    .update(payload)
    .digest();
  const provided = Buffer.from(mac, "base64url");
  if (provided.length !== expected.length) return undefined;
  if (!timingSafeEqual(provided, expected)) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const value = parsed as Record<string, unknown>;
  if (typeof value.exp !== "number" || !Number.isSafeInteger(value.exp)) {
    return undefined;
  }
  if (!isSessionProfile(value.profile)) return undefined;
  return { expiresAt: value.exp * 1000, profile: value.profile };
}

export function verifySessionToken(
  token: string,
  ownerToken: string,
  now = Date.now(),
): SessionInfo | undefined {
  if (token.length > 500) return undefined;

  if (token.startsWith("v2.")) {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const [, payload, mac] = parts as [string, string, string];
    if (!payload || !mac) return undefined;
    const verified = verifyPayload(payload, mac, ownerToken);
    if (!verified || verified.expiresAt <= now) return undefined;
    return verified;
  }

  // Legacy tokens carried only an expiry. Treat them as the full phone profile
  // so existing paired devices keep working until they expire.
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

  return { expiresAt: expiresAtSeconds * 1000, profile: "phone" };
}
