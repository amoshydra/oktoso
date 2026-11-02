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
  /** Deadline for health checks and read-side session/attention sync. */
  timeoutMs: z.number().int().min(1_000).max(120_000).default(20_000),
});

export const zMcpRateLimit = z.object({
  windowMs: z.number().int().min(1_000).max(3_600_000).default(60_000),
  max: z.number().int().min(1).max(100_000).default(120),
});

export const zMcpToken = z.object({
  id: z
    .string()
    .min(1)
    .regex(
      /^[a-zA-Z0-9._-]+$/,
      "MCP client IDs may contain letters, numbers, dot, underscore, or dash",
    ),
  token: z.string().min(16),
  allowWrite: z.boolean().default(false),
  providers: z.array(z.string().min(1)).optional(),
  tools: z.array(z.string().min(1)).optional(),
  rateLimit: zMcpRateLimit.default({ windowMs: 60_000, max: 120 }),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(60_000),
});

export const zMcpConfig = z
  .object({
    enabled: z.boolean().default(false),
    tokens: z.array(zMcpToken).default([]),
    sessionTtlMs: z
      .number()
      .int()
      .min(60_000)
      .max(86_400_000)
      .default(1_800_000),
    maxSessions: z.number().int().min(1).max(1_000).default(50),
    audit: z
      .object({
        enabled: z.boolean().default(true),
        file: z.string().min(1).optional(),
      })
      .default({ enabled: true }),
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.tokens.length === 0) {
      ctx.addIssue({
        code: "custom",
        message: "mcp.enabled requires at least one token",
        path: ["tokens"],
      });
    }
    const ids = new Set<string>();
    const secrets = new Set<string>();
    value.tokens.forEach((token, index) => {
      if (ids.has(token.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate MCP client ID: ${token.id}`,
          path: ["tokens", index, "id"],
        });
      }
      ids.add(token.id);
      if (secrets.has(token.token)) {
        ctx.addIssue({
          code: "custom",
          message: "Duplicate MCP token",
          path: ["tokens", index, "token"],
        });
      }
      secrets.add(token.token);
    });
  });

export const zHubConfig = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(8787),
  token: z.string().min(16),
  dataDir: z.string().default(".data"),
  cors: z.array(z.string()).default([]),
  webRoot: z.string().optional(),
  appsRoot: z.string().optional(),
  /** External base URL when the hub sits behind a TLS proxy or tunnel. */
  publicUrl: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "publicUrl must be http or https")
    .optional(),
  /** Background provider health interval. 0 disables the loop. */
  healthCheckIntervalMs: z
    .number()
    .int()
    .min(0)
    .max(3_600_000)
    .default(30_000),
  providers: z.array(zProviderConfig).default([]),
  mcp: zMcpConfig.default({
    enabled: false,
    tokens: [],
    sessionTtlMs: 1_800_000,
    maxSessions: 50,
    audit: { enabled: true },
  }),
});

/** The subset needed to probe or pair with a running hub. */
export const zHubTarget = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(8787),
});

export const zHubPairingConfig = zHubTarget.extend({
  token: z.string().min(16),
  publicUrl: z.string().url().optional(),
});

export type ProviderAuth = z.infer<typeof zProviderAuth>;
export type ProviderConfig = z.infer<typeof zProviderConfig>;
export type HubConfig = z.infer<typeof zHubConfig>;
export type HubTarget = z.infer<typeof zHubTarget>;
export type HubPairingConfig = z.infer<typeof zHubPairingConfig>;
export type McpConfig = z.infer<typeof zMcpConfig>;
export type McpTokenConfig = z.infer<typeof zMcpToken>;
