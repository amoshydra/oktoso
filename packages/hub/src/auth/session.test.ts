import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_SECONDS,
  mintSessionToken,
  tokensMatch,
  verifySessionToken,
} from "./session";

const owner = "owner-token-long-enough";
const now = 1_700_000_000_000;

describe("session tokens", () => {
  it("mints a 30-day token and verifies it", () => {
    const session = mintSessionToken(owner, now);

    expect(session.token).toMatch(/^\d+\.[A-Za-z0-9_-]+$/);
    expect(session.expiresAt).toBe(
      (Math.floor(now / 1000) + SESSION_TTL_SECONDS) * 1000,
    );
    expect(verifySessionToken(session.token, owner, now)).toEqual({
      expiresAt: session.expiresAt,
    });
  });

  it("rejects an expired token", () => {
    const session = mintSessionToken(owner, now);
    expect(
      verifySessionToken(
        session.token,
        owner,
        session.expiresAt,
      ),
    ).toBeUndefined();
  });

  it("rejects a token signed by another owner token", () => {
    const session = mintSessionToken(owner, now);
    expect(
      verifySessionToken(session.token, "another-owner-token", now),
    ).toBeUndefined();
  });

  it("rejects a tampered token", () => {
    const session = mintSessionToken(owner, now);
    const [expiry, mac] = session.token.split(".");
    const tampered = `${expiry}.${mac?.slice(0, -1)}x`;
    expect(verifySessionToken(tampered, owner, now)).toBeUndefined();
    expect(verifySessionToken(`${expiry}.not-a-mac`, owner, now)).toBeUndefined();
  });

  it("rejects malformed tokens", () => {
    expect(verifySessionToken("", owner, now)).toBeUndefined();
    expect(verifySessionToken("one-part", owner, now)).toBeUndefined();
    expect(verifySessionToken("1.2.3", owner, now)).toBeUndefined();
    expect(verifySessionToken("nope.signature", owner, now)).toBeUndefined();
  });

  it("compares strings without accepting different lengths", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcd")).toBe(false);
  });
});
