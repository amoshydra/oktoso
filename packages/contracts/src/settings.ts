import { z } from "zod";

export const DEFAULT_REPLY_BASE_URL =
  "http://127.0.0.1:8080/v1";
export const DEFAULT_REPLY_MODEL =
  "gemma-3-4b-it";
export const DEFAULT_REPLY_TIMEOUT_MS = 8_000;
export const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 20_000;

export const zAssistantReplyConfig = z.object({
  enabled: z.boolean(),
  baseUrl: z.string(),
  model: z.string(),
  apiKey: z.string().optional(),
  disableThinking: z.boolean().default(true),
  timeoutMs: z.number().int().min(1_000).max(60_000),
});

export const zAssistantTranscriptionConfig = z.object({
  enabled: z.boolean(),
  baseUrl: z.string(),
  model: z.string(),
  apiKey: z.string().optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000),
});

export const zAssistantConfig = z.object({
  reply: zAssistantReplyConfig,
  transcription: zAssistantTranscriptionConfig,
});

export const zAssistantView = z.object({
  reply: z.object({
    enabled: z.boolean(),
    baseUrl: z.string(),
    model: z.string(),
    timeoutMs: z.number().int(),
    hasApiKey: z.boolean(),
    disableThinking: z.boolean(),
  }),
  transcription: z.object({
    enabled: z.boolean(),
    baseUrl: z.string(),
    model: z.string(),
    timeoutMs: z.number().int(),
    hasApiKey: z.boolean(),
  }),
});

export const zAssistantReplyInput = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().nullable().optional(),
  disableThinking: z.boolean().optional(),
  timeoutMs: z.number().int().min(1_000).max(60_000).optional(),
});

export const zAssistantTranscriptionInput = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().nullable().optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
});

export const zAssistantInput = z.object({
  reply: zAssistantReplyInput.optional(),
  transcription: zAssistantTranscriptionInput.optional(),
});

export const zReplyOptionSource = z.enum(["canned", "model", "agent"]);
export const zReplyOptionAction = z.enum([
  "send",
  "interrupt",
  "phone",
  "voice",
  "choices",
]);

export const zReplyOption = z.object({
  id: z.string(),
  label: z.string().max(80),
  text: z.string(),
  source: zReplyOptionSource,
  action: zReplyOptionAction.default("send"),
});

export const zReplyOptions = z.object({
  data: z.array(zReplyOption),
  generatedAt: z.number().int(),
  model: z.string().optional(),
  mode: z.enum(["reply", "choices"]),
});

export const zReplyMode = z.enum(["reply", "choices"]);

export const DEFAULT_ASSISTANT_CONFIG = {
  reply: {
    enabled: true,
    baseUrl: DEFAULT_REPLY_BASE_URL,
    model: DEFAULT_REPLY_MODEL,
    disableThinking: true,
    timeoutMs: DEFAULT_REPLY_TIMEOUT_MS,
  },
  transcription: {
    enabled: false,
    baseUrl: "",
    model: "",
    timeoutMs: DEFAULT_TRANSCRIPTION_TIMEOUT_MS,
  },
} satisfies z.infer<typeof zAssistantConfig>;

export type AssistantReplyConfig = z.infer<typeof zAssistantReplyConfig>;
export type AssistantTranscriptionConfig = z.infer<
  typeof zAssistantTranscriptionConfig
>;
export type AssistantConfig = z.infer<typeof zAssistantConfig>;
export type AssistantView = z.infer<typeof zAssistantView>;
export type AssistantInput = z.infer<typeof zAssistantInput>;
export type ReplyOption = z.infer<typeof zReplyOption>;
export type ReplyOptions = z.infer<typeof zReplyOptions>;
export type ReplyMode = z.infer<typeof zReplyMode>;
