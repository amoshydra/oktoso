import { z } from "zod";
import { zSessionRef } from "./common";

export const DRAFT_TEXT_MAX_LENGTH = 100_000;

export const zDraftText = z.string().max(DRAFT_TEXT_MAX_LENGTH);

export const zDraft = z.object({
  sessionRef: zSessionRef,
  text: zDraftText,
  updatedAt: z.number().int().nonnegative(),
});

export const zDraftInput = z.object({
  text: zDraftText,
});

export const zDraftResponse = z.object({
  data: zDraft.nullable(),
});

export type Draft = z.infer<typeof zDraft>;
export type DraftInput = z.infer<typeof zDraftInput>;
export type DraftResponse = z.infer<typeof zDraftResponse>;
