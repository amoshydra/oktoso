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
  text: z.string().optional(),
});

export type SessionStatus = z.infer<typeof zSessionStatus>;
export type TokenUsage = z.infer<typeof zTokenUsage>;
export type Session = z.infer<typeof zSession>;
export type SessionPage = z.infer<typeof zSessionPage>;
export type SessionListQuery = z.infer<typeof zSessionListQuery>;
export type CreateSessionInput = z.infer<typeof zCreateSessionInput>;
