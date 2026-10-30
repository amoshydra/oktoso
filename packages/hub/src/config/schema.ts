import { z } from "zod";

export const zProviderAuth = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("basic"),
    username: z.string().default("opencode"),
    password: z.string(),
  }),
  z.object({
    kind: z.literal("bearer"),
    token: z.string(),
  }),
  z.object({
    kind: z.literal("none"),
  }),
]);

export const zProviderConfig = z.object({
  id: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9._-]+$/, "Provider IDs may contain letters, numbers, dot, underscore, or dash"),
  type: z.string().min(1),
  name: z.string().optional(),
  baseUrl: z.string().url(),
  auth: zProviderAuth.optional(),
  enabled: z.boolean().default(true),
});

export const zHubConfig = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(8787),
  token: z.string().min(16),
  dataDir: z.string().default(".data"),
  cors: z.array(z.string()).default([]),
  webRoot: z.string().optional(),
  appsRoot: z.string().optional(),
  providers: z.array(zProviderConfig).default([]),
});

export type ProviderAuth = z.infer<typeof zProviderAuth>;
export type ProviderConfig = z.infer<typeof zProviderConfig>;
export type HubConfig = z.infer<typeof zHubConfig>;
