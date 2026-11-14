import { describe, expect, it } from "vitest";
import type {
  Attention,
  AutomationApproval,
} from "@amoshydra/oktoso-contracts";
import {
  approvalAction,
  approvalAttention,
  isAutomationApproval,
} from "./approval-model";

const approval: AutomationApproval = {
  id: "approval_1",
  watcherID: "answer-safe-questions",
  attentionID: "att_1",
  sessionRef: "opencode:ses_auth",
  title: "Answer the migration question",
  summary: "Proceed?",
  action: { kind: "answer", choice: "first-safe" },
  reason: "not_low_risk",
  status: "pending",
  createdAt: 1_793_000_000_000,
  expiresAt: 1_793_086_400_000,
  actionable: true,
  allowShape: true,
  proposed: { text: "Use the existing migration", label: "Existing" },
};

const attention: Attention = {
  id: "att_1",
  sessionRef: "opencode:ses_auth",
  type: "question",
  priority: "blocking",
  title: "Fix the auth race",
  summary: "Proceed?",
  createdAt: 1,
  actions: [],
};

describe("G2 automation approvals", () => {
  it("maps an approval to a blocking attention row", () => {
    const item = approvalAttention(approval);

    expect(item).toMatchObject({
      id: "approval_1",
      sessionRef: "opencode:ses_auth",
      type: "approval",
      priority: "blocking",
      title: "Answer the migration question",
      summary: "Use the existing migration",
      payload: {
        automation: true,
        watcherID: "answer-safe-questions",
        reason: "not_low_risk",
      },
    });
    expect(item.actions.map((action) => action.id)).toEqual([
      "approve_once",
      "deny",
    ]);
  });

  it("distinguishes automation approvals from provider attention", () => {
    expect(isAutomationApproval(approvalAttention(approval))).toBe(true);
    expect(isAutomationApproval(attention)).toBe(false);
  });

  it("maps only deny to deny", () => {
    expect(approvalAction("deny")).toBe("deny");
    expect(approvalAction("approve_once")).toBe("approve");
    expect(approvalAction("anything_else")).toBe("approve");
  });
});
