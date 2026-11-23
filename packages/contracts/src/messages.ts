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
    /** Provider tool metadata: exit code, match counts, child session, patch stats. */
    metadata: z.record(z.string(), z.unknown()).optional(),
    startedAt: z.number().int().optional(),
    completedAt: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("shell"),
    /** Provider shell id (`sh_…`); stable while the command runs. */
    id: z.string(),
    command: z.string(),
    status: z.string(),
    background: z.boolean(),
    exit: z.number().optional(),
    output: z.string().optional(),
    truncated: z.boolean().optional(),
    startedAt: z.number().int().optional(),
    completedAt: z.number().int().optional(),
  }),
  z.object({
    type: z.literal("compaction"),
    /** Why the history was compacted: "auto" or "manual". */
    reason: z.string(),
    status: z.string(),
    summary: z.string(),
    /** Present when the compaction failed. */
    error: z.string().optional(),
    /** False when retrying cannot help (for example, nothing to compact). */
    retryable: z.boolean().optional(),
    model: z.string().optional(),
    cost: z.number().optional(),
    tokens: z
      .object({
        input: z.number().int(),
        output: z.number().int(),
        reasoning: z.number().int(),
      })
      .optional(),
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

export const zSendDelivery = z.enum(["steer", "queue"]);

export const zSendInput = z.object({
  text: z.string(),
  attachments: z
    .array(z.string().min(1))
    .max(MAX_ATTACHMENTS_PER_MESSAGE)
    .optional(),
  answer: zSendAnswer.optional(),
  answers: z.array(zSendAnswer).min(1).max(20).optional(),
  /** Delivery while the agent is running. Providers may support one or both. */
  delivery: zSendDelivery.optional(),
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

/**
 * How a provider models an undone turn. `revert` stages a rollback that a send
 * commits; `branch` moves the active node in a message tree instead.
 */
export const zHistoryMode = z.enum(["revert", "branch"]);

export const zHistoryFileChange = z.object({
  path: z.string(),
  status: z.enum(["added", "deleted", "modified"]),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
});

/** The turn an undo would restore to the composer. */
export const zHistoryPrompt = z.object({
  text: z.string(),
  attachments: z.array(z.string()),
});

export const zSessionHistory = z.object({
  mode: zHistoryMode,
  canUndo: z.boolean(),
  canRedo: z.boolean(),
  /**
   * Present while a turn is undone. `messageId` is the boundary; the client
   * hides that turn from the transcript until redo or send.
   */
  staged: z
    .object({
      messageId: z.string().min(1),
      /** Files the undone turn changed. Informational: v1 never restores them. */
      files: z.array(zHistoryFileChange),
    })
    .optional(),
  prompt: zHistoryPrompt.optional(),
});

export const zSendResult = z.object({
  accepted: z.boolean(),
  messageID: z.string().optional(),
  delivery: zSendDelivery.optional(),
});

export const zInboxItem = z.object({
  id: z.string(),
  type: z.string(),
  delivery: zSendDelivery,
  text: z.string(),
  createdAt: z.number().int(),
});

export const zInboxPage = z.object({
  data: z.array(zInboxItem),
});

export const zInboxDeliveryInput = z.object({
  delivery: zSendDelivery,
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
export type HistoryMode = z.infer<typeof zHistoryMode>;
export type HistoryFileChange = z.infer<typeof zHistoryFileChange>;
export type HistoryPrompt = z.infer<typeof zHistoryPrompt>;
export type SessionHistory = z.infer<typeof zSessionHistory>;
export type MessageRole = z.infer<typeof zMessageRole>;
export type MessagePart = z.infer<typeof zMessagePart>;
export type Message = z.infer<typeof zMessage>;
export type MessagePage = z.infer<typeof zMessagePage>;
export type SendAnswerSource = z.infer<typeof zSendAnswerSource>;
export type SendAnswer = z.infer<typeof zSendAnswer>;
export type SendInput = z.infer<typeof zSendInput>;
export type SendDelivery = z.infer<typeof zSendDelivery>;
export type SendResult = z.infer<typeof zSendResult>;
export type InboxItem = z.infer<typeof zInboxItem>;
export type InboxPage = z.infer<typeof zInboxPage>;
export type InboxDeliveryInput = z.infer<typeof zInboxDeliveryInput>;
export type MessagesQuery = z.infer<typeof zMessagesQuery>;
