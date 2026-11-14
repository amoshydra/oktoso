import { z } from "zod";
import {
  DEFAULT_NOTIFICATION_ROUTING,
  zAutomationWatcher,
  zNotificationRouting,
  zQuietHours,
} from "@amoshydra/oktoso-contracts";

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

export const zNotificationWebPushConfig = z.object({
  kind: z.literal("webpush"),
  enabled: z.boolean().default(true),
});

export const zNotificationNtfyConfig = z.object({
  kind: z.literal("ntfy"),
  enabled: z.boolean().default(true),
  url: z.string().url(),
  topic: z.string().min(1),
  token: z.string().optional(),
});

export const zNotificationTelegramConfig = z.object({
  kind: z.literal("telegram"),
  enabled: z.boolean().default(true),
  botToken: z.string().min(1),
  chatID: z.string().min(1),
});

export const zNotificationWebhookConfig = z.object({
  kind: z.literal("webhook"),
  enabled: z.boolean().default(true),
  url: z.string().url(),
  secret: z.string().optional(),
});

export const zNotificationChannelConfig = z.discriminatedUnion("kind", [
  zNotificationWebPushConfig,
  zNotificationNtfyConfig,
  zNotificationTelegramConfig,
  zNotificationWebhookConfig,
]);

export const zNotificationVapidConfig = z.object({
  publicKey: z.string().min(1).optional(),
  privateKey: z.string().min(1).optional(),
  subject: z.string().min(1).default("mailto:oktoso@localhost"),
});

export const zNotificationConfig = z
  .object({
    enabled: z.boolean().default(false),
    channels: z.array(zNotificationChannelConfig).default([]),
    routing: zNotificationRouting.default(DEFAULT_NOTIFICATION_ROUTING),
    vapid: zNotificationVapidConfig.default({
      subject: "mailto:oktoso@localhost",
    }),
    maxAttempts: z.number().int().min(1).max(10).default(3),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.channels.forEach((channel, index) => {
      if (seen.has(channel.kind)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate notification channel: ${channel.kind}`,
          path: ["channels", index, "kind"],
        });
      }
      seen.add(channel.kind);
    });
    const hasPublic = Boolean(value.vapid.publicKey);
    const hasPrivate = Boolean(value.vapid.privateKey);
    if (hasPublic !== hasPrivate) {
      ctx.addIssue({
        code: "custom",
        message: "vapid.publicKey and vapid.privateKey must be set together",
        path: ["vapid"],
      });
    }
  });

export const zAutomationConfig = z
  .object({
    enabled: z.boolean().default(false),
    dryRun: z.boolean().default(true),
    watchers: z.array(zAutomationWatcher).default([]),
    quietHours: zQuietHours.default({
      enabled: false,
      start: "22:00",
      end: "07:00",
      timezone: "UTC",
    }),
    pollIntervalMs: z.number().int().min(5_000).max(300_000).default(30_000),
    maxActionsPerHour: z.number().int().min(1).max(1_000).default(6),
    maxActionsPerDay: z.number().int().min(1).max(10_000).default(24),
    approvalTtlMs: z
      .number()
      .int()
      .min(60_000)
      .max(7 * 24 * 60 * 60 * 1_000)
      .default(24 * 60 * 60 * 1_000),
    audit: z
      .object({
        maxRuns: z.number().int().min(10).max(5_000).default(500),
      })
      .default({ maxRuns: 500 }),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>();
    value.watchers.forEach((watcher, index) => {
      if (seen.has(watcher.id)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate watcher ID: ${watcher.id}`,
          path: ["watchers", index, "id"],
        });
      }
      seen.add(watcher.id);
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
  automation: zAutomationConfig.default({
    enabled: false,
    dryRun: true,
    watchers: [],
    quietHours: {
      enabled: false,
      start: "22:00",
      end: "07:00",
      timezone: "UTC",
    },
    pollIntervalMs: 30_000,
    maxActionsPerHour: 6,
    maxActionsPerDay: 24,
    approvalTtlMs: 24 * 60 * 60 * 1_000,
    audit: { maxRuns: 500 },
  }),
  notifications: zNotificationConfig.default({
    enabled: false,
    channels: [],
    routing: DEFAULT_NOTIFICATION_ROUTING,
    vapid: { subject: "mailto:oktoso@localhost" },
    maxAttempts: 3,
  }),
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
export type NotificationConfig = z.infer<typeof zNotificationConfig>;
export type NotificationChannelConfig = z.infer<
  typeof zNotificationChannelConfig
>;
export type AutomationConfig = z.infer<typeof zAutomationConfig>;
