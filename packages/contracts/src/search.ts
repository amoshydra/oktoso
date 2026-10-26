import { z } from "zod";

export const zSearchResult = z.object({
  ref: z.string(),
  title: z.string(),
  providerID: z.string(),
  project: z.string().optional(),
  directory: z.string().optional(),
  updatedAt: z.number().int(),
  snippet: z.string().optional(),
});

export const zSearchQuery = z.object({
  q: z.string().min(1),
  scope: z.enum(["sessions", "messages", "all"]).optional(),
  cursor: z.string().optional(),
});

export type SearchResult = z.infer<typeof zSearchResult>;
