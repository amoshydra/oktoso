import { z } from "zod";
import { zAttentionType } from "./attention";

/**
 * Automation contracts.
 *
 * A watcher reacts to attention events. The first slice implements attention
 * triggers only; session-idle and schedule triggers are reserved.
 */

export const zAutomationTrigger = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("attention"),
    types: z.array(zAttentionType).min(1).default(["question"]),
  }),
  z.object({
    kind: z.literal("session"),
    on: z.enum(["idle", "error"]),
    /** Require the status to hold before firing. */
    idleMs: z.number().int().min(0).max(86_400_000).default(60_000),
  }),
  z.object({
    kind: z.literal("schedule"),
    everyMs: z.number().int().min(60_000).max(86_400_000),
  }),
]);

export const zAutomationCondition = z.object({
  providerID: z.string().min(1).optional(),
  sessionRef: z.string().min(1).optional(),
  titleContains: z.string().min(1).max(120).optional(),
});

export const zAutomationAnswerChoice = z.enum(["first-safe", "id", "label"]);

export const zAutomationAction = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("answer"),
    /** How to select the answer from the pending question. */
    choice: zAutomationAnswerChoice.default("first-safe"),
    /** Choice id or label used by the `id`/`label` strategies. */
    value: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("escalate") }),
  z.object({ kind: z.literal("notify") }),
  z.object({ kind: z.literal("retry") }),
]);

export const zAutomationLimits = z.object({
  maxActionsPerHour: z.number().int().min(1).max(1_000).default(6),
  maxActionsPerDay: z.number().int().min(1).max(10_000).default(24),
});

export const zAutomationWatcher = z
  .object({
  id: z
    .string()
    .min(1)
    .max(64)
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "Watcher IDs may contain letters, numbers, dot, underscore, or dash",
    ),
  name: z.string().min(1).max(80).optional(),
  enabled: z.boolean().default(true),
  trigger: zAutomationTrigger,
  condition: zAutomationCondition.optional(),
  action: zAutomationAction,
  /** A watcher is always a dry run until both it and the hub opt in. */
  dryRun: z.boolean().default(true),
  limits: zAutomationLimits.default({
    maxActionsPerHour: 6,
    maxActionsPerDay: 24,
  }),
  })
  .superRefine((value, ctx) => {
    if (value.trigger.kind !== "attention" && value.action.kind === "answer") {
      ctx.addIssue({
        code: "custom",
        message: "Only attention watchers can auto-answer",
        path: ["action", "kind"],
      });
    }
  });

export const zAutomationDecision = z.enum([
  "acted",
  "escalated",
  "dry_run",
  "skipped",
  "failed",
]);

export const zAutomationRun = z.object({
  id: z.string(),
  watcherID: z.string(),
  trigger: z.string(),
  decision: zAutomationDecision,
  reason: z.string(),
  sessionRef: z.string().optional(),
  attentionID: z.string().optional(),
  action: z.string().optional(),
  detail: z.string().optional(),
  at: z.number().int(),
  /** Set when a human approved the queued action. */
  approved: z.boolean().optional(),
});

export const zAutomationRunPage = z.object({
  data: z.array(zAutomationRun),
});

export const zAutomationApprovalStatus = z.enum([
  "pending",
  "approved",
  "denied",
  "expired",
]);

export const zAutomationShape = z.object({
  id: z.string(),
  watcherID: z.string(),
  kind: z.enum(["boolean", "choice"]),
  /** Display labels of every option, sorted for a stable fingerprint. */
  choices: z.array(z.string()),
  /** Normalized selected label used in the fingerprint. */
  choice: z.string(),
  /** Display label of the selected choice. */
  label: z.string(),
  createdAt: z.number().int(),
  lastUsedAt: z.number().int().optional(),
  uses: z.number().int().nonnegative(),
});

export const zAutomationProposal = z.object({
  label: z.string().max(80).optional(),
  text: z.string().max(500),
});

export const zAutomationApproval = z.object({
  id: z.string(),
  watcherID: z.string(),
  attentionID: z.string(),
  sessionRef: z.string(),
  title: z.string(),
  summary: z.string(),
  action: zAutomationAction,
  reason: z.string(),
  status: zAutomationApprovalStatus,
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  decidedAt: z.number().int().optional(),
  /** True when approving will execute the proposed answer. */
  actionable: z.boolean(),
  /** The answer that approve will send, when actionable. */
  proposed: zAutomationProposal.optional(),
  /** True when this shape can be remembered for future approvals. */
  allowShape: z.boolean(),
});

export const zAutomationApprovalPage = z.object({
  data: z.array(zAutomationApproval),
});

export const zAutomationView = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  dryRun: z.boolean(),
  watchers: z.array(zAutomationWatcher),
  pausedWatchers: z.array(z.string()),
  runs: z.array(zAutomationRun),
  approvals: z.array(zAutomationApproval),
  allowedShapes: z.array(zAutomationShape),
});

export const zAutomationSettingsInput = z.object({
  paused: z.boolean().optional(),
  dryRun: z.boolean().optional(),
});

export const zAutomationApprovalAction = z.enum([
  "approve",
  "deny",
  "always",
]);

export type AutomationTrigger = z.infer<typeof zAutomationTrigger>;
export type AutomationCondition = z.infer<typeof zAutomationCondition>;
export type AutomationAction = z.infer<typeof zAutomationAction>;
export type AutomationLimits = z.infer<typeof zAutomationLimits>;
export type AutomationWatcher = z.infer<typeof zAutomationWatcher>;
export type AutomationDecision = z.infer<typeof zAutomationDecision>;
export type AutomationRun = z.infer<typeof zAutomationRun>;
export type AutomationRunPage = z.infer<typeof zAutomationRunPage>;
export type AutomationShape = z.infer<typeof zAutomationShape>;
export type AutomationProposal = z.infer<typeof zAutomationProposal>;
export type AutomationApproval = z.infer<typeof zAutomationApproval>;
export type AutomationApprovalStatus = z.infer<
  typeof zAutomationApprovalStatus
>;
export type AutomationApprovalPage = z.infer<typeof zAutomationApprovalPage>;
export type AutomationView = z.infer<typeof zAutomationView>;
export type AutomationSettingsInput = z.infer<
  typeof zAutomationSettingsInput
>;
export type AutomationApprovalAction = z.infer<
  typeof zAutomationApprovalAction
>;
