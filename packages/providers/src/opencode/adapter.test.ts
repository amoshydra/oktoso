import { describe, expect, it } from "vitest";
import {
  openCodeSessionStatus,
  type OpenCodeSessionRaw,
} from "./adapter";

function session(
  time: Partial<OpenCodeSessionRaw["time"]>,
  outcome?: OpenCodeSessionRaw["outcome"],
): OpenCodeSessionRaw {
  return {
    id: "ses_test",
    title: "Test session",
    time: { created: 1_000, updated: 1_000, ...time },
    ...(outcome ? { outcome } : {}),
  };
}

describe("openCodeSessionStatus", () => {
  it("stays idle after a completed run", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000, busy: 1_500, idle: 2_000 }, "succeeded"),
      ),
    ).toBe("idle");
  });

  it("is running while a new run is busy after a previous idle", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 3_000, busy: 3_000, idle: 2_000 }, "succeeded"),
      ),
    ).toBe("running");
  });

  it("is running for the first execution", () => {
    expect(
      openCodeSessionStatus(session({ updated: 2_000, busy: 1_500 })),
    ).toBe("running");
  });

  it("is idle before the first execution", () => {
    expect(openCodeSessionStatus(session({ updated: 1_000 }))).toBe("idle");
  });

  it("reports a failed completed run as error", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000, busy: 1_500, idle: 2_000 }, "failed"),
      ),
    ).toBe("error");
  });

  it("prefers running over the previous failed outcome", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 3_000, busy: 3_000, idle: 2_000 }, "failed"),
      ),
    ).toBe("running");
  });

  it("treats an interrupted run as idle", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 2_000, idle: 2_000 }, "interrupted"),
      ),
    ).toBe("idle");
  });

  it("uses idle when an older provider omits busy", () => {
    expect(
      openCodeSessionStatus(
        session({ updated: 3_000, idle: 2_000 }, "succeeded"),
      ),
    ).toBe("idle");
  });

  it("treats an older provider's first run as running", () => {
    expect(openCodeSessionStatus(session({ updated: 2_000 }))).toBe("running");
  });
});
