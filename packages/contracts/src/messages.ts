import { z } from "zod";
import { zCursor } from "./common";

export const zMessageRole = z.enum(["user", "assistant", "system", "tool"]);

export const zMessagePart = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({
    type: z.literal("tool"),
    id: z.string(),
    name: z.string(),
    status: z.string(),
    input: z.unknown().optional(),
    output: z.unknown().optional(),
  }),
  z.object({
    type: z.literal("file"),
    name: z.string(),
    mimeType: z.string().optional(),
    url: z.string().optional(),
  }),
  z.object({ type: z.literal("unknown"), raw: z.unknown() }),
]);

export const zMessage = z.object({
  id: z.string(),
  sessionRef: z.string(),
  role: zMessageRole,
  parts: z.array(zMessagePart),
  createdAt: z.number().int(),
  completedAt: z.number().int().optional(),
  streaming: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const zMessagePage = z.object({
  data: z.array(zMessage),
  cursor: zCursor,
});

export const zSendAnswerSource = z.enum([
  "choice",
  "boolean",
  "text",
  "voice",
  "suggestion",
]);

export const zSendAnswer = z.object({
  questionId: z.string().min(1),
  messageId: z.string().min(1),
  revision: z.string().min(1),
  choiceId: z.string().min(1).optional(),
  source: zSendAnswerSource.default("choice"),
});

export const zSendInput = z.object({
  text: z.string().min(1),
  answer: zSendAnswer.optional(),
  answers: z.array(zSendAnswer).min(1).max(20).optional(),
});

export const zSendResult = z.object({
  accepted: z.boolean(),
  messageID: z.string().optional(),
});

export const zMessagesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  order: z.enum(["asc", "desc"]).optional(),
});

export type MessageRole = z.infer<typeof zMessageRole>;
export type MessagePart = z.infer<typeof zMessagePart>;
export type Message = z.infer<typeof zMessage>;
export type MessagePage = z.infer<typeof zMessagePage>;
export type SendAnswerSource = z.infer<typeof zSendAnswerSource>;
export type SendAnswer = z.infer<typeof zSendAnswer>;
export type SendInput = z.infer<typeof zSendInput>;
export type SendResult = z.infer<typeof zSendResult>;
export type MessagesQuery = z.infer<typeof zMessagesQuery>;
