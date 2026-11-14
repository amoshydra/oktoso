import type {
  Attention,
  AutomationApproval,
} from "@amoshydra/oktoso-contracts";

/**
 * Automation approvals share the Inbox list with provider attention. The
 * payload marker keeps action dispatch honest while reusing the row, detail,
 * and input grammar.
 */
export function approvalAttention(approval: AutomationApproval): Attention {
  return {
    id: approval.id,
    sessionRef: approval.sessionRef,
    type: "approval",
    priority: "blocking",
    title: approval.title,
    summary: approval.proposed?.text ?? approval.summary,
    createdAt: approval.createdAt,
    actions: [
      { id: "approve_once", label: "Approve", style: "primary" },
      { id: "deny", label: "Deny", style: "danger" },
    ],
    payload: {
      automation: true,
      watcherID: approval.watcherID,
      reason: approval.reason,
    },
  };
}

export function isAutomationApproval(item: Attention): boolean {
  const payload = item.payload;
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload as Record<string, unknown>).automation === true,
  );
}

export function approvalAction(action: string): "approve" | "deny" {
  return action === "deny" ? "deny" : "approve";
}
