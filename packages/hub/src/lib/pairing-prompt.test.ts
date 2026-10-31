import { describe, expect, it } from "vitest";
import { isPairingCommand } from "./pairing-prompt";

describe("pairing prompt", () => {
  it("accepts p and pair with surrounding whitespace", () => {
    expect(isPairingCommand("p")).toBe(true);
    expect(isPairingCommand("P")).toBe(true);
    expect(isPairingCommand("pair")).toBe(true);
    expect(isPairingCommand(" PAIR \r")).toBe(true);
  });

  it("ignores other input", () => {
    expect(isPairingCommand("")).toBe(false);
    expect(isPairingCommand("ping")).toBe(false);
    expect(isPairingCommand("pair now")).toBe(false);
    expect(isPairingCommand("n")).toBe(false);
  });
});
