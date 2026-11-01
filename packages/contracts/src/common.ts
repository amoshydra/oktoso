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
export const zProviderAuthKind = z.enum(["basic", "bearer", "none"]);

const zProviderIDInput = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Provider IDs may contain letters, numbers, dot, underscore, or dash",
  );

const zProviderTypeInput = z.enum(["opencode", "openwebui"]);

export const zProviderAuthInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("basic"),
    username: z.string().min(1).default("opencode"),
    password: z.string().min(1),
  }),
  z.object({
    kind: z.literal("bearer"),
    token: z.string().min(1),
  }),
  z.object({ kind: z.literal("none") }),
]);

export const zProviderAuthUpdate = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("basic"),
    username: z.string().min(1).default("opencode"),
    password: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("bearer"),
    token: z.string().min(1).optional(),
  }),
  z.object({ kind: z.literal("none") }),
]);

export const zProviderInput = z.object({
  id: zProviderIDInput,
  type: zProviderTypeInput,
  name: z.string().min(1).max(80).optional(),
  baseUrl: z.string().url(),
  auth: zProviderAuthInput.optional(),
  enabled: z.boolean().default(true),
});

export const zProviderUpdateInput = z.object({
  type: zProviderTypeInput,
  name: z.string().min(1).max(80).optional(),
  baseUrl: z.string().url(),
  auth: zProviderAuthUpdate.optional(),
  enabled: z.boolean().default(true),
});

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
  authKind: zProviderAuthKind.optional(),
  authUsername: z.string().optional(),
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
export type ProviderAuthKind = z.infer<typeof zProviderAuthKind>;
export type ProviderAuthInput = z.infer<typeof zProviderAuthInput>;
export type ProviderAuthUpdate = z.infer<typeof zProviderAuthUpdate>;
export type ProviderInput = z.infer<typeof zProviderInput>;
export type ProviderUpdateInput = z.infer<typeof zProviderUpdateInput>;
export type ProviderCapabilities = z.infer<typeof zProviderCapabilities>;
export type Provider = z.infer<typeof zProvider>;
export type ProviderHealth = z.infer<typeof zProviderHealth>;
export type ProviderOptions = z.infer<typeof zProviderOptions>;
export type Cursor = z.infer<typeof zCursor>;
export type ErrorResponse = z.infer<typeof zError>;
