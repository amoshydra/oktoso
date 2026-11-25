import { createHmac } from "node:crypto";
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
  it("mints a 30-day phone token and verifies it", () => {
    const session = mintSessionToken(owner, now);

    expect(session.token).toMatch(/^v2\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(session.expiresAt).toBe(
      (Math.floor(now / 1000) + SESSION_TTL_SECONDS) * 1000,
    );
    expect(session.profile).toBe("phone");
    expect(verifySessionToken(session.token, owner, now)).toEqual({
      expiresAt: session.expiresAt,
      profile: "phone",
    });
  });

  it("mints a G2 token with the G2 profile", () => {
    const session = mintSessionToken(owner, now, 600, "g2");
    expect(verifySessionToken(session.token, owner, now)).toEqual({
      expiresAt: session.expiresAt,
      profile: "g2",
    });
  });

  it("accepts a legacy expiry-only token as the phone profile", () => {
    const expiry = String(Math.floor(now / 1000) + 60);
    const key = createHmac("sha256", owner)
      .update("oktoso-session-v1")
      .digest();
    const mac = createHmac("sha256", key)
      .update(expiry)
      .digest("base64url");
    expect(verifySessionToken(`${expiry}.${mac}`, owner, now)).toEqual({
      expiresAt: Number(expiry) * 1000,
      profile: "phone",
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
    const [version, payload, mac] = session.token.split(".");
    const tampered = `${version}.${payload}.${mac?.slice(0, -1)}x`;
    expect(verifySessionToken(tampered, owner, now)).toBeUndefined();
    expect(
      verifySessionToken(`${version}.${payload}.not-a-mac`, owner, now),
    ).toBeUndefined();
  });

  it("rejects a token with a profile that was not signed", () => {
    const session = mintSessionToken(owner, now);
    const [version, payload, mac] = session.token.split(".");
    const decoded = JSON.parse(
      Buffer.from(payload!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    decoded.profile = "g2";
    const changed = Buffer.from(JSON.stringify(decoded), "utf8").toString(
      "base64url",
    );
    expect(
      verifySessionToken(`${version}.${changed}.${mac}`, owner, now),
    ).toBeUndefined();
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
