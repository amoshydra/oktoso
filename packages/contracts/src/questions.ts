import { z } from "zod";

export const zAnswerChoiceKind = z.enum(["choice", "boolean", "suggestion"]);
export const zAnswerChoiceSource = z.enum(["explicit", "heuristic", "model"]);
export const zQuestionKind = z.enum(["choice", "boolean", "freeform"]);
export const zQuestionRisk = z.enum(["normal", "destructive", "sensitive"]);
export const zQuestionConfidence = z.enum(["high", "medium", "low"]);

export const zAnswerChoice = z.object({
  id: z.string(),
  label: z.string().max(80),
  text: z.string(),
  kind: zAnswerChoiceKind.default("choice"),
  source: zAnswerChoiceSource.default("explicit"),
  requiresConfirmation: z.boolean().optional(),
  destructive: z.boolean().optional(),
  sensitive: z.boolean().optional(),
});

export const zPendingQuestion = z.object({
  id: z.string(),
  text: z.string(),
  context: z.string().optional(),
  kind: zQuestionKind,
  choices: z.array(zAnswerChoice),
  allowsFreeText: z.boolean(),
  allowsVoice: z.boolean(),
  multiSelect: z.boolean(),
  risk: zQuestionRisk,
  confidence: zQuestionConfidence,
  source: zAnswerChoiceSource,
});

export const zQuestionPrompt = z.object({
  sessionRef: z.string(),
  messageId: z.string(),
  revision: z.string(),
  askedAt: z.number().int(),
  questions: z.array(zPendingQuestion).min(1),
  attentionID: z.string().optional(),
  generatedAt: z.number().int(),
});

export const zQuestionResponse = z.object({
  data: zQuestionPrompt.nullable(),
});

export type AnswerChoice = z.infer<typeof zAnswerChoice>;
export type PendingQuestion = z.infer<typeof zPendingQuestion>;
export type QuestionPrompt = z.infer<typeof zQuestionPrompt>;
export type QuestionResponse = z.infer<typeof zQuestionResponse>;
export type QuestionKind = z.infer<typeof zQuestionKind>;
export type QuestionRisk = z.infer<typeof zQuestionRisk>;
export type QuestionConfidence = z.infer<typeof zQuestionConfidence>;
