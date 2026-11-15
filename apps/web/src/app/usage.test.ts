import { describe, expect, it } from "vitest";
import type { Session } from "@amoshydra/oktoso-contracts";
import { buildUsageReport, tokenTotal } from "./usage";

const base = (overrides: Partial<Session> & { ref: string }): Session => ({
  providerID: "desktop-opencode",
  nativeID: overrides.ref,
  title: overrides.ref,
  status: "idle",
  unread: false,
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("tokenTotal", () => {
  it("prefers the provider's total and falls back to input + output", () => {
    expect(
      tokenTotal(base({ ref: "a", tokens: { input: 10, output: 5, total: 40 } })),
    ).toBe(40);
    expect(tokenTotal(base({ ref: "b", tokens: { input: 10, output: 5 } }))).toBe(15);
    expect(tokenTotal(base({ ref: "c", tokens: { input: 10 } }))).toBe(10);
    expect(tokenTotal(base({ ref: "d", tokens: {} }))).toBeNull();
    expect(tokenTotal(base({ ref: "e" }))).toBeNull();
  });
});

describe("buildUsageReport", () => {
  it("groups by provider and sums only reported figures", () => {
    const sessions = [
      base({ ref: "a", tokens: { total: 100 }, cost: 0.5 }),
      base({ ref: "b", tokens: { input: 10, output: 10 }, cost: 0.25 }),
      base({
        ref: "c",
        providerID: "openwebui:main",
        tokens: {},
      }),
    ];

    const report = buildUsageReport(sessions, "provider");

    expect(report.sessions).toBe(3);
    expect(report.rows.map((row) => row.label).sort()).toEqual([
      "Open WebUI",
      "OpenCode",
    ]);
    const opencode = report.rows.find((row) => row.label === "OpenCode")!;
    expect(opencode).toMatchObject({ sessions: 2, tokens: 120, cost: 0.75 });
    const webui = report.rows.find((row) => row.label === "Open WebUI")!;
    expect(webui).toMatchObject({ sessions: 1, tokens: null, cost: null });
    expect(report.missingTokens).toBe(1);
    expect(report.missingCost).toBe(1);
  });

  it("falls back to 'No project' and 'No model' instead of dropping sessions", () => {
    const sessions = [
      base({ ref: "a", project: "oktoso", model: "claude" }),
      base({ ref: "b" }),
    ];

    const byProject = buildUsageReport(sessions, "project");
    expect(byProject.rows.map((row) => row.label).sort()).toEqual([
      "No project",
      "oktoso",
    ]);

    const byModel = buildUsageReport(sessions, "model");
    expect(byModel.rows.map((row) => row.label).sort()).toEqual([
      "No model",
      "claude",
    ]);
  });

  it("returns null totals when nothing was reported", () => {
    const report = buildUsageReport(
      [base({ ref: "a", tokens: {} }), base({ ref: "b" })],
      "provider",
    );

    expect(report.tokens).toBeNull();
    expect(report.cost).toBeNull();
    expect(report.rows[0]?.tokens).toBeNull();
    expect(report.rows[0]?.cost).toBeNull();
  });

  it("orders rows by cost, then tokens, then sessions", () => {
    const sessions = [
      base({ ref: "a", providerID: "p-one", cost: 1 }),
      base({ ref: "b", providerID: "p-two", tokens: { total: 500 } }),
      base({ ref: "c", providerID: "p-three", cost: 2 }),
    ];

    const report = buildUsageReport(sessions, "provider");
    expect(report.rows.map((row) => row.key)).toEqual([
      "p-three",
      "p-one",
      "p-two",
    ]);
  });

  it("groups days by the session's last update", () => {
    const today = Date.now();
    const sessions = [
      base({ ref: "a", updatedAt: today }),
      base({ ref: "b", updatedAt: today - 24 * 60 * 60 * 1_000 }),
    ];

    const report = buildUsageReport(sessions, "day");
    expect(report.rows.map((row) => row.label)).toEqual(["Today", "Yesterday"]);
  });
});
