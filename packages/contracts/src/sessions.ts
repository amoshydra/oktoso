import { z } from "zod";
import { zCursor, zProviderID } from "./common";
import { zAttentionSummary } from "./attention";

export const zSessionStatus = z.enum(["running", "idle", "error", "offline"]);

export const zTokenUsage = z.object({
  input: z.number().int().nonnegative().optional(),
  output: z.number().int().nonnegative().optional(),
  total: z.number().int().nonnegative().optional(),
});

export const zSession = z.object({
  ref: z.string(),
  providerID: zProviderID,
  nativeID: z.string(),
  title: z.string(),
  project: z.string().optional(),
  directory: z.string().optional(),
  parentRef: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  status: zSessionStatus,
  unread: z.boolean(),
  updatedAt: z.number().int(),
  createdAt: z.number().int(),
  cost: z.number().optional(),
  tokens: zTokenUsage.optional(),
  attention: zAttentionSummary.optional(),
  nativeUrl: z.string().optional(),
});

/**
 * One session in a lineage tree. `depth` counts from the root, the current
 * session is flagged, and `parentRef` mirrors the provider's edge.
 */
export const zSessionLineageNode = z.object({
  ref: z.string(),
  title: z.string(),
  parentRef: z.string().optional(),
  providerID: zProviderID,
  project: z.string().optional(),
  status: zSessionStatus,
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
  depth: z.number().int().nonnegative(),
  current: z.boolean(),
});

export const zSessionLineage = z.object({
  root: z.string(),
  current: z.string(),
  nodes: z.array(zSessionLineageNode),
  /** True when a cap cut the tree; the provider may know more edges. */
  truncated: z.boolean(),
});

export const zSessionPage = z.object({
  data: z.array(zSession),
  cursor: zCursor,
});

export const zSessionListQuery = z.object({
  provider: z.string().optional(),
  scope: z.enum(["all", "root"]).optional(),
  status: zSessionStatus.optional(),
  q: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export const zCreateSessionInput = z.object({
  providerID: zProviderID,
  title: z.string().min(1),
  directory: z.string().optional(),
  agent: z.string().optional(),
  model: z.string().optional(),
  /**
   * Sent as the first user message once the session exists. The hub creates the
   * session first, so a send failure leaves a real session behind and reports
   * its ref in the error details.
   */
  text: z
    .string()
    .optional()
    .describe("First user message, sent after the session is created"),
});

export const zSessionSelectionInput = z.object({
  model: z.string().min(1).optional(),
  agent: z.string().min(1).optional(),
});

export type SessionStatus = z.infer<typeof zSessionStatus>;
export type TokenUsage = z.infer<typeof zTokenUsage>;
export type Session = z.infer<typeof zSession>;
export type SessionPage = z.infer<typeof zSessionPage>;
export type SessionLineageNode = z.infer<typeof zSessionLineageNode>;
export type SessionLineage = z.infer<typeof zSessionLineage>;
export type SessionListQuery = z.infer<typeof zSessionListQuery>;
export type CreateSessionInput = z.infer<typeof zCreateSessionInput>;
export type SessionSelectionInput = z.infer<typeof zSessionSelectionInput>;
