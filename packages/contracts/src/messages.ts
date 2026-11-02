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

export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;

export const zAttachment = z.object({
  id: z.string().min(1),
  name: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
  createdAt: z.number().int(),
});

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
  text: z.string(),
  attachments: z
    .array(z.string().min(1))
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
  answer: zSendAnswer.optional(),
  answers: z.array(zSendAnswer).min(1).max(20).optional(),
});

export const zBranchPoint = z.object({
  messageId: z.string().min(1),
  parentId: z.string().nullable(),
  role: zMessageRole,
  siblingIds: z.array(z.string().min(1)).min(1),
  index: z.number().int().nonnegative(),
  count: z.number().int().positive(),
});

export const zBranchPage = z.object({
  data: z.array(zBranchPoint),
});

export const zBranchSwitchInput = z.object({
  siblingId: z.string().min(1),
});

export const zForkInput = z.object({
  before: z.string().min(1).optional(),
});

export const zRetryInput = z.object({
  messageId: z.string().min(1),
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

export type Attachment = z.infer<typeof zAttachment>;
export type BranchPoint = z.infer<typeof zBranchPoint>;
export type BranchPage = z.infer<typeof zBranchPage>;
export type BranchSwitchInput = z.infer<typeof zBranchSwitchInput>;
export type ForkInput = z.infer<typeof zForkInput>;
export type RetryInput = z.infer<typeof zRetryInput>;
export type MessageRole = z.infer<typeof zMessageRole>;
export type MessagePart = z.infer<typeof zMessagePart>;
export type Message = z.infer<typeof zMessage>;
export type MessagePage = z.infer<typeof zMessagePage>;
export type SendAnswerSource = z.infer<typeof zSendAnswerSource>;
export type SendAnswer = z.infer<typeof zSendAnswer>;
export type SendInput = z.infer<typeof zSendInput>;
export type SendResult = z.infer<typeof zSendResult>;
export type MessagesQuery = z.infer<typeof zMessagesQuery>;
