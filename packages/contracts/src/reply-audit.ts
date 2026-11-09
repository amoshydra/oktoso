import { z } from "zod";
import { zSessionStatus } from "./sessions";
import {
  zReplyConfidence,
  zReplyMode,
  zReplyMomentKind,
  zReplyOption,
  zReplyRole,
  zReplyState,
} from "./settings";

export const zReplyMoment = z.object({
  state: zReplyState,
  kind: zReplyMomentKind,
  pending: z.string().optional(),
  choices: z.array(z.string()),
  done: z.array(z.string()),
  constraints: z.array(z.string()),
  confidence: zReplyConfidence,
});

export const zReplyRejected = z.object({
  role: zReplyRole.optional(),
  text: z.string(),
  reason: z.string(),
});

export const zReplyAuditQuestionChoice = z.object({
  label: z.string(),
  description: z.string().optional(),
});

export const zReplyAuditQuestion = z.object({
  header: z.string().optional(),
  text: z.string(),
  choices: z.array(zReplyAuditQuestionChoice),
});

export const zReplyAudit = z.object({
  sessionRef: z.string(),
  sessionTitle: z.string().optional(),
  sessionStatus: zSessionStatus.optional(),
  mode: zReplyMode,
  model: z.string().optional(),
  generatedAt: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  modelMs: z.number().int().nonnegative(),
  systemPrompt: z.string(),
  context: z.string(),
  moment: zReplyMoment,
  rejected: z.array(zReplyRejected),
  question: zReplyAuditQuestion.optional(),
  options: z.array(zReplyOption),
  raw: z.string(),
  reasoning: z.string(),
  finishReason: z.string().optional(),
});

export const zReplyFeedbackVerdict = z.enum([
  "useful",
  "not_useful",
  "unsure",
]);

export const zReplyFeedbackRating = z.object({
  optionId: z.string(),
  verdict: zReplyFeedbackVerdict,
  note: z.string().max(500).optional(),
});

export const zReplyFeedbackInput = z.object({
  sessionRef: z.string().min(1),
  sessionTitle: z.string().max(300).optional(),
  mode: zReplyMode,
  model: z.string().max(200).optional(),
  systemPrompt: z.string().max(10_000),
  context: z.string().max(20_000),
  options: z.array(zReplyOption).max(20),
  ratings: z.array(zReplyFeedbackRating).max(20),
  overall: zReplyFeedbackVerdict.optional(),
  tags: z.array(z.string().max(40)).max(10).optional(),
  note: z.string().max(2_000).optional(),
  raw: z.string().max(20_000).optional(),
  reasoning: z.string().max(50_000).optional(),
});

export const zReplyFeedbackEntry = zReplyFeedbackInput.extend({
  id: z.string(),
  createdAt: z.number().int(),
});

export const zReplyFeedbackPage = z.object({
  data: z.array(zReplyFeedbackEntry),
});

export type ReplyAudit = z.infer<typeof zReplyAudit>;
export type ReplyMoment = z.infer<typeof zReplyMoment>;
export type ReplyRejected = z.infer<typeof zReplyRejected>;
export type ReplyAuditQuestion = z.infer<typeof zReplyAuditQuestion>;
export type ReplyAuditQuestionChoice = z.infer<
  typeof zReplyAuditQuestionChoice
>;
export type ReplyFeedbackVerdict = z.infer<typeof zReplyFeedbackVerdict>;
export type ReplyFeedbackRating = z.infer<typeof zReplyFeedbackRating>;
export type ReplyFeedbackInput = z.infer<typeof zReplyFeedbackInput>;
export type ReplyFeedbackEntry = z.infer<typeof zReplyFeedbackEntry>;
export type ReplyFeedbackPage = z.infer<typeof zReplyFeedbackPage>;
