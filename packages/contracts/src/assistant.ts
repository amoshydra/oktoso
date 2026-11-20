import { z } from "zod";

/**
 * Hub agent threads (M1).
 *
 * A thread is owned by the hub, not by a provider. It is pinned to one scope;
 * M1 only supports the session scope, so the union has a single member that
 * later milestones extend rather than rename.
 */
export const zAssistantScope = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session"),
    sessionRef: z.string().min(1),
  }),
]);

export const zAssistantThread = z.object({
  id: z.string().min(1),
  scope: zAssistantScope,
  title: z.string(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  messageCount: z.number().int().nonnegative(),
});

export const zAssistantRole = z.enum(["user", "assistant"]);

export const zAssistantActionKind = z.enum(["send", "answer", "interrupt"]);

export const zAssistantActionStatus = z.enum([
  "pending",
  /** Reserved by one decision; a second decision is refused. */
  "deciding",
  "done",
  "cancelled",
  "failed",
]);

export const zAssistantAnswer = z.object({
  questionId: z.string().min(1),
  choiceId: z.string().min(1),
  /** Short label for the card. */
  label: z.string(),
  /** The full option text, which is what the provider receives. Older turns
   * predate this field and fall back to the label. */
  text: z.string().optional(),
  messageId: z.string().min(1),
  revision: z.string().min(1),
});

/**
 * A write the model proposed and a human has not decided yet. It lives on the
 * assistant turn so it survives reloads and can only exist with an in-thread
 * confirmation.
 */
export const zAssistantAction = z.object({
  id: z.string().min(1),
  kind: zAssistantActionKind,
  status: zAssistantActionStatus,
  /** One sentence describing exactly what would happen. */
  summary: z.string(),
  sessionRef: z.string().min(1),
  /** `send`: the proposed message, editable in the confirmation card. */
  text: z.string().optional(),
  /** `answer`: the resolved choices, pinned to the question revision. */
  answers: z.array(zAssistantAnswer).optional(),
  error: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  decidedAt: z.number().int().nonnegative().optional(),
});

/** What the run actually read, so the answer can say so. */
export const zAssistantContext = z.object({
  /** Transcript turns included after the budget dropped the oldest. */
  messages: z.number().int().nonnegative().optional(),
  /** Turns the budget left out. */
  omitted: z.number().int().nonnegative().optional(),
  chars: z.number().int().nonnegative().optional(),
  /** Attention items in the context. */
  attention: z.number().int().nonnegative().optional(),
  /** The session's last activity when the answer was assembled. */
  asOf: z.number().int().nonnegative().optional(),
  /** Failed commands or tools found in the tail or the wider history page. */
  failures: z.number().int().nonnegative().optional(),
  /** Timestamp of the provider compaction the answer used, when it found one. */
  historyAt: z.number().int().nonnegative().optional(),
});

export const zAssistantTurn = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  role: zAssistantRole,
  text: z.string(),
  createdAt: z.number().int().nonnegative(),
  runId: z.string().optional(),
  model: z.string().optional(),
  /** Set when the run ended without an answer. */
  error: z.string().optional(),
  action: zAssistantAction.optional(),
  context: zAssistantContext.optional(),
  usage: z
    .object({
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
    })
    .optional(),
});

export const zAssistantThreadDetail = z.object({
  thread: zAssistantThread,
  turns: z.array(zAssistantTurn),
});

export const zAssistantRunState = z.enum([
  "running",
  "done",
  "error",
  "stopped",
  "awaiting-confirm",
]);

export const zAssistantRun = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  state: zAssistantRunState,
  startedAt: z.number().int().nonnegative(),
  finishedAt: z.number().int().nonnegative().optional(),
  model: z.string().optional(),
  error: z.string().optional(),
});

/**
 * The run event stream. `delta` carries text as it arrives; exactly one of
 * `done` or `error` terminates the stream.
 */
export const zAssistantEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("done"), run: zAssistantRun, turn: zAssistantTurn }),
  z.object({
    type: z.literal("action"),
    run: zAssistantRun,
    turn: zAssistantTurn,
  }),
  z.object({
    type: z.literal("error"),
    run: zAssistantRun,
    message: z.string(),
  }),
]);

export const zAssistantStatus = z.object({
  enabled: z.boolean(),
  model: z.string(),
  /** Writes are opt-in and always require an in-thread confirmation. */
  readOnly: z.boolean(),
  canWrite: z.boolean(),
  maxContextMessages: z.number().int().nonnegative(),
});

export const zAssistantActionDecision = z.object({
  decision: z.enum(["confirm", "cancel"]),
  /** `send` only: a human edit of the proposed text. */
  text: z.string().trim().min(1).max(4_000).optional(),
});

export const zAssistantThreadInput = z.object({
  scope: zAssistantScope,
  title: z.string().trim().min(1).max(120).optional(),
});

export const zAssistantThreadPage = z.object({
  data: z.array(zAssistantThread),
});

export const zAssistantMessageInput = z.object({
  text: z.string().trim().min(1).max(4_000),
  /** Optional client key so a retried POST does not start two runs. */
  idempotencyKey: z.string().trim().min(1).max(120).optional(),
});

export const zAssistantRunAccepted = z.object({
  run: zAssistantRun,
  thread: zAssistantThread,
  turn: zAssistantTurn,
});

export type AssistantScope = z.infer<typeof zAssistantScope>;
export type AssistantThread = z.infer<typeof zAssistantThread>;
export type AssistantRole = z.infer<typeof zAssistantRole>;
export type AssistantTurn = z.infer<typeof zAssistantTurn>;
export type AssistantThreadDetail = z.infer<typeof zAssistantThreadDetail>;
export type AssistantRunState = z.infer<typeof zAssistantRunState>;
export type AssistantActionKind = z.infer<typeof zAssistantActionKind>;
export type AssistantAnswer = z.infer<typeof zAssistantAnswer>;
export type AssistantContext = z.infer<typeof zAssistantContext>;
export type AssistantActionStatus = z.infer<typeof zAssistantActionStatus>;
export type AssistantAction = z.infer<typeof zAssistantAction>;
export type AssistantActionDecision = z.infer<
  typeof zAssistantActionDecision
>;
export type AssistantRun = z.infer<typeof zAssistantRun>;
export type AssistantEvent = z.infer<typeof zAssistantEvent>;
export type AssistantStatus = z.infer<typeof zAssistantStatus>;
export type AssistantThreadInput = z.infer<typeof zAssistantThreadInput>;
export type AssistantThreadPage = z.infer<typeof zAssistantThreadPage>;
export type AssistantMessageInput = z.infer<typeof zAssistantMessageInput>;
export type AssistantRunAccepted = z.infer<typeof zAssistantRunAccepted>;
