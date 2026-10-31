import { describe, expect, it } from "vitest";
import { PAIRING_TTL_SECONDS } from "./session";
import { PairingService } from "./pairing";

describe("pairing codes", () => {
  it("creates short, URL-safe, single-use codes", () => {
    let now = 1_700_000_000_000;
    const pairings = new PairingService({ now: () => now });
    const pairing = pairings.issue();

    expect(pairing.code).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(pairing.expiresAt).toBe(now + PAIRING_TTL_SECONDS * 1000);
    expect(pairings.consume(pairing.code)).toEqual(pairing);
    expect(pairings.consume(pairing.code)).toBeUndefined();
  });

  it("consumes an expired code without allowing a replay", () => {
    let now = 1_700_000_000_000;
    const pairings = new PairingService({ now: () => now });
    const pairing = pairings.issue();
    now = pairing.expiresAt;

    expect(pairings.consume(pairing.code)).toBeUndefined();
    expect(pairings.consume(pairing.code)).toBeUndefined();
    expect(pairings.size).toBe(0);
  });

  it("bounds the number of live codes", () => {
    const pairings = new PairingService({ capacity: 3, now: () => 10 });
    const first = pairings.issue();
    pairings.issue();
    pairings.issue();
    pairings.issue();

    expect(pairings.size).toBe(3);
    expect(pairings.consume(first.code)).toBeUndefined();
  });

  it("prunes expired codes before issuing", () => {
    let now = 0;
    const pairings = new PairingService({ now: () => now });
    const expired = pairings.issue();
    now = expired.expiresAt + 1;
    pairings.issue();

    expect(pairings.size).toBe(1);
  });
});
