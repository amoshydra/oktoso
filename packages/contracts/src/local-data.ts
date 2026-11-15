import { z } from "zod";

/** Stores the hub owns; providers own the conversations themselves. */
export const zLocalDataStore = z.enum(["drafts", "markers", "feedback"]);

/**
 * Retention in days. `0` means never prune.
 *
 * Drafts default to never: an unsent message is the writer's work, and a TTL
 * would delete something the hub cannot recover.
 */
export const zLocalRetention = z.object({
  draftsDays: z.number().int().min(0).max(3650).default(0),
  markersDays: z.number().int().min(0).max(3650).default(30),
  feedbackDays: z.number().int().min(0).max(3650).default(30),
});

export const zLocalRetentionInput = z.object({
  draftsDays: z.number().int().min(0).max(3650).optional(),
  markersDays: z.number().int().min(0).max(3650).optional(),
  feedbackDays: z.number().int().min(0).max(3650).optional(),
});

export const zLocalDataView = z.object({
  drafts: z.number().int().nonnegative(),
  markers: z.number().int().nonnegative(),
  feedback: z.number().int().nonnegative(),
  feedbackBytes: z.number().int().nonnegative(),
  retention: zLocalRetention,
});

export type LocalDataStore = z.infer<typeof zLocalDataStore>;
export type LocalRetention = z.infer<typeof zLocalRetention>;
export type LocalRetentionInput = z.infer<typeof zLocalRetentionInput>;
export type LocalDataView = z.infer<typeof zLocalDataView>;
