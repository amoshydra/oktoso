import { z } from "zod";

export const zHandoffStatus = z.enum([
  "pending",
  "sending",
  "sent",
  "failed",
  "cancelled",
]);

export const zHandoff = z.object({
  id: z.string().min(1),
  sourceRef: z.string().min(1),
  sourceTitle: z.string().min(1),
  targetRef: z.string().min(1),
  targetTitle: z.string().min(1),
  targetProviderID: z.string().min(1),
  targetProject: z.string().optional(),
  message: z.string().min(1).max(8_000),
  reason: z.string().max(500).optional(),
  status: zHandoffStatus,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  sentAt: z.number().int().nonnegative().optional(),
  /** Set when the hub queued a provider-visible receipt for the next turn. */
  receiptQueuedAt: z.number().int().nonnegative().optional(),
  /** Compact evidence reference: queue entry ID, log line, commit, or run. */
  evidence: z.string().max(500).optional(),
  /** Why the proposal was cancelled; absent for older records. */
  cancelReason: z.enum(["manual", "session-advanced"]).optional(),
  error: z.string().optional(),
  createdBy: z.string().optional(),
  /** The caller session ref when the proposal came from an agent. */
  createdByRef: z.string().optional(),
  sentMessageID: z.string().optional(),
});

export const zHandoffPage = z.object({ data: z.array(zHandoff) });

export const zHandoffCreate = z.object({
  sourceRef: z.string().min(1),
  targetRef: z.string().min(1),
  message: z.string().min(1).max(8_000),
  reason: z.string().max(500).optional(),
  evidence: z.string().trim().max(500).optional(),
  /** Internal provenance hint from the MCP bridge; defaults to owner. */
  createdBy: z.enum(["agent", "owner"]).optional(),
  createdByRef: z.string().min(1).optional(),
});

export const zHandoffUpdate = z.object({
  message: z.string().min(1).max(8_000),
});

export const zHandoffDecision = z.object({
  message: z.string().min(1).max(8_000).optional(),
});

export type HandoffStatus = z.infer<typeof zHandoffStatus>;
export type Handoff = z.infer<typeof zHandoff>;
export type HandoffPage = z.infer<typeof zHandoffPage>;
export type HandoffCreate = z.infer<typeof zHandoffCreate>;
export type HandoffUpdate = z.infer<typeof zHandoffUpdate>;
export type HandoffDecision = z.infer<typeof zHandoffDecision>;
