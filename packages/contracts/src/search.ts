import { z } from "zod";
import { zMessageRole } from "./messages";
import { zSessionStatus } from "./sessions";

export const zSearchScope = z.enum(["sessions", "messages", "all"]);

export const zSearchQuery = z.object({
  q: z.string().min(1),
  /** Sessions dedupe by ref; messages return one row per matching message. */
  scope: zSearchScope.optional(),
  provider: z.string().min(1).optional(),
  status: zSessionStatus.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

/**
 * One search row.
 *
 * The original shape was session-only. `match`, `messageID`, `role`,
 * `createdAt`, and `score` are additive: a session row keeps the same fields,
 * and a message row adds the identity of the message that matched.
 */
export const zSearchResult = z.object({
  ref: z.string(),
  title: z.string(),
  providerID: z.string(),
  project: z.string().optional(),
  directory: z.string().optional(),
  updatedAt: z.number().int(),
  snippet: z.string().optional(),
  match: z.enum(["session", "message"]).optional(),
  messageID: z.string().optional(),
  role: zMessageRole.optional(),
  createdAt: z.number().int().optional(),
  score: z.number().optional(),
});

export const zSearchCursor = z.object({
  previous: z.string().nullable(),
  next: z.string().nullable(),
});

export const zSearchPage = z.object({
  data: z.array(zSearchResult),
  cursor: zSearchCursor,
  /** False while the index is still reconciling with the transcript cache. */
  ready: z.boolean(),
});

export type SearchScope = z.infer<typeof zSearchScope>;
export type SearchQuery = z.infer<typeof zSearchQuery>;
export type SearchResult = z.infer<typeof zSearchResult>;
export type SearchPage = z.infer<typeof zSearchPage>;
