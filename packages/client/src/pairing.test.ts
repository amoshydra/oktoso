import { describe, expect, it } from "vitest";
import {
  isPairingUrl,
  pairingCodeFromInput,
} from "./pairing";

const CODE = "AbCdEfGhIjKlMnOpQrStUv";

describe("pairing input", () => {
  it("accepts a raw pairing code", () => {
    expect(pairingCodeFromInput(CODE)).toBe(CODE);
    expect(pairingCodeFromInput(`  ${CODE}\n`)).toBe(CODE);
  });

  it("extracts the code from an absolute pairing URL", () => {
    expect(
      pairingCodeFromInput(`http://192.168.1.20:8787/pair/${CODE}`, {
        origin: "http://192.168.1.20:8787",
      }),
    ).toBe(CODE);
  });

  it("extracts the code from a root-relative pairing URL", () => {
    expect(
      pairingCodeFromInput(`/pair/${CODE}`, {
        origin: "https://hub.example.com",
      }),
    ).toBe(CODE);
  });

  it("rejects a pairing URL from a different origin when one is required", () => {
    expect(
      pairingCodeFromInput(`https://evil.example/pair/${CODE}`, {
        origin: "https://hub.example.com",
      }),
    ).toBeUndefined();
  });

  it("rejects unrelated URLs and malformed codes", () => {
    expect(pairingCodeFromInput("https://hub.example.com/sessions")).toBeUndefined();
    expect(pairingCodeFromInput("not a code")).toBeUndefined();
    expect(pairingCodeFromInput("short")).toBeUndefined();
  });

  it("recognizes pairing URLs", () => {
    expect(isPairingUrl(`/pair/${CODE}`, "https://hub.example.com")).toBe(true);
    expect(isPairingUrl(`https://evil.example/pair/${CODE}`, "https://hub.example.com")).toBe(false);
    expect(isPairingUrl("https://hub.example.com/", "https://hub.example.com")).toBe(false);
  });
});
