import { describe, expect, it } from "vitest";
import { landingScreen } from "./launch";

describe("G2 launch routing", () => {
  it("opens the Inbox from the glasses menu", () => {
    expect(
      landingScreen({ source: "glassesMenu", hasSession: true, reloaded: false }),
    ).toBe("inbox");
    expect(
      landingScreen({ source: "glassesMenu", hasSession: false, reloaded: false }),
    ).toBe("inbox");
  });

  it("resumes the session from the app menu", () => {
    expect(
      landingScreen({ source: "appMenu", hasSession: true, reloaded: false }),
    ).toBe("chat");
    expect(
      landingScreen({ source: "appMenu", hasSession: false, reloaded: false }),
    ).toBe("home");
  });

  it("falls back to Home without a source", () => {
    expect(landingScreen({ hasSession: true, reloaded: false })).toBe("home");
  });

  it("keeps a reload on Home", () => {
    expect(
      landingScreen({ source: "glassesMenu", hasSession: true, reloaded: true }),
    ).toBe("home");
    expect(
      landingScreen({ source: "appMenu", hasSession: true, reloaded: true }),
    ).toBe("home");
  });
});
