import { z } from "zod";

export const zProviderID = z.string().min(1);
export const zSessionRef = z.string().min(1);

export const zCursor = z.object({
  next: z.string().nullable(),
  previous: z.string().nullable().optional(),
});

export const zError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
    requestId: z.string().optional(),
    details: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const zProviderStatus = z.enum(["online", "offline", "auth-error", "unknown"]);

export const zProviderCapabilities = z.object({
  list: z.boolean(),
  read: z.boolean(),
  send: z.boolean(),
  create: z.boolean(),
  stream: z.boolean(),
  interrupt: z.boolean(),
  permissions: z.boolean(),
  forms: z.boolean(),
  attachments: z.boolean(),
  search: z.boolean(),
  options: z.boolean(),
  markRead: z.boolean(),
});

export const zProvider = z.object({
  id: zProviderID,
  type: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  enabled: z.boolean(),
  status: zProviderStatus,
  version: z.string().optional(),
  lastCheckedAt: z.number().int().optional(),
  capabilities: zProviderCapabilities,
});

export const zProviderHealth = z.object({
  status: zProviderStatus,
  version: z.string().optional(),
  latencyMs: z.number().optional(),
  message: z.string().optional(),
});

export const zAgentOption = z.object({
  id: z.string(),
  label: z.string(),
});

export const zModelOption = z.object({
  id: z.string(),
  label: z.string(),
  provider: z.string().optional(),
});

export const zProviderOptions = z.object({
  agents: z.array(zAgentOption),
  models: z.array(zModelOption),
  directories: z.array(z.string()),
  defaults: z
    .object({
      agent: z.string().optional(),
      model: z.string().optional(),
      directory: z.string().optional(),
    })
    .optional(),
});

export type ProviderStatus = z.infer<typeof zProviderStatus>;
export type ProviderCapabilities = z.infer<typeof zProviderCapabilities>;
export type Provider = z.infer<typeof zProvider>;
export type ProviderHealth = z.infer<typeof zProviderHealth>;
export type ProviderOptions = z.infer<typeof zProviderOptions>;
export type Cursor = z.infer<typeof zCursor>;
export type ErrorResponse = z.infer<typeof zError>;
