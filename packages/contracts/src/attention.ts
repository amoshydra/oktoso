import { z } from "zod";

export const zAttentionType = z.enum(["permission", "approval", "question", "unread", "error"]);
export const zAttentionPriority = z.enum(["blocking", "high", "normal"]);
export const zAttentionActionStyle = z.enum(["primary", "danger", "default"]);

export const zAttentionAction = z.object({
  id: z.string(),
  label: z.string(),
  style: zAttentionActionStyle.optional(),
});

export const zAttentionOption = z.object({
  value: z.string(),
  label: z.string(),
});

export const zAttentionField = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["text", "textarea", "number", "boolean", "select", "multiselect"]),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  description: z.string().optional(),
  defaultValue: z.unknown().optional(),
  options: z.array(zAttentionOption).optional(),
});

export const zAttentionSummary = z.object({
  type: zAttentionType,
  priority: zAttentionPriority,
});

export const zAttention = z.object({
  id: z.string(),
  sessionRef: z.string(),
  parentRef: z.string().optional(),
  type: zAttentionType,
  priority: zAttentionPriority,
  title: z.string(),
  summary: z.string(),
  createdAt: z.number().int(),
  actions: z.array(zAttentionAction),
  fields: z.array(zAttentionField).optional(),
  openInProviderUrl: z.string().optional(),
  payload: z.unknown().optional(),
});

export const zAttentionPage = z.object({
  data: z.array(zAttention),
});

export const zAttentionActionInput = z.object({
  fields: z.record(z.string(), z.unknown()).optional(),
  payload: z.unknown().optional(),
});

export type AttentionType = z.infer<typeof zAttentionType>;
export type AttentionPriority = z.infer<typeof zAttentionPriority>;
export type AttentionActionStyle = z.infer<typeof zAttentionActionStyle>;
export type AttentionAction = z.infer<typeof zAttentionAction>;
export type AttentionField = z.infer<typeof zAttentionField>;
export type AttentionSummary = z.infer<typeof zAttentionSummary>;
export type Attention = z.infer<typeof zAttention>;
export type AttentionPage = z.infer<typeof zAttentionPage>;
export type AttentionActionInput = z.infer<typeof zAttentionActionInput>;
