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
    type: z.literal("error"),
    run: zAssistantRun,
    message: z.string(),
  }),
]);

export const zAssistantStatus = z.object({
  enabled: z.boolean(),
  model: z.string(),
  /** M1 never writes to a provider. */
  readOnly: z.boolean(),
  maxContextMessages: z.number().int().nonnegative(),
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
export type AssistantRun = z.infer<typeof zAssistantRun>;
export type AssistantEvent = z.infer<typeof zAssistantEvent>;
export type AssistantStatus = z.infer<typeof zAssistantStatus>;
export type AssistantThreadInput = z.infer<typeof zAssistantThreadInput>;
export type AssistantThreadPage = z.infer<typeof zAssistantThreadPage>;
export type AssistantMessageInput = z.infer<typeof zAssistantMessageInput>;
export type AssistantRunAccepted = z.infer<typeof zAssistantRunAccepted>;
