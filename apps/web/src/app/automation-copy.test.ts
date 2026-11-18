import { describe, expect, it } from "vitest";
import { automationReasonLabel } from "./automation-copy";

describe("automationReasonLabel", () => {
  it("explains the reasons a user actually sees", () => {
    expect(automationReasonLabel("not_low_risk")).toBe(
      "No safe answer was available",
    );
    expect(automationReasonLabel("form_unmapped")).toBe(
      "The provider form needs a human",
    );
    expect(automationReasonLabel("budget")).toBe(
      "The action budget is used up",
    );
    expect(automationReasonLabel("quiet_hours")).toBe(
      "Quiet hours: escalated instead of acting",
    );
  });

  it("degrades to the code with spaces for a new reason", () => {
    expect(automationReasonLabel("new_reason")).toBe("new reason");
  });
});
